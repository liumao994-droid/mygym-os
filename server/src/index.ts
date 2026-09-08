import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { pathToFileURL } from 'node:url'
import { loadConfig, type AppConfig } from './config.js'
import { Store } from './db/sqlite.js'
import { HttpError } from './auth.js'
import { authRoutes } from './routes/auth.js'
import { dataRoutes } from './routes/data.js'
import { syncRoutes } from './routes/sync.js'
import { aiRoutes } from './routes/ai.js'
import { loadEnvFile } from './envfile.js'

/**
 * MyGym API 服务入口。
 * Web 与未来微信小程序共用同一套 REST 契约与数据逻辑。
 */

export function createApp(cfg: AppConfig, store: Store): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  // CORS:小程序等非浏览器客户端不带 Origin,天然放行;浏览器来源按白名单校验
  const corsOptions: cors.CorsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error('CORS_NOT_ALLOWED'))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }
  app.use(cors(corsOptions))

  // 导入接口允许大载荷,其余接口 1mb
  app.use('/api/data/import', express.json({ limit: cfg.maxImportBytes }))
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'mygym-api', version: cfg.version, ai: { enabled: Boolean(cfg.ai.baseUrl && cfg.ai.apiKey) } })
  })

  app.use('/api/auth', authRoutes(store, cfg))
  app.use('/api/data', syncRoutes(store, cfg))
  app.use('/api/ai', aiRoutes(store, cfg))
  app.use('/api', dataRoutes(store, cfg))

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' })
  })

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message })
      return
    }
    const e = err as { type?: string; message?: string; status?: number }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'INVALID_JSON', message: '请求体不是有效的 JSON' })
      return
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: '请求体过大' })
      return
    }
    if (e?.message === 'CORS_NOT_ALLOWED') {
      res.status(403).json({ error: 'CORS_NOT_ALLOWED', message: '该来源不被允许' })
      return
    }
    console.error('[mygym-api] unhandled error:', err)
    res.status(500).json({ error: 'INTERNAL', message: '服务器内部错误' })
  })

  return app
}

/** 开发/生产启动:环境变量配置;测试使用 createApp 直接构造(见 test/) */
function main(): void {
  loadEnvFile()
  const cfg = loadConfig()
  const store = new Store(cfg.dbFile)
  const app = createApp(cfg, store)
  app.listen(cfg.port, cfg.host, () => {
    console.log(`[mygym-api] listening on http://${cfg.host}:${cfg.port} (db: ${cfg.dbFile})`)
    console.log(`[mygym-api] devAuth=${cfg.devAuthEnabled ? 'on' : 'off'} ai=${cfg.ai.baseUrl && cfg.ai.apiKey ? 'configured' : 'not-configured'} limits=${cfg.ai.dailyLimit}/day, ${cfg.ai.monthlyLimit}/month`)
    if (cfg.allowedOrigins[0] === '*') {
      console.warn('[mygym-api] CORS 允许所有来源(开发默认);生产环境请设置 ALLOWED_ORIGINS')
    }
  })
}

const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  main()
}
