import { Router, type NextFunction, type Request, type Response } from 'express'
import type { AppConfig } from '../config.js'
import { aiConfigured } from '../config.js'
import type { Store } from '../db/sqlite.js'
import { requireAuth, authOf, HttpError } from '../auth.js'
import { chatCompletion, ProviderError } from '../ai/provider.js'

/**
 * AI 深度分析(后端代理):
 *   客户端 → POST /api/ai/training-summary(结构化统计摘要)
 *          → 服务端验证身份 → 检查/预扣额度 → 调用 AI Provider(服务端持有 Key)
 *          → 成功后落缓存并返回。
 *
 * 成本控制:
 * - 额度按用户按 天/月 计数,原子预扣(防并发突发),Provider 失败自动返还;
 * - 结果按 kind+period 缓存(月 7 天 / 年 30 天),命中缓存不消耗额度;
 * - 请求体大小由 express.json 上限约束,stats 摘要另有独立字符数上限;
 * - 所有上限来自环境变量(AI_DAILY_LIMIT / AI_MONTHLY_LIMIT),未来管理员可调。
 */

const SYSTEM_PROMPT = `你是一位专业的训练数据分析助手。你会收到一份从用户训练数据库中提取的结构化 JSON 统计数据。
要求:
1. 所有数字必须来自提供的数据,禁止编造任何数据或进步幅度。
2. 数据不足时明确说明"数据不足",不要强行下结论。
3. 不提供医疗建议,不假装是教练下命令,语气客观友好。
4. 用简体中文输出,使用以下结构的小节:训练概况 / 力量变化 / 训练规律 / 值得关注的动作 / 下期观察方向。
5. 总长度控制在 400 字以内。`

/** stats 摘要的独立上限(字符数);整体请求体另由 body parser 限制 */
const MAX_STATS_CHARS = 200_000

const CACHE_TTL_MS: Record<'month' | 'year', number> = { month: 7 * 86400000, year: 30 * 86400000 }

/** Express 4 不自动捕获 async 错误,统一包装 */
function asyncH(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next)
  }
}

function localPeriods(): { day: string; month: string } {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
  }
}

function usageOf(store: Store, userId: string): { dailyUsed: number; monthlyUsed: number } {
  const { day, month } = localPeriods()
  const d = store.get('SELECT count FROM ai_usage WHERE user_id = ? AND period_type = ? AND period = ?', userId, 'day', day)
  const m = store.get('SELECT count FROM ai_usage WHERE user_id = ? AND period_type = ? AND period = ?', userId, 'month', month)
  return { dailyUsed: Number(d?.count ?? 0), monthlyUsed: Number(m?.count ?? 0) }
}

export function quotaPayload(cfg: AppConfig, store: Store, userId: string) {
  const { dailyUsed, monthlyUsed } = usageOf(store, userId)
  return {
    enabled: aiConfigured(cfg),
    daily: { used: dailyUsed, limit: cfg.ai.dailyLimit, remaining: Math.max(0, cfg.ai.dailyLimit - dailyUsed) },
    monthly: { used: monthlyUsed, limit: cfg.ai.monthlyLimit, remaining: Math.max(0, cfg.ai.monthlyLimit - monthlyUsed) },
  }
}

/** 原子预扣今日 + 本月额度;任一不足则返还已扣部分并返回 false */
function reserveQuota(store: Store, userId: string, cfg: AppConfig): boolean {
  const { day, month } = localPeriods()
  store.run('INSERT OR IGNORE INTO ai_usage (user_id, period_type, period, count) VALUES (?, ?, ?, 0)', userId, 'day', day)
  const d = store.run(
    'UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND period_type = ? AND period = ? AND count < ?',
    userId,
    'day',
    day,
    cfg.ai.dailyLimit,
  )
  if (Number(d.changes) === 0) return false
  store.run('INSERT OR IGNORE INTO ai_usage (user_id, period_type, period, count) VALUES (?, ?, ?, 0)', userId, 'month', month)
  const m = store.run(
    'UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND period_type = ? AND period = ? AND count < ?',
    userId,
    'month',
    month,
    cfg.ai.monthlyLimit,
  )
  if (Number(m.changes) === 0) {
    store.run('UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND period_type = ? AND period = ?', userId, 'day', day)
    return false
  }
  return true
}

function refundQuota(store: Store, userId: string): void {
  store.run("UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND period_type = 'day'", userId)
  store.run("UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND period_type = 'month'", userId)
}

export function aiRoutes(store: Store, cfg: AppConfig): Router {
  const r = Router()
  r.use(requireAuth(store, cfg))

  r.get('/quota', (req, res) => {
    const { userId } = authOf(req)
    res.json(quotaPayload(cfg, store, userId))
  })

  r.post(
    '/training-summary',
    asyncH(async (req, res) => {
      const { userId } = authOf(req)
      if (!aiConfigured(cfg)) {
        throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI 服务尚未配置,请联系服务维护者')
      }
      const body = req.body as { kind?: unknown; period?: unknown; stats?: unknown }
      const kind = body?.kind
      if (kind !== 'month' && kind !== 'year') throw new HttpError(400, 'INVALID_REQUEST', 'kind 必须为 month 或 year')
      const period = typeof body?.period === 'string' ? body.period : ''
      const valid = kind === 'month' ? /^\d{4}-\d{2}$/.test(period) : /^\d{4}$/.test(period)
      if (!valid) throw new HttpError(400, 'INVALID_REQUEST', kind === 'month' ? 'period 必须为 YYYY-MM' : 'period 必须为 YYYY')
      if (typeof body?.stats !== 'object' || body?.stats === null) {
        throw new HttpError(400, 'INVALID_REQUEST', '缺少结构化统计数据')
      }
      const statsJson = JSON.stringify(body.stats)
      if (statsJson.length > MAX_STATS_CHARS) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '统计数据过大')

      const cacheId = `${userId}:${kind}:${period}`
      const cached = store.get('SELECT content, model, created_at FROM ai_analyses WHERE id = ?', cacheId)
      if (cached && Date.now() - Number(cached.created_at) < CACHE_TTL_MS[kind]) {
        res.json({ content: cached.content, model: cached.model, cached: true, quota: quotaPayload(cfg, store, userId) })
        return
      }

      if (!reserveQuota(store, userId, cfg)) {
        res.status(429).json({
          error: 'AI_QUOTA_EXCEEDED',
          message: 'AI 分析次数已用完,下个周期自动恢复',
          quota: quotaPayload(cfg, store, userId),
        })
        return
      }

      const periodLabel = kind === 'month' ? `${period.slice(0, 4)} 年 ${period.slice(5)} 月` : `${period} 年`
      const userPrompt = `以下是 ${periodLabel} 的${kind === 'month' ? '月度' : '年度'}训练统计 JSON:\n${statsJson}`

      let content: string
      try {
        const out = await chatCompletion({
          baseUrl: cfg.ai.baseUrl,
          apiKey: cfg.ai.apiKey,
          model: cfg.ai.model,
          system: SYSTEM_PROMPT,
          user: userPrompt,
          timeoutMs: cfg.ai.timeoutMs,
        })
        content = out.content
      } catch (e) {
        // Provider 失败不消耗额度
        refundQuota(store, userId)
        if (e instanceof ProviderError) {
          throw new HttpError(e.code === 'AI_TIMEOUT' ? 504 : 502, e.code, e.message)
        }
        throw new HttpError(502, 'AI_PROVIDER_ERROR', 'AI 服务暂时不可用')
      }

      const now = Date.now()
      store.run(
        `INSERT INTO ai_analyses (id, user_id, kind, period, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at`,
        cacheId,
        userId,
        kind,
        period,
        content,
        cfg.ai.model,
        now,
      )
      res.json({ content, model: cfg.ai.model, cached: false, quota: quotaPayload(cfg, store, userId) })
    }),
  )

  return r
}
