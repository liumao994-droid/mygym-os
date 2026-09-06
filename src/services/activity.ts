import { db } from '@/db/db'
import type { ActivityScore, ActivitySession, DistanceUnit, NonStrengthSport, StrokeType } from '@/db/models'
import { STROKE_LABEL } from '@/db/models'
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
  /* ---- 游泳 ---- */
  distanceM?: number
  distanceUnit?: DistanceUnit
  stroke?: StrokeType
  poolLengthM?: number
  laps?: number
  calories?: number
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
    /* ---- 游泳 ---- */
    distanceM: input.distanceM,
    distanceUnit: input.distanceUnit,
    stroke: input.stroke,
    poolLengthM: input.poolLengthM,
    laps: input.laps,
    calories: input.calories,
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
  bySport: Partial<Record<NonStrengthSport, { count: number; minutes: number }>>
}

export async function getActivityOverviewForMonths(keys: string[]): Promise<Map<string, ActivityOverview>> {
  const all = await db.activitySessions.toArray()
  const map = new Map<string, ActivityOverview>()
  for (const key of keys) map.set(key, { count: 0, minutes: 0, bySport: {} })
  for (const a of all) {
    const key = a.date.slice(0, 7)
    const row = map.get(key)
    if (!row) continue
    row.count++
    row.minutes += a.durationMin ?? 0
    const per = row.bySport[a.sport] ?? { count: 0, minutes: 0 }
    per.count++
    per.minutes += a.durationMin ?? 0
    row.bySport[a.sport] = per
  }
  return map
}

/** 各运动的摘要渲染器(新增运动在此注册一项;通用字段在外层统一拼接) */
const ACTIVITY_PREVIEW: Partial<Record<NonStrengthSport, (s: ActivitySession) => string | undefined>> = {
  badminton: (s) => {
    const parts: string[] = []
    if (s.playType) parts.push(s.playType === 'singles' ? '单打' : '双打')
    const g = s.score ?? {}
    if ((g.gamesTotal ?? 0) > 0) {
      parts.push(`${g.gamesTotal}局`)
      if ((g.gamesWon ?? 0) > 0 || (g.gamesLost ?? 0) > 0) parts.push(`胜${g.gamesWon ?? 0}负${g.gamesLost ?? 0}`)
    }
    return parts.length ? parts.join(' · ') : undefined
  },
  swimming: (s) => {
    const sw = swimSummary(s)
    return sw || undefined
  },
}

/** 某运动的记录摘要(历史页/详情展示用) */
export function describeActivity(s: ActivitySession): string {
  const parts: string[] = []
  const sportPart = ACTIVITY_PREVIEW[s.sport]?.(s)
  if (sportPart) parts.push(sportPart)
  if (s.durationMin) parts.push(`${s.durationMin}分钟`)
  if (s.venue) parts.push(s.venue)
  return parts.join(' · ')
}

/* =============== 游泳 =============== */

/** 由时长(分钟)与距离(米)计算平均配速(秒/100m);数据不足返回 null */
export function calcPaceSecPer100m(durationMin?: number, distanceM?: number): number | null {
  if (!durationMin || durationMin <= 0 || !distanceM || distanceM <= 0) return null
  return Math.round((durationMin * 60 * 100) / distanceM)
}

/** 配速秒/100m → 「1'45"」显示;unit=mi 时换算为 秒/英里 */
export function formatPace(secPer100m: number | null | undefined, unit: DistanceUnit = 'm'): string {
  if (!secPer100m || secPer100m <= 0) return '—'
  const sec = unit === 'mi' ? secPer100m * (1609.344 / 100) : secPer100m
  const m = Math.floor(sec / 60)
  const r = Math.round(sec % 60)
  return `${m}'${String(r).padStart(2, '0')}"`
}

/** 距离显示:米(≥1000 显示 km)或英里 */
export function formatDistance(distanceM: number | undefined, unit: DistanceUnit = 'm'): string {
  if (!distanceM || distanceM <= 0) return '—'
  if (unit === 'mi') return `${(distanceM / 1609.344).toFixed(2)} mi`
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(distanceM % 1000 === 0 ? 0 : 2)} km` : `${Math.round(distanceM)} m`
}

/** 单条游泳记录摘要 */
export function swimSummary(s: ActivitySession): string {
  const parts: string[] = []
  if (s.stroke) parts.push(STROKE_LABEL[s.stroke as StrokeType] ?? '其他')
  if (s.distanceM) parts.push(formatDistance(s.distanceM, s.distanceUnit ?? 'm'))
  if (s.durationMin && s.distanceM) {
    const pace = calcPaceSecPer100m(s.durationMin, s.distanceM)
    if (pace) parts.push(`配速 ${formatPace(pace, s.distanceUnit ?? 'm')}/100m`)
  }
  return parts.join(' · ')
}

/** 各泳姿次数与距离分布 */
export async function getSwimStrokeDistribution(
  sport: 'swimming',
): Promise<{ stroke: StrokeType | 'unset'; count: number; distanceM: number }[]> {
  const all = await listActivities({ sport })
  const map = new Map<string, { count: number; distanceM: number }>()
  for (const a of all) {
    const key = (a.stroke as StrokeType) ?? 'unset'
    const row = map.get(key) ?? { count: 0, distanceM: 0 }
    row.count++
    row.distanceM += a.distanceM ?? 0
    map.set(key, row)
  }
  return [...map.entries()].map(([stroke, v]) => ({ stroke: stroke as StrokeType | 'unset', ...v })).sort((a, b) => b.count - a.count)
}

/** 游泳扩展统计:平均/最长距离与时长、平均配速 */
export interface SwimExtraStats {
  avgDistanceM: number | null
  maxDistanceM: number | null
  avgDurationMin: number | null
  maxDurationMin: number | null
  avgPaceSecPer100m: number | null
}

export async function getSwimExtraStats(sessions?: ActivitySession[]): Promise<SwimExtraStats> {
  const all = sessions ?? (await listActivities({ sport: 'swimming' }))
  const withDist = all.filter((a) => a.distanceM && a.distanceM > 0)
  const withDur = all.filter((a) => a.durationMin && a.durationMin > 0)
  const totalDist = withDist.reduce((acc, a) => acc + (a.distanceM ?? 0), 0)
  const totalDurMin = withDur.reduce((acc, a) => acc + (a.durationMin ?? 0), 0)
  return {
    avgDistanceM: withDist.length ? Math.round(totalDist / withDist.length) : null,
    maxDistanceM: withDist.length ? Math.max(...withDist.map((a) => a.distanceM ?? 0)) : null,
    avgDurationMin: withDur.length ? Math.round(totalDurMin / withDur.length) : null,
    maxDurationMin: withDur.length ? Math.max(...withDur.map((a) => a.durationMin ?? 0)) : null,
    avgPaceSecPer100m: totalDist > 0 && totalDurMin > 0 ? calcPaceSecPer100m(totalDurMin, totalDist) : null,
  }
}

/** 月度游泳距离趋势 */
export async function getSwimMonthlyDistanceTrend(
  months = 6,
): Promise<{ month: string; sessions: number; distanceM: number }[]> {
  const out: { month: string; sessions: number; distanceM: number }[] = []
  const now = new Date()
  const all = await listActivities({ sport: 'swimming' })
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const rows = all.filter((a) => a.date.startsWith(key))
    out.push({
      month: key,
      sessions: rows.length,
      distanceM: rows.reduce((acc, r) => acc + (r.distanceM ?? 0), 0),
    })
  }
  return out
}
