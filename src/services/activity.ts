import { db } from '@/db/db'
import type {
  ActivityScore,
  ActivitySession,
  DistanceUnit,
  NonStrengthSport,
  StrokeType,
  VolleyballPosition,
  VolleyballSessionType,
  VolleyballSetScore,
  VolleyballStats,
} from '@/db/models'
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
  /** 比分文本(网球等,可选) */
  scoreText?: string
  /* ---- 游泳 ---- */
  distanceM?: number
  distanceUnit?: DistanceUnit
  stroke?: StrokeType
  poolLengthM?: number
  laps?: number
  calories?: number
  /* ---- 网球 ---- */
  indoor?: 'indoor' | 'outdoor'
  surface?: 'hard' | 'clay' | 'grass' | 'other'
  nature?: 'training' | 'official' | 'friendly' | 'practice' | 'serving' | 'multiball' | 'other'
  trainingTypes?: string[]
  trainingFocus?: string
  sets?: { a: number; b: number }[]
  technique?: ActivitySession['technique']
  fitness?: ActivitySession['fitness']
  /* ---- 排球 ---- */
  volleyballSessionType?: VolleyballSessionType
  volleyballPosition?: VolleyballPosition
  volleyballSets?: VolleyballSetScore[]
  volleyballStats?: VolleyballStats
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
    scoreText: input.scoreText,
    /* ---- 游泳 ---- */
    distanceM: input.distanceM,
    distanceUnit: input.distanceUnit,
    stroke: input.stroke,
    poolLengthM: input.poolLengthM,
    laps: input.laps,
    calories: input.calories,
    /* ---- 网球 ---- */
    indoor: input.indoor,
    surface: input.surface,
    nature: input.nature,
    trainingTypes: input.trainingTypes,
    trainingFocus: input.trainingFocus,
    sets: input.sets,
    technique: input.technique,
    fitness: input.fitness,
    /* ---- 排球 ---- */
    volleyballSessionType: input.volleyballSessionType,
    volleyballPosition: input.volleyballPosition,
    volleyballSets: input.volleyballSets,
    volleyballStats: input.volleyballStats,
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
  tennis: (s) => {
    const parts: string[] = []
    if (s.playType) parts.push(s.playType === 'singles' ? '单打' : '双打')
    const g = s.score ?? {}
    if ((g.gamesTotal ?? 0) > 0) {
      parts.push(`${g.gamesTotal}盘`)
      if ((g.gamesWon ?? 0) > 0 || (g.gamesLost ?? 0) > 0) parts.push(`胜${g.gamesWon ?? 0}负${g.gamesLost ?? 0}`)
    }
    if (s.scoreText) parts.push(s.scoreText)
    if (s.surface === 'hard') parts.push('硬地')
    else if (s.surface === 'clay') parts.push('红土')
    else if (s.surface === 'grass') parts.push('草地')
    return parts.length ? parts.join(' · ') : undefined
  },
  volleyball: (s) => {
    const parts: string[] = []
    const tally = volleyballSetTally(s.volleyballSets)
    if (tally.decided > 0) parts.push(`${tally.result === 'win' ? '胜' : tally.result === 'loss' ? '负' : '平'} ${tally.won}:${tally.lost}`)
    const direct = volleyballDirectPoints(s.volleyballStats)
    if (direct > 0) parts.push(`${direct}分`)
    const aces = s.volleyballStats?.serve?.aces
    if (aces) parts.push(`${aces} ACE`)
    const digs = s.volleyballStats?.dig?.successful
    if (digs) parts.push(`${digs}次有效防守`)
    return parts.slice(0, 3).join(' · ') || undefined
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

/* =============== 网球(第二阶段) =============== */

/** 从 sets[] 推导盘数胜负:每盘 a>b 记胜盘 */
export function setsTally(sets?: { a: number; b: number }[]): { total: number; won: number; lost: number } {
  const won = (sets ?? []).filter((s) => s.a > s.b).length
  const lost = (sets ?? []).filter((s) => s.b > s.a).length
  return { total: won + lost, won, lost }
}

export interface TennisStats {
  totalSessions: number
  matchCount: number
  trainingCount: number
  totalMinutes: number
  avgMinutes: number | null
  setsTotal: number
  setsWon: number
  setsLost: number
  setWinRate: number | null
  matchWins: number
  matchLosses: number
  matchWinRate: number | null
  aces: number
  doubleFaults: number
  winners: number
  unforcedErrors: number
  breakConverted: number
  weekSessions: number
  monthSessions: number
  monthMinutes: number
  yearSessions: number
  yearMinutes: number
}

/** 场胜负:优先 sets 推导,其次 score.gamesWon/Lost,否则不计 */
function matchResultOf(s: ActivitySession): 'win' | 'loss' | 'draw' | null {
  const sets = setsTally(s.sets)
  if (sets.won > 0 || sets.lost > 0) {
    if (sets.won > sets.lost) return 'win'
    if (sets.lost > sets.won) return 'loss'
    return 'draw'
  }
  const w = s.score?.gamesWon ?? 0
  const l = s.score?.gamesLost ?? 0
  if (w > 0 || l > 0) {
    if (w > l) return 'win'
    if (l > w) return 'loss'
    return 'draw'
  }
  return null
}

/** 本周一 00:00 的日期字符串 */
function weekStartDateStr(): string {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // 周一=0
  d.setDate(d.getDate() - day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function getTennisStats(): Promise<TennisStats> {
  const all = await listActivities({ sport: 'tennis' })
  const month = currentMonthKey()
  const year = todayStr().slice(0, 4)
  const weekStart = weekStartDateStr()

  const st: TennisStats = {
    totalSessions: all.length,
    matchCount: 0,
    trainingCount: 0,
    totalMinutes: 0,
    avgMinutes: null,
    setsTotal: 0,
    setsWon: 0,
    setsLost: 0,
    setWinRate: null,
    matchWins: 0,
    matchLosses: 0,
    matchWinRate: null,
    aces: 0,
    doubleFaults: 0,
    winners: 0,
    unforcedErrors: 0,
    breakConverted: 0,
    weekSessions: 0,
    monthSessions: 0,
    monthMinutes: 0,
    yearSessions: 0,
    yearMinutes: 0,
  }
  let decided = 0
  for (const s of all) {
    st.totalMinutes += s.durationMin ?? 0
    // 盘数:优先 sets 明细推导;无明细时退回 score 容器(兼容只记胜负的旧记录)
    const tally = setsTally(s.sets)
    if ((s.sets?.length ?? 0) > 0) {
      st.setsWon += tally.won
      st.setsLost += tally.lost
      st.setsTotal += tally.total
    } else {
      const w = s.score?.gamesWon ?? 0
      const l = s.score?.gamesLost ?? 0
      st.setsWon += w
      st.setsLost += l
      st.setsTotal += s.score?.gamesTotal ?? 0
    }
    const result = matchResultOf(s)
    if (result === 'win') st.matchWins++
    if (result === 'loss') st.matchLosses++
    if (result) decided++
    if (s.nature === 'official' || s.isMatch === 1) st.matchCount++
    else if (s.nature && s.nature !== 'other') st.trainingCount++
    const t = s.technique
    if (t) {
      st.aces += t.aces ?? 0
      st.doubleFaults += t.doubleFaults ?? 0
      st.winners += t.winners ?? 0
      st.unforcedErrors += t.unforcedErrors ?? 0
      st.breakConverted += t.breakConverted ?? 0
    }
    if (s.date >= weekStart) st.weekSessions++
    if (s.date.startsWith(month)) {
      st.monthSessions++
      st.monthMinutes += s.durationMin ?? 0
    }
    if (s.date.startsWith(year)) {
      st.yearSessions++
      st.yearMinutes += s.durationMin ?? 0
    }
  }
  st.avgMinutes = st.totalSessions ? Math.round(st.totalMinutes / st.totalSessions) : null
  st.setWinRate = st.setsWon + st.setsLost > 0 ? Math.round((st.setsWon / (st.setsWon + st.setsLost)) * 1000) / 10 : null
  st.matchWinRate = decided > 0 ? Math.round((st.matchWins / decided) * 1000) / 10 : null
  return st
}

/** 网球月度趋势(场次/时长/盘胜率/Ace/双误/Winners/UE) */
export async function getTennisMonthlyTrend(
  months = 6,
): Promise<{ month: string; sessions: number; minutes: number; setWinRate: number | null; aces: number; doubleFaults: number; winners: number; unforcedErrors: number }[]> {
  const now = new Date()
  const all = await listActivities({ sport: 'tennis' })
  const out: { month: string; sessions: number; minutes: number; setWinRate: number | null; aces: number; doubleFaults: number; winners: number; unforcedErrors: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const rows = all.filter((a) => a.date.startsWith(key))
    let sw = 0
    let sl = 0
    let aces = 0
    let dfs = 0
    let win = 0
    let ue = 0
    for (const r of rows) {
      if ((r.sets?.length ?? 0) > 0) {
        sw += setsTally(r.sets).won
        sl += setsTally(r.sets).lost
      } else {
        sw += r.score?.gamesWon ?? 0
        sl += r.score?.gamesLost ?? 0
      }
      aces += r.technique?.aces ?? 0
      dfs += r.technique?.doubleFaults ?? 0
      win += r.technique?.winners ?? 0
      ue += r.technique?.unforcedErrors ?? 0
    }
    out.push({
      month: key,
      sessions: rows.length,
      minutes: rows.reduce((acc, r) => acc + (r.durationMin ?? 0), 0),
      setWinRate: sw + sl > 0 ? Math.round((sw / (sw + sl)) * 1000) / 10 : null,
      aces,
      doubleFaults: dfs,
      winners: win,
      unforcedErrors: ue,
    })
  }
  return out
}

/* =============== 排球 =============== */

export function safePercent(numerator?: number, denominator?: number): number | null {
  if (!denominator || denominator <= 0 || numerator === undefined || numerator < 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

export function volleyballSetTally(sets?: VolleyballSetScore[]): {
  decided: number
  won: number
  lost: number
  result: 'win' | 'loss' | 'draw' | null
} {
  let won = 0
  let lost = 0
  for (const set of sets ?? []) {
    if (!Number.isFinite(set.ourScore) || !Number.isFinite(set.opponentScore) || set.ourScore === set.opponentScore) continue
    if ((set.ourScore ?? 0) > (set.opponentScore ?? 0)) won++
    else lost++
  }
  const result = won + lost === 0 ? null : won > lost ? 'win' : lost > won ? 'loss' : 'draw'
  return { decided: won + lost, won, lost, result }
}

export function volleyballDirectPoints(stats?: VolleyballStats): number {
  return (stats?.attack?.points ?? 0) + (stats?.serve?.aces ?? 0) + (stats?.block?.points ?? 0)
}

export interface VolleyballAggregate {
  sessions: number
  totalMinutes: number
  avgMinutes: number | null
  matchCount: number
  wins: number
  losses: number
  draws: number
  matchWinRate: number | null
  setsWon: number
  setsLost: number
  directPoints: number
  attackPoints: number
  aces: number
  blockPoints: number
  effectiveBlocks: number
  successfulDigs: number
  perfectReceptions: number
  serveAttempts: number
  serveErrors: number
  attackAttempts: number
  attackErrors: number
  attackBlocked: number
  receptionAttempts: number
  receptionErrors: number
  digAttempts: number
  setAttempts: number
  successfulSets: number
  aceRate: number | null
  serveErrorRate: number | null
  attackScoreRate: number | null
  attackEfficiency: number | null
  receptionPerfectRate: number | null
  receptionErrorRate: number | null
  digSuccessRate: number | null
  setSuccessRate: number | null
  positions: { position: VolleyballPosition; count: number }[]
  best: { directPoints: number; aces: number; blockPoints: number; successfulDigs: number }
}

export function summarizeVolleyballSessions(sessions: ActivitySession[]): VolleyballAggregate {
  const out: VolleyballAggregate = {
    sessions: sessions.length,
    totalMinutes: 0,
    avgMinutes: null,
    matchCount: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    matchWinRate: null,
    setsWon: 0,
    setsLost: 0,
    directPoints: 0,
    attackPoints: 0,
    aces: 0,
    blockPoints: 0,
    effectiveBlocks: 0,
    successfulDigs: 0,
    perfectReceptions: 0,
    serveAttempts: 0,
    serveErrors: 0,
    attackAttempts: 0,
    attackErrors: 0,
    attackBlocked: 0,
    receptionAttempts: 0,
    receptionErrors: 0,
    digAttempts: 0,
    setAttempts: 0,
    successfulSets: 0,
    aceRate: null,
    serveErrorRate: null,
    attackScoreRate: null,
    attackEfficiency: null,
    receptionPerfectRate: null,
    receptionErrorRate: null,
    digSuccessRate: null,
    setSuccessRate: null,
    positions: [],
    best: { directPoints: 0, aces: 0, blockPoints: 0, successfulDigs: 0 },
  }
  const positions = new Map<VolleyballPosition, number>()
  for (const session of sessions) {
    out.totalMinutes += session.durationMin ?? 0
    if (session.volleyballPosition) positions.set(session.volleyballPosition, (positions.get(session.volleyballPosition) ?? 0) + 1)
    const tally = volleyballSetTally(session.volleyballSets)
    if (session.volleyballSessionType === 'scrimmage' || session.volleyballSessionType === 'official') out.matchCount++
    out.setsWon += tally.won
    out.setsLost += tally.lost
    if (tally.result === 'win') out.wins++
    else if (tally.result === 'loss') out.losses++
    else if (tally.result === 'draw') out.draws++
    const v = session.volleyballStats
    const direct = volleyballDirectPoints(v)
    out.directPoints += direct
    out.attackPoints += v?.attack?.points ?? 0
    out.aces += v?.serve?.aces ?? 0
    out.blockPoints += v?.block?.points ?? 0
    out.effectiveBlocks += v?.block?.effective ?? 0
    out.successfulDigs += v?.dig?.successful ?? 0
    out.perfectReceptions += v?.reception?.perfect ?? 0
    out.serveAttempts += v?.serve?.attempts ?? 0
    out.serveErrors += v?.serve?.errors ?? 0
    out.attackAttempts += v?.attack?.attempts ?? 0
    out.attackErrors += v?.attack?.errors ?? 0
    out.attackBlocked += v?.attack?.blocked ?? 0
    out.receptionAttempts += v?.reception?.attempts ?? 0
    out.receptionErrors += v?.reception?.errors ?? 0
    out.digAttempts += v?.dig?.attempts ?? 0
    out.setAttempts += v?.set?.attempts ?? 0
    out.successfulSets += v?.set?.successful ?? 0
    out.best.directPoints = Math.max(out.best.directPoints, direct)
    out.best.aces = Math.max(out.best.aces, v?.serve?.aces ?? 0)
    out.best.blockPoints = Math.max(out.best.blockPoints, v?.block?.points ?? 0)
    out.best.successfulDigs = Math.max(out.best.successfulDigs, v?.dig?.successful ?? 0)
  }
  out.avgMinutes = out.sessions ? Math.round(out.totalMinutes / out.sessions) : null
  out.matchWinRate = out.wins + out.losses > 0 ? safePercent(out.wins, out.wins + out.losses) : null
  out.aceRate = safePercent(out.aces, out.serveAttempts)
  out.serveErrorRate = safePercent(out.serveErrors, out.serveAttempts)
  out.attackScoreRate = safePercent(out.attackPoints, out.attackAttempts)
  out.attackEfficiency = out.attackAttempts > 0
    ? Math.round(((out.attackPoints - out.attackErrors - out.attackBlocked) / out.attackAttempts) * 1000) / 10
    : null
  out.receptionPerfectRate = safePercent(out.perfectReceptions, out.receptionAttempts)
  out.receptionErrorRate = safePercent(out.receptionErrors, out.receptionAttempts)
  out.digSuccessRate = safePercent(out.successfulDigs, out.digAttempts)
  out.setSuccessRate = safePercent(out.successfulSets, out.setAttempts)
  out.positions = [...positions.entries()].map(([position, count]) => ({ position, count })).sort((a, b) => b.count - a.count)
  return out
}

export async function getVolleyballStats(start?: string, end?: string): Promise<VolleyballAggregate> {
  const sessions = await listActivities({ sport: 'volleyball', start, end })
  return summarizeVolleyballSessions(sessions)
}

export async function getVolleyballYearTrend(year: number): Promise<{ month: string; sessions: number; minutes: number }[]> {
  const all = await listActivities({ sport: 'volleyball', start: `${year}-01-01`, end: `${year}-12-31` })
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`
    const rows = all.filter((session) => session.date.startsWith(month))
    return { month, sessions: rows.length, minutes: rows.reduce((sum, session) => sum + (session.durationMin ?? 0), 0) }
  })
}

export function volleyballPerformanceNotes(session: ActivitySession): string[] {
  const stats = session.volleyballStats
  if (!stats) return []
  const notes: string[] = []
  const aceRate = safePercent(stats.serve?.aces, stats.serve?.attempts)
  const attackRate = safePercent(stats.attack?.points, stats.attack?.attempts)
  const receptionRate = safePercent(stats.reception?.perfect, stats.reception?.attempts)
  if ((stats.serve?.aces ?? 0) >= 3 || (aceRate !== null && aceRate >= 20)) notes.push('今天发球很有威胁')
  if (attackRate !== null && attackRate >= 45) notes.push('进攻端表现不错')
  if (receptionRate !== null && receptionRate >= 60) notes.push('今天接发状态稳定')
  if ((stats.dig?.successful ?? 0) >= 5) notes.push('后排防守参与度很高')
  if ((stats.attack?.attempts ?? 0) > 0 && (stats.attack?.errors ?? 0) / (stats.attack?.attempts ?? 1) >= 0.3) notes.push('今天进攻端失误偏多')
  return notes.slice(0, 3)
}

export function validateVolleyballStats(stats?: VolleyballStats): string | null {
  if (!stats) return null
  const groups = Object.values(stats)
  for (const group of groups) {
    for (const value of Object.values(group ?? {}) as (number | undefined)[]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) return '专业数据必须是非负整数'
    }
  }
  const checks: [number | undefined, number | undefined, string][] = [
    [stats.serve?.aces, stats.serve?.attempts, 'ACE 不能大于发球次数'],
    [stats.serve?.errors, stats.serve?.attempts, '发球失误不能大于发球次数'],
    [stats.attack?.points, stats.attack?.attempts, '进攻得分不能大于进攻次数'],
    [stats.attack?.errors, stats.attack?.attempts, '进攻失误不能大于进攻次数'],
    [stats.attack?.blocked, stats.attack?.attempts, '被拦次数不能大于进攻次数'],
    [stats.reception?.perfect, stats.reception?.attempts, '到位球不能大于接发次数'],
    [stats.reception?.errors, stats.reception?.attempts, '接发失误不能大于接发次数'],
    [stats.dig?.successful, stats.dig?.attempts, '有效防守不能大于防守次数'],
    [stats.set?.successful, stats.set?.attempts, '有效二传不能大于二传次数'],
  ]
  for (const [value, attempts, message] of checks) {
    if (value !== undefined && attempts !== undefined && value > attempts) return message
  }
  return null
}
