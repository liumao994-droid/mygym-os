import type { Store } from '../db/sqlite.js'
import { DEFAULT_EXERCISES } from '../db/defaults.js'
import { HttpError, newId, type AuthedUser } from '../auth.js'

/**
 * 用户服务:统一身份层。
 * dev 登录(当前)/ 微信登录(未来)都最终落到「创建或找到 User + 绑定 AuthIdentity」,
 * 业务层永远只处理 userId,不接触平台特定标识。
 */

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
 * 微信登录扩展点(未来实现):
 * 1. 小程序 wx.login() 得到 code → 本端点
 * 2. 服务端 code2session 换 openid/session_key(需要 APP_SECRET,仅服务端保存)
 * 3. auth_identities 中查找 (provider='wechat', provider_id=openid)
 *    → 找到:返回该 userId;未找到:创建 User + 绑定 identity + 播种默认动作库
 * 4. 签发与 dev 登录相同格式的 JWT,小程序后续请求同样走 Bearer token
 */
export function wechatLoginPlaceholder(): never {
  throw new HttpError(501, 'NOT_IMPLEMENTED', '微信登录将在接入正式小程序环境后开放(code2session)')
}
