import { Router } from 'express'
import type { AppConfig } from '../config.js'
import type { Store } from '../db/sqlite.js'
import { requireAuth, authOf, signToken } from '../auth.js'
import { loginDev, loginWithWechat } from '../services/users.js'

/**
 * 认证路由。
 * 当前阶段:dev/mock 登录(明确标记,可由 DEV_AUTH_ENABLED=false 关闭)。
 * 微信:POST /api/auth/wechat 使用 wx.login code 走 code2session,
 *      服务端持有 WECHAT_APP_SECRET,签发同构 JWT。
 *      Web 与小程序共用同一 Bearer token 契约。
 */
export function authRoutes(store: Store, cfg: AppConfig): Router {
  const r = Router()

  r.post('/dev-login', (req, res) => {
    if (!cfg.devAuthEnabled) {
      res.status(403).json({ error: 'DEV_AUTH_DISABLED', message: '开发登录已关闭,请使用正式认证方式' })
      return
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const nickname = typeof body.nickname === 'string' ? body.nickname : ''
    const user = loginDev(store, nickname)
    const token = signToken({ sub: user.id, nickname: user.nickname, provider: user.authProvider }, cfg.jwtSecret, cfg.jwtExpiresDays)
    res.json({ token, user })
  })

  r.post('/wechat', (req, res, next) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const code = typeof body.code === 'string' ? body.code : ''
    loginWithWechat(store, cfg, code)
      .then((user) => {
        const token = signToken({ sub: user.id, nickname: user.nickname, provider: user.authProvider }, cfg.jwtSecret, cfg.jwtExpiresDays)
        res.json({ token, user })
      })
      .catch(next)
  })

  r.get('/me', requireAuth(store, cfg), (req, res) => {
    const { user } = authOf(req)
    res.json({ user })
  })

  r.post('/logout', (_req, res) => {
    // JWT 无状态:登出由客户端丢弃 token;未来如需强制失效可加黑名单
    res.json({ ok: true })
  })

  return r
}
