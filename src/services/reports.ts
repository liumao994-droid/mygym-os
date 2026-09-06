import { db } from '@/db/db'
import { addDays, fmtMonthCN, fmtNum, parseLocalDate, toLocalDate } from '@/lib/util'
import { estimate1RM, setVolume } from './calc'
import { getActivityOverviewForMonths } from './activity'
import type { NonStrengthSport } from '@/db/models'
import {
  countSummary,
  getMonthPRs,
  getMonthProgress,
  getPartDistribution,
  type MonthProgress,
  type PartDistribution,
} from './stats'

/**
 * 报告服务:月度报告 / 年度报告。
 * 所有数字来自数据库;叙述文字基于规则模板生成,措辞克制;
 * AI 深度分析为可选项(services/ai.ts),只在用户主动触发时调用并缓存。
 */

export interface MonthlyReport {
  month: string
  summary: {
    trained: number
    rest: number
    unrecorded: number
    totalExercises: number
    totalSets: number
    totalVolume: number
    weeklyAvg: number
    avgExercisesPerSession: number
    avgSetsPerSession: number
  }
  weeklyBars: { label: string; sessions: number; volume: number }[]
  parts: PartDistribution[]
  podium: MonthProgress[]
  monthPRs: {
    exerciseId: string
    exerciseName: string
    weight: number
    reps: number
    type: string
    date: string
  }[]
  balance: {
    most: { name: string; count: number } | null
    least: { name: string; count: number } | null
  }
  performanceText: string[]
  focusText: string[]
  /** 运动概览:本月非力量运动(羽毛球/游泳等,按类型细分) */
  activity: { count: number; minutes: number; bySport: Partial<Record<NonStrengthSport, { count: number; minutes: number }>> }
}

export async function buildMonthlyReport(key: string): Promise<MonthlyReport> {
  const [y, m] = key.split('-').map(Number)
  const start = `${key}-01`
  const end = toLocalDate(new Date(y, m, 0))
  const isCurrent = key === toLocalDate(new Date()).slice(0, 7)

  const counts = await countSummary(start, end)
  const parts = await getPartDistribution(start, end)
  const prevKey = addDays(start, -1).slice(0, 7)
  const [progress, monthPRs] = await Promise.all([getMonthProgress(key, prevKey), getMonthPRs(key)])

  // 周分布
  const weeklyBars: MonthlyReport['weeklyBars'] = []
  const daysInMonth = new Date(y, m, 0).getDate()
  const sessions = await db.sessions
    .where('date')
    .between(start, end, true, true)
    .and((s) => s.status === 'completed')
    .toArray()
  const completedSessionIds = new Set(sessions.map((s) => s.id))
  const monthSets = (await db.sets.where('date').between(start, end, true, true).toArray()).filter((s) =>
    completedSessionIds.has(s.sessionId),
  )
  const volumeByDate = new Map<string, number>()
  for (const s of monthSets) volumeByDate.set(s.date, (volumeByDate.get(s.date) ?? 0) + setVolume(s))
  for (let w = 0; w * 7 < daysInMonth; w++) {
    const ws = w * 7 + 1
    const we = Math.min(ws + 6, daysInMonth)
    const dstr = (d: number) => `${key}-${String(d).padStart(2, '0')}`
    weeklyBars.push({
      label: `第${w + 1}周`,
      sessions: sessions.filter((s) => {
        const day = parseLocalDate(s.date).getDate()
        return day >= ws && day <= we
      }).length,
      volume: Math.round(
        Array.from({ length: we - ws + 1 }, (_, i) => volumeByDate.get(dstr(ws + i)) ?? 0).reduce((a, b) => a + b, 0),
      ),
    })
  }

  // 平衡分析:按会话次数
  const sorted = [...parts].sort((a, b) => b.sessions - a.sessions)
  const most = sorted[0].sessions > 0 ? { name: sorted[0].name, count: sorted[0].sessions } : null
  const least = sorted.at(-1)! // 六部位固定,least 总存在

  // 叙述
  const performanceText: string[] = []
  const topParts = sorted.filter((p) => p.sessions > 0).slice(0, 2)
  if (counts.sessions === 0) {
    performanceText.push('这个月还没有训练记录。从一个动作开始就好。')
  } else {
    performanceText.push(
      `本月训练 ${counts.sessions} 天,共 ${counts.totalSets} 组、${fmtNum(counts.volume)}kg 训练量。` +
        (topParts.length ? `从记录来看,${topParts.map((p) => `${p.name}部`).join('、')}训练频率较高。` : ''),
    )
    if (podiumTop(progress)) {
      performanceText.push(
        `${podiumTop(progress)!.exerciseName}相比上月出现明显进步(${signedKg(podiumTop(progress)!.weightDelta)}),值得肯定。`,
      )
    } else if (counts.sessions >= 3) {
      performanceText.push('本月整体训练保持稳定,多数动作处于积累阶段。')
    }
    if (counts.rests > 0) performanceText.push(`其中主动休息 ${counts.rests} 天——休息也是训练的一部分。`)
  }

  // 下月关注
  const focusText: string[] = []
  if (counts.sessions === 0) {
    focusText.push('先从一次 30 分钟的简单训练开始,建立记录习惯。')
  } else {
    if (least.sessions <= Math.max(1, Math.floor(most?.count ?? 0) / 3) || least.sessions === 0) {
      focusText.push(`从记录来看,${least.name}部训练次数较少(${least.sessions} 次),下个月可以多安排一两次。`)
    }
    const plateau = progress.filter((p) => Math.abs(p.weightDelta) < 0.01).slice(0, 2)
    for (const p of plateau) {
      focusText.push(`${p.exerciseName}最近表现比较稳定,可以继续观察后续变化,或尝试小幅加重。`)
    }
    if (counts.unrecorded > counts.sessions && counts.unrecorded > 6 && isCurrent === false) {
      focusText.push('有不少日子没有记录,哪怕休息也可以标记一下,数据会更完整。')
    }
  }

  // 运动概览(与力量统计完全分开计算)
  const activityOverview =
    (await getActivityOverviewForMonths([key])).get(key) ?? { count: 0, minutes: 0, bySport: {} }

  return {
    month: key,
    activity: activityOverview,
    summary: {
      trained: counts.sessions,
      rest: counts.rests,
      unrecorded: counts.unrecorded,
      totalExercises: counts.totalExercises,
      totalSets: counts.totalSets,
      totalVolume: counts.volume,
      weeklyAvg: counts.sessions / 4.345,
      avgExercisesPerSession: counts.sessions ? counts.totalExercises / counts.sessions : 0,
      avgSetsPerSession: counts.sessions ? counts.totalSets / counts.sessions : 0,
    },
    weeklyBars,
    parts,
    podium: progress.slice(0, 3),
    monthPRs,
    balance: { most, least: { name: least.name, count: least.sessions } },
    performanceText: performanceText.filter(Boolean),
    focusText: focusText.filter(Boolean),
  }
}

function podiumTop(progress: MonthProgress[]): MonthProgress | null {
  const meaningful = progress.filter((p) => p.weightDelta > 0)
  return meaningful[0] ?? null
}

function signedKg(n: number): string {
  return `${n > 0 ? '+' : ''}${fmtNum(n)}kg`
}

/* =============== 年度报告 =============== */

export interface YearlyReport {
  year: number
  totalSessions: number
  totalSets: number
  totalVolume: number
  restDays: number
  mostTrainedPart: { name: string; count: number } | null
  monthlySessions: { month: string; sessions: number }[]
  prCount: number
  topProgress: { exerciseName: string; start: string; end: string; delta: number; pct: number }[]
  topPartDistribution: PartDistribution[]
  /** 年度非力量运动概览(按类型细分) */
  activity: { count: number; minutes: number; bySport: Partial<Record<NonStrengthSport, { count: number; minutes: number }>> }
  dayOfYear: number
  hasData: boolean
}

export async function buildYearlyReport(year: number): Promise<YearlyReport> {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const counts = await countSummary(start, end)
  const parts = await getPartDistribution(start, end)
  const prEvents = await db.prEvents.where('date').between(start, end, true, true).toArray()

  const monthlySessions: { month: string; sessions: number }[] = []
  const sessions = await db.sessions
    .where('date')
    .between(start, end, true, true)
    .and((s) => s.status === 'completed')
    .toArray()
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    monthlySessions.push({ month: key, sessions: sessions.filter((s) => s.date.startsWith(key)).length })
  }

  // 年初 vs 年末:各动作 1月最佳 vs 12月最佳(估算1RM)
  const topProgress: YearlyReport['topProgress'] = []
  const completedSessionIds = new Set(sessions.map((s) => s.id))
  const allSets = (await db.sets.where('date').between(start, end, true, true).toArray()).filter((s) =>
    completedSessionIds.has(s.sessionId),
  )
  const exMap = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  const bestByMonthByEx = new Map<string, Map<string, { est: number; w: number; r: number }>>()
  for (const s of allSets) {
    if (s.weightType !== 'weight' && s.weightType !== 'dumbbell') continue
    const est = estimate1RM(s.weight, s.reps)
    if (est === null) continue
    const mk = s.date.slice(0, 7)
    const byMonth = bestByMonthByEx.get(s.exerciseId) ?? new Map()
    const cur = byMonth.get(mk)
    if (!cur || est > cur.est) byMonth.set(mk, { est, w: s.weight, r: s.reps })
    bestByMonthByEx.set(s.exerciseId, byMonth)
  }
  for (const [eid, byMonth] of bestByMonthByEx) {
    const first = byMonth.get(`${year}-01`) ?? [...byMonth.entries()].filter(([k]) => k <= `${year}-03`).at(-1)?.[1]
    const last = byMonth.get(`${year}-12`) ?? [...byMonth.entries()].filter(([k]) => k >= `${year}-10`).at(-1)?.[1]
    if (!first || !last || !first.est) continue
    const delta = Math.round((last.w - first.w) * 10) / 10
    const pct = Math.round(((last.est - first.est) / first.est) * 1000) / 10
    topProgress.push({
      exerciseName: exMap.get(eid)?.name ?? '',
      start: `${fmtNum(first.w)}kg × ${first.r}`,
      end: `${fmtNum(last.w)}kg × ${last.r}`,
      delta,
      pct,
    })
  }
  topProgress.sort((a, b) => b.delta - a.delta)

  const sortedParts = [...parts].sort((a, b) => b.sessions - a.sessions)
  const mostTrainedPart = sortedParts[0].sessions > 0 ? { name: sortedParts[0].name, count: sortedParts[0].sessions } : null
  const now = new Date()
  const dayOfYear = Math.ceil((now.getTime() - new Date(year, 0, 1).getTime()) / 86400000)

  const monthKeys: string[] = []
  for (let m = 1; m <= 12; m++) monthKeys.push(`${year}-${String(m).padStart(2, '0')}`)
  const activityOverview = await getActivityOverviewForMonths(monthKeys)
  const bySport: Partial<Record<NonStrengthSport, { count: number; minutes: number }>> = {}
  let activityCount = 0
  let activityMinutes = 0
  for (const v of activityOverview.values()) {
    activityCount += v.count
    activityMinutes += v.minutes
    for (const sp of Object.keys(v.bySport) as NonStrengthSport[]) {
      const per = v.bySport[sp]
      if (!per) continue
      const agg = bySport[sp] ?? { count: 0, minutes: 0 }
      agg.count += per.count
      agg.minutes += per.minutes
      bySport[sp] = agg
    }
  }
  const activity = { count: activityCount, minutes: activityMinutes, bySport }

  return {
    year,
    activity,
    totalSessions: counts.sessions,
    totalSets: counts.totalSets,
    totalVolume: counts.volume,
    restDays: counts.rests,
    mostTrainedPart,
    monthlySessions,
    prCount: prEvents.filter((e) => e.type !== 'volume').length,
    topProgress: topProgress.slice(0, 6),
    topPartDistribution: parts,
    dayOfYear,
    hasData: counts.sessions > 0,
  }
}

/** 报告月份列表(报告历史):力量 + 运动记录 + 休息日都纳入 */
export async function getReportMonths(): Promise<string[]> {
  const months = new Set<string>()
  await db.sessions.each((s) => {
    if (s.status === 'completed') months.add(s.date.slice(0, 7))
  })
  await db.activitySessions.each((a) => months.add(a.date.slice(0, 7)))
  await db.dailyStatuses.each((r) => months.add(r.date.slice(0, 7)))
  // 至少包含当前月
  months.add(toLocalDate(new Date()).slice(0, 7))
  return [...months].sort().reverse()
}

export function monthLabel(key: string): string {
  return `${fmtMonthCN(key)}训练报告`
}
