import { randomBytes } from 'node:crypto'

/**
 * 服务端配置 —— 全部来自环境变量,绝不写入代码或前端。
 * 参考 server/.env.example;生产环境必须显式设置 JWT_SECRET 与 AI_*。
 */

export interface AppConfig {
  isProduction: boolean
  port: number
  host: string
  dbFile: string
  jwtSecret: string
  jwtExpiresDays: number
  /** 开发/测试登录开关;生产环境(接入微信等正式认证后)必须关闭 */
  devAuthEnabled: boolean
  /** 允许的跨域来源,逗号分隔;'*' 表示全部(仅限开发) */
  allowedOrigins: string[]
  ai: {
    baseUrl: string
    apiKey: string
    model: string
    timeoutMs: number
    dailyLimit: number
    monthlyLimit: number
  }
  wechat: {
    appId: string
    appSecret: string
    /** 仅测试注入用；生产使用微信官方固定地址 */
    code2sessionUrl: string
  }
  maxImportBytes: string
  version: string
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production'
  let jwtSecret = env.JWT_SECRET ?? ''
  if (!jwtSecret) {
    if (isProd) {
      throw new Error('生产环境必须设置 JWT_SECRET 环境变量')
    }
    // 开发环境:临时随机 secret(重启后旧 token 失效,无安全风险)
    jwtSecret = randomBytes(32).toString('hex')
  }
  const aiKey = env.AI_API_KEY ?? ''
  const aiBase = (env.AI_API_BASE_URL ?? '').replace(/\/+$/, '')
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (isProd && allowedOrigins.includes('*')) {
    throw new Error('生产环境必须设置明确的 ALLOWED_ORIGINS，不能使用 *')
  }
  return {
    isProduction: isProd,
    port: intEnv(env, 'PORT', 8787),
    host: env.HOST ?? '127.0.0.1',
    dbFile: env.DB_FILE ?? 'server-data/mygym.db',
    jwtSecret,
    jwtExpiresDays: intEnv(env, 'JWT_EXPIRES_DAYS', 30),
    // dev 登录只能用于非生产环境；即使生产环境误设为 true 也强制关闭。
    devAuthEnabled: !isProd && (env.DEV_AUTH_ENABLED ?? 'true') !== 'false',
    allowedOrigins,
    ai: {
      baseUrl: aiBase,
      apiKey: aiKey,
      model: env.AI_MODEL ?? 'gpt-4o-mini',
      timeoutMs: intEnv(env, 'AI_REQUEST_TIMEOUT_MS', 60000),
      dailyLimit: intEnv(env, 'AI_DAILY_LIMIT', 3),
      monthlyLimit: intEnv(env, 'AI_MONTHLY_LIMIT', 10),
    },
    wechat: {
      appId: env.WECHAT_APP_ID ?? '',
      appSecret: env.WECHAT_APP_SECRET ?? '',
      code2sessionUrl: env.WECHAT_CODE2SESSION_URL ?? 'https://api.weixin.qq.com/sns/jscode2session',
    },
    maxImportBytes: env.MAX_IMPORT_BYTES ?? '25mb',
    version: '0.1.0',
  }
}

export function aiConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.ai.baseUrl && cfg.ai.apiKey && cfg.ai.model)
}

export function wechatConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.wechat.appId && cfg.wechat.appSecret && cfg.wechat.code2sessionUrl)
}
