import { Router } from 'express'
import type { AppConfig } from '../config.js'
import type { Store } from '../db/sqlite.js'
import { requireAuth, authOf, signToken } from '../auth.js'
import { loginDev, loginLocal, loginWithWechat, registerLocal } from '../services/users.js'
import { HttpError } from '../auth.js'

interface RateBucket {
  count: number
  resetAt: number
}

/** 进程内基础限流：V1 防住简单撞库/批量注册；分布式部署时再换共享存储。 */
function createRateLimiter(max: number, windowMs: number, code: string, message: string) {
  const buckets = new Map<string, RateBucket>()
  const current = (key: string): RateBucket | undefined => {
    const now = Date.now()
    const bucket = buckets.get(key)
    if (bucket && bucket.resetAt <= now) {
      buckets.delete(key)
      return undefined
    }
    return bucket
  }
  return {
    check(key: string): void {
      if ((current(key)?.count ?? 0) >= max) throw new HttpError(429, code, message)
    },
    hit(key: string): void {
      const bucket = current(key)
      if (!bucket) {
        buckets.set(key, { count: 1, resetAt: Date.now() + windowMs })
        return
      }
      bucket.count += 1
    },
    clear(key: string): void {
      buckets.delete(key)
    },
  }
}

/**
 * 认证路由。
 * 当前阶段:dev/mock 登录(明确标记,可由 DEV_AUTH_ENABLED=false 关闭)。
 * 微信:POST /api/auth/wechat 使用 wx.login code 走 code2session,
 *      服务端持有 WECHAT_APP_SECRET,签发同构 JWT。
 *      Web 与小程序共用同一 Bearer token 契约。
 */
export function authRoutes(store: Store, cfg: AppConfig): Router {
  const r = Router()
  const checkLoginRate = createRateLimiter(5, 15 * 60_000, 'LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后再试')
  const checkRegisterRate = createRateLimiter(5, 60 * 60_000, 'REGISTER_RATE_LIMITED', '注册尝试过多，请稍后再试')

  const issueToken = (user: { id: string; nickname: string; authProvider: string }) =>
    signToken({ sub: user.id, nickname: user.nickname, provider: user.authProvider }, cfg.jwtSecret, cfg.jwtExpiresDays)

  /** Web 用户系统 V1：本地账号注册，密码只在服务端 hash 后存储。 */
  r.post('/register', (req, res) => {
    const rateKey = req.ip ?? 'unknown'
    checkRegisterRate.check(rateKey)
    checkRegisterRate.hit(rateKey)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const nickname = typeof body.nickname === 'string' ? body.nickname : ''
    const user = registerLocal(store, username, password, nickname)
    res.status(201).json({ token: issueToken(user), user })
  })

  /** 登录失败统一返回相同文案，避免暴露用户名是否存在。 */
  r.post('/login', (req, res) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const username = typeof body.username === 'string' ? body.username.trim().toLocaleLowerCase('en-US') : ''
    // IP + 用户名同时计数，避免对单一账号的撞库尝试。
    const rateKey = `${req.ip ?? 'unknown'}:${username}`
    checkLoginRate.check(rateKey)
    const rawUsername = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    try {
      const user = loginLocal(store, rawUsername, password)
      checkLoginRate.clear(rateKey)
      res.json({ token: issueToken(user), user })
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) checkLoginRate.hit(rateKey)
      throw error
    }
  })

  r.post('/dev-login', (req, res) => {
    if (!cfg.devAuthEnabled) {
      res.status(403).json({ error: 'DEV_AUTH_DISABLED', message: '开发登录已关闭,请使用正式认证方式' })
      return
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const nickname = typeof body.nickname === 'string' ? body.nickname : ''
    const user = loginDev(store, nickname)
    res.json({ token: issueToken(user), user })
  })

  r.post('/wechat', (req, res, next) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const code = typeof body.code === 'string' ? body.code : ''
    loginWithWechat(store, cfg, code)
      .then((user) => {
        res.json({ token: issueToken(user), user })
      })
      .catch(next)
  })

  r.get('/me', requireAuth(store, cfg), (req, res) => {
    const { user } = authOf(req)
    res.json({ user })
  })

  r.post('/logout', requireAuth(store, cfg), (req, res) => {
    const { tokenJti, tokenExpiresAt } = authOf(req)
    store.run('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at, revoked_at) VALUES (?, ?, ?)', tokenJti, tokenExpiresAt, Date.now())
    res.json({ ok: true })
  })

  return r
}
