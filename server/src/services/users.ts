import type { Store } from '../db/sqlite.js'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DEFAULT_EXERCISES } from '../db/defaults.js'
import { HttpError, newId, type AuthedUser } from '../auth.js'
import type { AppConfig } from '../config.js'
import { wechatConfigured } from '../config.js'

/**
 * 用户服务:统一身份层。
 * dev 登录(联调)/ 微信登录都最终落到「创建或找到 User + 绑定 AuthIdentity」,
 * 业务层永远只处理 userId,不接触平台特定标识。
 */

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export interface WechatCode2SessionResult {
  openid?: string
  unionid?: string
  sessionKey?: string
  errcode?: number
  errmsg?: string
}

function rowToUser(row: Record<string, unknown>): AuthedUser {
  return {
    id: row.id as string,
    username: typeof row.username === 'string' ? row.username : undefined,
    nickname: row.nickname as string,
    avatar: (row.avatar as string | null) ?? null,
    authProvider: row.auth_provider as string,
    status: row.status as string,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function getUserById(store: Store, id: string): AuthedUser | null {
  const row = store.get('SELECT id, username, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE id = ?', id)
  return row ? rowToUser(row) : null
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLocaleLowerCase('en-US')
}

function validateLocalCredentials(rawUsername: string, rawPassword: string, rawNickname?: string): { username: string; password: string; nickname?: string } {
  const username = normalizeUsername(rawUsername)
  if (username.length < 2 || username.length > 32 || /\s/.test(username)) {
    throw new HttpError(400, 'INVALID_USERNAME', '用户名需为 2-32 个字符，且不能包含空格')
  }
  if (rawPassword.length < 6 || rawPassword.length > 128) {
    throw new HttpError(400, 'INVALID_PASSWORD', '密码需为 6-128 个字符')
  }
  const nickname = rawNickname === undefined ? undefined : rawNickname.trim()
  if (nickname !== undefined && (!nickname || nickname.length > 24)) {
    throw new HttpError(400, 'INVALID_NICKNAME', '昵称需为 1-24 个字符')
  }
  return { username, password: rawPassword, nickname }
}

/** 密码仅以 scrypt + 随机 salt 的 hash 保存，绝不进入 JWT、日志或响应。 */
function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const digest = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`
}

function passwordMatches(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [kind, rawSalt, rawDigest] = stored.split('$')
  if (kind !== 'scrypt' || !rawSalt || !rawDigest) return false
  try {
    const expected = Buffer.from(rawDigest, 'base64url')
    const actual = scryptSync(password, Buffer.from(rawSalt, 'base64url'), expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** Web V1 本地账号注册。用户名唯一，密码 hash 只保存于服务端 SQLite。 */
export function registerLocal(store: Store, rawUsername: string, rawPassword: string, rawNickname: string): AuthedUser {
  const { username, password, nickname } = validateLocalCredentials(rawUsername, rawPassword, rawNickname)
  const existing = store.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username)
  if (existing) throw new HttpError(409, 'USERNAME_TAKEN', '用户名已被使用')
  const now = Date.now()
  const id = newId()
  return store.transaction(() => {
    store.run(
      'INSERT INTO users (id, username, password_hash, nickname, auth_provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      username,
      hashPassword(password),
      nickname as string,
      'local',
      'active',
      now,
      now,
    )
    store.run('INSERT INTO auth_identities (id, user_id, provider, provider_id, created_at) VALUES (?, ?, ?, ?, ?)', newId(), id, 'local', username, now)
    seedDefaultExercises(store, id, now)
    return { id, username, nickname: nickname as string, avatar: null, authProvider: 'local', status: 'active', createdAt: now, updatedAt: now }
  })
}

/** 登录错误刻意统一，避免泄露用户名是否存在。 */
export function loginLocal(store: Store, rawUsername: string, rawPassword: string): AuthedUser {
  const username = normalizeUsername(rawUsername)
  if (!username || !rawPassword) throw new HttpError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  const row = store.get(
    "SELECT id, username, password_hash, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE auth_provider = 'local' AND username = ? COLLATE NOCASE",
    username,
  )
  if (!row || !passwordMatches(rawPassword, row.password_hash as string | null | undefined)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }
  if (row.status !== 'active') throw new HttpError(403, 'USER_DISABLED', '账号已被禁用')
  return rowToUser(row)
}

/** 为新用户播种默认动作库 */
function seedDefaultExercises(store: Store, userId: string, now: number): void {
  const insert = store.db.prepare(
    'INSERT INTO exercises (id, user_id, name, body_part, equipment, default_weight_type, is_custom, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
  )
  for (const d of DEFAULT_EXERCISES) {
    insert.run(newId(), userId, d.name, d.bodyPart, d.equipment, d.defaultWeightType, now, now)
  }
}

/** 清空当前用户业务数据并重新播种动作；账号、身份绑定和迁移快照不受影响。 */
export function resetUserData(store: Store, userId: string): AuthedUser {
  const user = getUserById(store, userId)
  if (!user) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
  store.transaction(() => {
    for (const table of [
      'sets', 'workout_exercises', 'sessions', 'daily_statuses', 'templates',
      'personal_records', 'pr_events', 'activity_sessions', 'exercises',
      'ai_usage', 'ai_analyses', 'app_state',
    ]) {
      store.run(`DELETE FROM ${table} WHERE user_id = ?`, userId)
    }
    seedDefaultExercises(store, userId, Date.now())
  })
  return user
}

/**
 * dev/测试登录:按昵称查找或创建用户。
 * 这不是生产认证;DEV_AUTH_ENABLED=false 时上层路由会拒绝。
 */
export function loginDev(store: Store, rawNickname: string): AuthedUser {
  const nickname = rawNickname.trim()
  if (!nickname || nickname.length > 24) {
    throw new HttpError(400, 'INVALID_NICKNAME', '昵称需为 1-24 个字符')
  }
  const existing = store.get(
    "SELECT id, username, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE auth_provider = 'dev' AND nickname = ?",
    nickname,
  )
  if (existing) {
    if (existing.status !== 'active') throw new HttpError(403, 'USER_DISABLED', '账号已被禁用')
    return rowToUser(existing)
  }
  const now = Date.now()
  const id = newId()
  return store.transaction(() => {
    store.run('INSERT INTO users (id, nickname, auth_provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, nickname, 'dev', 'active', now, now)
    store.run('INSERT INTO auth_identities (id, user_id, provider, provider_id, created_at) VALUES (?, ?, ?, ?, ?)', newId(), id, 'dev', nickname, now)
    seedDefaultExercises(store, id, now)
    return { id, nickname, avatar: null, authProvider: 'dev', status: 'active', createdAt: now, updatedAt: now }
  })
}

/**
 * 微信登录:
 * 1. 小程序 wx.login() 得到临时 code → 本端点;
 * 2. 服务端用 AppID/Secret 调 code2session 换 openid(密钥仅存服务端,前端永不接触);
 * 3. auth_identities 查找 (provider='wechat', provider_id=openid)
 *    → 找到:返回该 userId;未找到:创建 User + 绑定 identity + 播种默认动作库;
 * 4. 签发与 dev 登录同构的 JWT,后续请求继续走 Bearer token。
 *
 * code 是一次性的且只能由后端兑换;openid 属于平台身份,不进入业务请求参数。
 */
export async function wechatCode2Session(
  cfg: AppConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<WechatCode2SessionResult> {
  const q = new URLSearchParams({
    appid: cfg.wechat.appId,
    secret: cfg.wechat.appSecret,
    js_code: code,
    grant_type: 'authorization_code',
  })
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchImpl(`${cfg.wechat.code2sessionUrl}?${q.toString()}`)
  } catch {
    throw new HttpError(502, 'WECHAT_UPSTREAM_ERROR', '微信登录服务暂时不可用')
  }
  if (!res.ok) {
    throw new HttpError(502, 'WECHAT_UPSTREAM_ERROR', '微信登录服务暂时不可用')
  }
  let data: WechatCode2SessionResult
  try {
    data = (await res.json()) as WechatCode2SessionResult
  } catch {
    throw new HttpError(502, 'WECHAT_UPSTREAM_ERROR', '微信登录服务返回了无法解析的数据')
  }
  if (data.errcode) {
    if (data.errcode === 40029 || data.errcode === 40163 || data.errcode === 40226) {
      throw new HttpError(401, 'WECHAT_CODE_INVALID', '微信登录凭证无效或已过期,请重试')
    }
    if (data.errcode === 45011) {
      throw new HttpError(503, 'WECHAT_UPSTREAM_BUSY', '微信登录服务繁忙,请稍后重试')
    }
    throw new HttpError(502, 'WECHAT_LOGIN_FAILED', '微信登录失败,请稍后重试')
  }
  if (typeof data.openid !== 'string' || !data.openid) {
    throw new HttpError(502, 'WECHAT_LOGIN_FAILED', '微信登录未返回有效身份')
  }
  return data
}

/**
 * 微信绑定:已登录用户把当前微信 openid 关联到自己的账号。
 * 绑定后 /auth/wechat 会直接返回该账号,实现「网页注册的账号在小程序微信一键登录」。
 * 幂等:同一 openid 重复绑定同一用户直接成功;已绑定到其他用户则拒绝。
 */
export async function bindWechatIdentity(
  store: Store,
  cfg: AppConfig,
  code: string,
  userId: string,
): Promise<{ openid: string; linked: boolean; migrated: boolean }> {
  if (!wechatConfigured(cfg)) {
    throw new HttpError(503, 'WECHAT_NOT_CONFIGURED', '服务端尚未配置微信登录(WECHAT_APP_ID / WECHAT_APP_SECRET)')
  }
  const trimmed = code.trim()
  if (!trimmed || trimmed.length > 256) {
    throw new HttpError(400, 'INVALID_CODE', '缺少有效的微信登录 code')
  }
  const session = await wechatCode2Session(cfg, trimmed)
  const openid = session.openid as string
  const identity = store.get(
    "SELECT user_id FROM auth_identities WHERE provider = 'wechat' AND provider_id = ?",
    openid,
  )
  if (identity) {
    const sourceUserId = String(identity.user_id)
    if (sourceUserId === userId) return { openid, linked: true, migrated: false }

    const source = store.get('SELECT id, username, auth_provider, status FROM users WHERE id = ?', sourceUserId)
    const target = store.get('SELECT id, username, auth_provider, status FROM users WHERE id = ?', userId)
    // 只自动合并“微信首次登录自动生成、且没有本地账号密码”的临时账号。
    // 已绑定其他正式账号时继续拒绝，避免静默接管。
    if (!source || source.auth_provider !== 'wechat' || source.username || !target || target.status !== 'active') {
      throw new HttpError(409, 'WECHAT_ALREADY_BOUND', '该微信已绑定其他 MyGym 账号')
    }

    migrateWechatOnlyUser(store, sourceUserId, userId, openid)
    return { openid, linked: true, migrated: true }
  }
  store.run(
    'INSERT INTO auth_identities (id, user_id, provider, provider_id, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    userId,
    'wechat',
    openid,
    Date.now(),
  )
  return { openid, linked: true, migrated: false }
}

const OWNED_DATA_TABLES = [
  'exercises', 'sessions', 'workout_exercises', 'sets', 'templates',
  'personal_records', 'pr_events', 'activity_sessions', 'ai_analyses',
] as const

/**
 * 将仅微信身份的临时账号安全并入已验证的正式账号。
 * 迁移前保存完整快照；普通 id 主键数据原样搬迁，复合主键数据按无损规则合并。
 */
function migrateWechatOnlyUser(store: Store, sourceUserId: string, targetUserId: string, openid: string): void {
  const snapshotTables = [...OWNED_DATA_TABLES, 'daily_statuses', 'ai_usage', 'app_state', 'auth_identities'] as const
  const snapshot: Record<string, unknown[]> = {}
  for (const table of snapshotTables) snapshot[table] = store.all(`SELECT * FROM ${table} WHERE user_id = ?`, sourceUserId)

  store.transaction(() => {
    const now = Date.now()
    store.run(
      'INSERT INTO account_merge_backups (id, source_user_id, target_user_id, provider, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), sourceUserId, targetUserId, 'wechat', JSON.stringify(snapshot), now,
    )
    mergeDuplicateDefaultExercises(store, sourceUserId, targetUserId)
    for (const table of OWNED_DATA_TABLES) {
      store.run(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`, targetUserId, sourceUserId)
    }
    // 同一天只能有一个状态：正式账号已有值优先，微信旧值仍保存在迁移快照中。
    store.run(
      'INSERT OR IGNORE INTO daily_statuses (user_id, date, status, note, is_demo) SELECT ?, date, status, note, is_demo FROM daily_statuses WHERE user_id = ?',
      targetUserId, sourceUserId,
    )
    store.run('DELETE FROM daily_statuses WHERE user_id = ?', sourceUserId)
    // AI 次数按周期累加；设备状态以正式账号已有值优先。
    for (const row of store.all('SELECT period_type, period, count FROM ai_usage WHERE user_id = ?', sourceUserId)) {
      store.run(
        `INSERT INTO ai_usage (user_id, period_type, period, count) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, period_type, period) DO UPDATE SET count = count + excluded.count`,
        targetUserId, row.period_type, row.period, row.count,
      )
    }
    store.run('DELETE FROM ai_usage WHERE user_id = ?', sourceUserId)
    store.run(
      'INSERT OR IGNORE INTO app_state (user_id, key, value, updated_at) SELECT ?, key, value, updated_at FROM app_state WHERE user_id = ?',
      targetUserId, sourceUserId,
    )
    store.run('DELETE FROM app_state WHERE user_id = ?', sourceUserId)
    store.run('UPDATE auth_identities SET user_id = ? WHERE user_id = ?', targetUserId, sourceUserId)
    // 旧 JWT 立即失效；源账号保留用于审计/恢复，不删除任何用户记录。
    store.run("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?", now, sourceUserId)
    const rebound = store.get("SELECT user_id FROM auth_identities WHERE provider = 'wechat' AND provider_id = ?", openid)
    if (!rebound || String(rebound.user_id) !== targetUserId) throw new Error('微信身份迁移校验失败')
  })
}

/** 合并两边重复的系统动作并重写引用，避免迁移后出现两套默认动作。 */
function mergeDuplicateDefaultExercises(store: Store, sourceUserId: string, targetUserId: string): void {
  const targets = new Map(
    store.all('SELECT id, name, body_part FROM exercises WHERE user_id = ? AND is_custom = 0', targetUserId)
      .map((row) => [`${String(row.name)}\u0000${String(row.body_part)}`, String(row.id)]),
  )
  const idMap = new Map<string, string>()
  for (const row of store.all('SELECT id, name, body_part FROM exercises WHERE user_id = ? AND is_custom = 0', sourceUserId)) {
    const targetId = targets.get(`${String(row.name)}\u0000${String(row.body_part)}`)
    if (targetId && targetId !== String(row.id)) idMap.set(String(row.id), targetId)
  }
  if (!idMap.size) return

  for (const [sourceId, targetId] of idMap) {
    for (const table of ['workout_exercises', 'sets', 'personal_records', 'pr_events']) {
      store.run(`UPDATE ${table} SET exercise_id = ? WHERE user_id = ? AND exercise_id = ?`, targetId, sourceUserId, sourceId)
    }
  }
  for (const row of store.all('SELECT id, items FROM templates WHERE user_id = ?', sourceUserId)) {
    try {
      const items = JSON.parse(String(row.items)) as { exerciseId?: string }[]
      let changed = false
      for (const item of items) {
        const next = item && item.exerciseId ? idMap.get(item.exerciseId) : undefined
        if (next) {
          item.exerciseId = next
          changed = true
        }
      }
      if (changed) store.run('UPDATE templates SET items = ? WHERE id = ? AND user_id = ?', JSON.stringify(items), row.id, sourceUserId)
    } catch {
      // 非法模板仍原样保存在迁移快照中；现有业务校验不会生成这种数据。
    }
  }
  for (const sourceId of idMap.keys()) store.run('DELETE FROM exercises WHERE id = ? AND user_id = ?', sourceId, sourceUserId)
}

export function loginWithWechat(
  store: Store,
  cfg: AppConfig,
  code: string,
  fetchImpl?: FetchLike,
): Promise<AuthedUser> {
  if (!wechatConfigured(cfg)) {
    throw new HttpError(503, 'WECHAT_NOT_CONFIGURED', '服务端尚未配置微信登录(WECHAT_APP_ID / WECHAT_APP_SECRET)')
  }
  const trimmed = code.trim()
  if (!trimmed || trimmed.length > 256) {
    throw new HttpError(400, 'INVALID_CODE', '缺少有效的微信登录 code')
  }
  return wechatCode2Session(cfg, trimmed, fetchImpl).then((session) => {
    const openid = session.openid as string
    const now = Date.now()
    const identity = store.get(
      "SELECT user_id FROM auth_identities WHERE provider = 'wechat' AND provider_id = ?",
      openid,
    )
    if (identity) {
      const user = getUserById(store, String(identity.user_id))
      if (!user) throw new HttpError(401, 'UNAUTHORIZED', '关联用户不存在')
      if (user.status !== 'active') throw new HttpError(403, 'USER_DISABLED', '账号已被禁用')
      return user
    }
    const id = newId()
    const suffix = openid.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || 'wx'
    let nickname = `微信健身用户${suffix}`
    for (let i = 1; store.get('SELECT id FROM users WHERE auth_provider = ? AND nickname = ?', 'wechat', nickname); i++) {
      nickname = `微信健身用户${suffix}${i}`
      if (nickname.length > 24) nickname = `微信用户${suffix}${i}`
    }
    return store.transaction(() => {
      store.run(
        'INSERT INTO users (id, nickname, auth_provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        nickname,
        'wechat',
        'active',
        now,
        now,
      )
      store.run(
        'INSERT INTO auth_identities (id, user_id, provider, provider_id, created_at) VALUES (?, ?, ?, ?, ?)',
        newId(),
        id,
        'wechat',
        openid,
        now,
      )
      seedDefaultExercises(store, id, now)
      return {
        id,
        nickname,
        avatar: null,
        authProvider: 'wechat' as const,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
    })
  })
}
