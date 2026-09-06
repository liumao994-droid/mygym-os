import { db, getAppState, setAppState } from '@/db/db'
import type { MonthlyReport, YearlyReport } from './reports'

/**
 * AI 分析服务(接口预留)
 *
 * 成本控制原则:
 * - 基础统计(1RM / PR / 容量 / 分布)全部本地计算,AI 不参与
 * - 只在用户主动点击「AI 深度分析」时调用,结果缓存到 aiAnalyses 表
 * - 未配置 API Key 时显示引导而不是报错
 * - 用户提供自己的 OpenAI 兼容接口配置(OpenAI / DeepSeek / Claude 中转等)
 */

export interface AIConfig {
  enabled: boolean
  baseURL: string
  apiKey: string
  model: string
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

export async function getAIConfig(): Promise<AIConfig> {
  return getAppState<AIConfig>('aiConfig', DEFAULT_AI_CONFIG)
}

export async function saveAIConfig(cfg: AIConfig): Promise<void> {
  await setAppState('aiConfig', cfg)
}

const SYSTEM_PROMPT = `你是一位专业的训练数据分析助手。你会收到一份从用户训练数据库中提取的结构化 JSON 统计数据。
要求:
1. 所有数字必须来自提供的数据,禁止编造任何数据或进步幅度。
2. 数据不足时明确说明"数据不足",不要强行下结论。
3. 不提供医疗建议,不假装是教练下命令,语气客观友好。
4. 用简体中文输出,使用以下结构的小节:训练概况 / 力量变化 / 训练规律 / 值得关注的动作 / 下期观察方向。
5. 总长度控制在 400 字以内。`

function buildMonthlyPrompt(report: MonthlyReport): string {
  return `以下是 ${report.month} 的月度训练统计 JSON:
${JSON.stringify(
  {
    summary: report.summary,
    weeklyBars: report.weeklyBars,
    parts: report.parts.map((p) => ({ name: p.name, sessions: p.sessions, sets: p.sets, volume: p.volume })),
    podium: report.podium.map((p) => ({
      exercise: p.exerciseName,
      thisMonth: `${p.thisMonth.weight}kg×${p.thisMonth.reps}`,
      lastMonth: `${p.lastMonth.weight}kg×${p.lastMonth.reps}`,
      est1rmDelta: `${Math.round((p.thisMonth.est1rm - p.lastMonth.est1rm) * 10) / 10}kg`,
      pct: p.pctChange,
    })),
    monthPRs: report.monthPRs.map((p) => ({ exercise: p.exerciseName, best: `${p.weight}kg×${p.reps}` })),
    balance: report.balance,
  },
  null,
  1,
)}`
}

function buildYearlyPrompt(report: YearlyReport): string {
  return `以下是 ${report.year} 年的年度训练统计 JSON:
${JSON.stringify(
  {
    totalSessions: report.totalSessions,
    totalSets: report.totalSets,
    totalVolume: report.totalVolume,
    monthlySessions: report.monthlySessions,
    mostTrainedPart: report.mostTrainedPart,
    prCount: report.prCount,
    topProgress: report.topProgress,
    parts: report.topPartDistribution.map((p) => ({ name: p.name, sessions: p.sessions })),
  },
  null,
  1,
)}`
}

export type AIReportKind = 'month' | 'year'

export async function generateAIAnalysis(
  kind: AIReportKind,
  period: string,
  report: MonthlyReport | YearlyReport,
): Promise<string> {
  const cfg = await getAIConfig()
  if (!cfg.enabled || !cfg.apiKey) {
    throw new Error('AI_NOT_CONFIGURED')
  }
  const cacheId = `${kind}:${period}`
  const cached = await db.aiAnalyses.get(cacheId)
  if (cached) {
    // 月报随数据变化,缓存 7 天;年报缓存 30 天
    const maxAge = kind === 'month' ? 7 * 86400000 : 30 * 86400000
    if (Date.now() - cached.createdAt < maxAge) return cached.content
  }

  const prompt = kind === 'month' ? buildMonthlyPrompt(report as MonthlyReport) : buildYearlyPrompt(report as YearlyReport)

  const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI 接口返回 ${res.status}:${text.slice(0, 200)}`)
  }
  const json = await res.json()
  const content: string | undefined = json?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 返回内容为空')

  await db.aiAnalyses.put({
    id: cacheId,
    kind,
    period,
    content,
    model: cfg.model,
    createdAt: Date.now(),
  })
  return content
}

export async function getCachedAIAnalysis(kind: AIReportKind, period: string): Promise<string | null> {
  const cached = await db.aiAnalyses.get(`${kind}:${period}`)
  return cached?.content ?? null
}
