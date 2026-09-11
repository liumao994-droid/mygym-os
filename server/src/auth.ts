import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Store } from './db/sqlite.js'
import type { AppConfig } from './config.js'

/**
 * 认证层:
 * - JWT(HS256)无状态会话,Web 与小程序都以 `Authorization: Bearer <token>` 携带。
 * - userId 一律从 token 解出,请求体中的任何 userId 字段都不会被信任。
 * - 认证方式可扩展:dev 登录(当前)/ 微信(未来,见 /api/auth/wechat)/ 手机号。
 *   平台标识(openid 等)只落 auth_identities 表,业务层仅接触统一 userId。
 */

export interface JwtPayload {
  sub: string
  jti: string
  nickname: string
  provider: string
  iat: number
  exp: number
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp' | 'jti'>, secret: string, expiresDays: number): string {
  const now = Math.floor(Date.now() / 1000)
  const full: JwtPayload = { ...payload, jti: randomUUID(), iat: now, exp: now + expiresDays * 86400 }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(full))
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(sig, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export interface AuthedUser {
  id: string
  username?: string
  nickname: string
  avatar: string | null
  authProvider: string
  status: string
  createdAt: number
  updatedAt: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; tokenJti: string; tokenExpiresAt: number; user: AuthedUser }
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : null
}

/** 需要登录的中间件:验证 token + 用户存在且状态正常 */
export function requireAuth(store: Store, cfg: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req)
    if (!token) {
      next(new HttpError(401, 'UNAUTHORIZED', '未登录'))
      return
    }
    const payload = verifyToken(token, cfg.jwtSecret)
    if (!payload) {
      next(new HttpError(401, 'UNAUTHORIZED', '登录状态无效或已过期'))
      return
    }
    const now = Math.floor(Date.now() / 1000)
    // 注销记录只需保留到 token 自然过期；每次鉴权顺手清理过期行。
    store.run('DELETE FROM revoked_tokens WHERE expires_at <= ?', now)
    if (store.get('SELECT jti FROM revoked_tokens WHERE jti = ?', payload.jti)) {
      next(new HttpError(401, 'UNAUTHORIZED', '登录状态已退出'))
      return
    }
    const row = store.get('SELECT id, username, nickname, avatar, auth_provider, status, created_at, updated_at FROM users WHERE id = ?', payload.sub)
    if (!row) {
      next(new HttpError(401, 'UNAUTHORIZED', '用户不存在'))
      return
    }
    if (row.status !== 'active') {
      next(new HttpError(403, 'USER_DISABLED', '账号已被禁用'))
      return
    }
    req.auth = {
      userId: row.id as string,
      tokenJti: payload.jti,
      tokenExpiresAt: payload.exp,
      user: {
        id: row.id as string,
        username: typeof row.username === 'string' ? row.username : undefined,
        nickname: row.nickname as string,
        avatar: (row.avatar as string | null) ?? null,
        authProvider: row.auth_provider as string,
        status: row.status as string,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      },
    }
    next()
  }
}

/** 便捷取用(挂载在 requireAuth 之后的路由内) */
export function authOf(req: Request): { userId: string; tokenJti: string; tokenExpiresAt: number; user: AuthedUser } {
  if (!req.auth) throw new HttpError(401, 'UNAUTHORIZED', '未登录')
  return req.auth
}

export function newId(): string {
  return randomUUID()
}
