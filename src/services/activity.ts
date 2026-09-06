import { db } from '@/db/db'
import type { ActivityScore, ActivitySession, NonStrengthSport } from '@/db/models'
import { currentMonthKey, todayStr, uid } from '@/lib/util'

/**
 * 通用运动记录服务(羽毛球等非力量运动)。
 * 与力量训练(services/repo.ts)完全独立,互不干扰;
 * 未来新增运动类型时在此扩展对应统计,不影响现有模块。
 */

export interface ActivityInput {
  sport: NonStrengthSport
  date: string
  startTime?: number
  durationMin?: number
  venue?: string
  playType?: 'singles' | 'doubles'
  partners?: string
  isMatch?: 1
  score?: ActivityScore
  rpe?: number
  notes?: string
}

export async function createActivity(input: ActivityInput): Promise<ActivitySession> {
  if (!input.date) throw new Error('日期不能为空')
  const now = Date.now()
  const session: ActivitySession = {
    id: uid(),
    sport: input.sport,
    date: input.date,
    startTime: input.startTime,
    durationMin: input.durationMin,
    venue: input.venue,
    playType: input.playType,
    partners: input.partners,
    isMatch: input.isMatch,
    score: input.score,
    rpe: input.rpe,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  }
  await db.activitySessions.put(session)
  return session
}

export async function updateActivity(id: string, patch: Partial<ActivityInput>): Promise<void> {
  await db.activitySessions.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteActivity(id: string): Promise<void> {
  await db.activitySessions.delete(id)
}

export async function getActivity(id: string): Promise<ActivitySession | undefined> {
  return db.activitySessions.get(id)
}

/** 按日期范围列出某运动(或全部非力量运动)的记录,倒序 */
export async function listActivities(opts: { sport?: NonStrengthSport; start?: string; end?: string } = {}): Promise<ActivitySession[]> {
  let rows: ActivitySession[]
  if (opts.start && opts.end) {
    rows = await db.activitySessions.where('date').between(opts.start, opts.end, true, true).toArray()
  } else {
    rows = await db.activitySessions.toArray()
  }
  if (opts.sport) rows = rows.filter((r) => r.sport === opts.sport)
  return rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? -1 : 1))
}

/** 某日期范围内的运动记录映射(日历/时间线用) */
export async function getActivityMap(start: string, end: string): Promise<Map<string, ActivitySession[]>> {
  const rows = await listActivities({ start, end })
  const map = new Map<string, ActivitySession[]>()
  for (const r of rows) {
    const arr = map.get(r.date) ?? []
    arr.push(r)
    map.set(r.date, arr)
  }
  return map
}

/* =============== 羽毛球统计(按 sport 参数化,未来运动可复用) =============== */

export interface SportStats {
  totalSessions: number
  totalMinutes: number
  gamesTotal: number
  gamesWon: number
  gamesLost: number
  /** 局胜率(0-100;无对局数据时为 null) */
  gameWinRate: number | null
  /** 场次胜负:局数 胜>负 记为胜场 */
  matchWins: number
  matchLosses: number
  draws: number
  monthSessions: number
  monthMinutes: number
  yearSessions: number
  yearMinutes: number
}

export async function getSportStats(sport: NonStrengthSport): Promise<SportStats> {
  const all = await listActivities({ sport })
  const month = currentMonthKey()
  const year = todayStr().slice(0, 4)
  const stats: SportStats = {
    totalSessions: all.length,
    totalMinutes: 0,
    gamesTotal: 0,
    gamesWon: 0,
    gamesLost: 0,
    gameWinRate: null,
    matchWins: 0,
    matchLosses: 0,
    draws: 0,
    monthSessions: 0,
    monthMinutes: 0,
    yearSessions: 0,
    yearMinutes: 0,
  }
  for (const s of all) {
    stats.totalMinutes += s.durationMin ?? 0
    const g = s.score ?? {}
    stats.gamesTotal += g.gamesTotal ?? 0
    stats.gamesWon += g.gamesWon ?? 0
    stats.gamesLost += g.gamesLost ?? 0
    if ((g.gamesWon ?? 0) > 0 || (g.gamesLost ?? 0) > 0) {
      if ((g.gamesWon ?? 0) > (g.gamesLost ?? 0)) stats.matchWins++
      else if ((g.gamesLost ?? 0) > (g.gamesWon ?? 0)) stats.matchLosses++
      else stats.draws++
    }
    if (s.date.startsWith(month)) {
      stats.monthSessions++
      stats.monthMinutes += s.durationMin ?? 0
    }
    if (s.date.startsWith(year)) {
      stats.yearSessions++
      stats.yearMinutes += s.durationMin ?? 0
    }
  }
  if (stats.gamesWon + stats.gamesLost > 0) {
    stats.gameWinRate = Math.round((stats.gamesWon / (stats.gamesWon + stats.gamesLost)) * 1000) / 10
  }
  return stats
}

/** 最近 N 个月某运动的次数/时长(趋势图用,含当月) */
export async function getSportMonthlyTrend(
  sport: NonStrengthSport,
  months = 6,
): Promise<{ month: string; sessions: number; minutes: number }[]> {
  const out: { month: string; sessions: number; minutes: number }[] = []
  const now = new Date()
  const all = await listActivities({ sport })
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const rows = all.filter((a) => a.date.startsWith(key))
    out.push({
      month: key,
      sessions: rows.length,
      minutes: rows.reduce((acc, r) => acc + (r.durationMin ?? 0), 0),
    })
  }
  return out
}

/** 一个月的运动概览(月报/年报用):按运动类型汇总 */
export interface ActivityOverview {
  count: number
  minutes: number
}

export async function getActivityOverviewForMonths(keys: string[]): Promise<Map<string, ActivityOverview>> {
  const all = await db.activitySessions.toArray()
  const map = new Map<string, ActivityOverview>()
  for (const key of keys) map.set(key, { count: 0, minutes: 0 })
  for (const a of all) {
    const key = a.date.slice(0, 7)
    const row = map.get(key)
    if (row) {
      row.count++
      row.minutes += a.durationMin ?? 0
    }
  }
  return map
}

/** 某运动的记录摘要(历史页/详情展示用) */
export function describeActivity(s: ActivitySession): string {
  const parts: string[] = []
  if (s.sport === 'badminton') {
    if (s.playType) parts.push(s.playType === 'singles' ? '单打' : '双打')
    const g = s.score ?? {}
    if ((g.gamesTotal ?? 0) > 0) {
      parts.push(`${g.gamesTotal}局`)
      if ((g.gamesWon ?? 0) > 0 || (g.gamesLost ?? 0) > 0) parts.push(`胜${g.gamesWon ?? 0}负${g.gamesLost ?? 0}`)
    }
  }
  if (s.durationMin) parts.push(`${s.durationMin}分钟`)
  if (s.venue) parts.push(s.venue)
  return parts.join(' · ')
}
