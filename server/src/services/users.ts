import type { Store } from '../db/sqlite.js'
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
    nickname: row.nickname as string,
    avatar: (row.avatar as string | null) ?? null,
    authProvider: row.auth_provider as string,
    status: row.status as string,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function getUserById(store: Store, id: string): AuthedUser | null {
  const row = store.get('SELECT id, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE id = ?', id)
  return row ? rowToUser(row) : null
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
    "SELECT id, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE auth_provider = 'dev' AND nickname = ?",
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
