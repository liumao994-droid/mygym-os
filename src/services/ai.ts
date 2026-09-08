import { db } from '@/db/db'
import { api, isApiError } from '@/services/api'
import type { MonthlyReport, YearlyReport } from './reports'

/** 基础统计在本地计算；Provider Key 仅存后端，且由服务端控制额度与缓存。 */
function monthlyStats(report: MonthlyReport): Record<string, unknown> {
  return {
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
  }
}

function yearlyStats(report: YearlyReport): Record<string, unknown> {
  return {
    totalSessions: report.totalSessions,
    totalSets: report.totalSets,
    totalVolume: report.totalVolume,
    monthlySessions: report.monthlySessions,
    mostTrainedPart: report.mostTrainedPart,
    prCount: report.prCount,
    topProgress: report.topProgress,
    parts: report.topPartDistribution.map((p) => ({ name: p.name, sessions: p.sessions })),
  }
}

export type AIReportKind = 'month' | 'year'

export async function generateAIAnalysis(kind: AIReportKind, period: string, report: MonthlyReport | YearlyReport): Promise<string> {
  const cacheId = `${kind}:${period}`
  const cached = await db.aiAnalyses.get(cacheId)
  if (cached) {
    const maxAge = kind === 'month' ? 7 * 86400000 : 30 * 86400000
    if (Date.now() - cached.createdAt < maxAge) return cached.content
  }

  let response
  try {
    response = await api.aiTrainingSummary({
      kind,
      period,
      stats: kind === 'month' ? monthlyStats(report as MonthlyReport) : yearlyStats(report as YearlyReport),
    })
  } catch (error) {
    if (isApiError(error)) throw new Error(error.code)
    throw error
  }
  await db.aiAnalyses.put({
    id: cacheId,
    kind,
    period,
    content: response.content,
    model: response.model ?? 'server',
    createdAt: Date.now(),
  })
  return response.content
}

export async function getCachedAIAnalysis(kind: AIReportKind, period: string): Promise<string | null> {
  return (await db.aiAnalyses.get(`${kind}:${period}`))?.content ?? null
}
