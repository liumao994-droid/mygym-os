import { db } from '@/db/db'
import type { BodyPartId, DailyStatus, WorkoutSession, WorkoutSet } from '@/db/models'
import { BODY_PARTS, BODY_PART_META } from '@/db/models'
import { addDays, currentMonthKey, monthKey, todayStr, toLocalDate } from '@/lib/util'
import { estimate1RM, setVolume } from './calc'

/**
 * 统计服务:首页数据、月度统计、部位分布、连续性。
 * 全部基于索引查询,数据量大时分批聚合。
 */

/* =============== 日期维度状态(严格区分三种) =============== */

export type DayKind = 'trained' | 'rest' | 'unrecorded'

export interface DayState {
  date: string
  kind: DayKind
  session?: WorkoutSession
  rest?: DailyStatus
}

/** 查询一段日期范围内每天的状态。range 含头含尾 */
export async function getDayStates(start: string, end: string): Promise<Map<string, DayState>> {
  const [sessions, rests] = await Promise.all([
    db.sessions.where('date').between(start, end, true, true).and((s) => s.status === 'completed').toArray(),
    db.dailyStatuses.where('date').between(start, end, true, true).toArray(),
  ])
  const map = new Map<string, DayState>()
  let d = start
  while (d <= end) {
    map.set(d, { date: d, kind: 'unrecorded' })
    d = addDays(d, 1)
  }
  for (const r of rests) {
    const row = map.get(r.date)
    if (row) {
      row.kind = 'rest'
      row.rest = r
    }
  }
  // 训练覆盖休息(同一天既训练又标了休息,以训练为准)
  for (const s of sessions) {
    const row = map.get(s.date)
    if (row) {
      row.kind = 'trained'
      row.session = s
    }
  }
  return map
}

/* =============== 汇总数字 =============== */

export interface SummaryCounts {
  sessions: number
  rests: number
  unrecorded: number
  totalExercises: number
  totalSets: number
  volume: number
}

export async function countSummary(start: string, end: string): Promise<SummaryCounts> {
  const dayStates = await getDayStates(start, end)
  let sessions = 0
  let rests = 0
  for (const ds of dayStates.values()) {
    if (ds.kind === 'trained') sessions++
    else if (ds.kind === 'rest') rests++
  }
  const unrecorded = dayStates.size - sessions - rests

  const sessionIds = new Set(
    (await db.sessions.where('date').between(start, end, true, true).and((s) => s.status === 'completed').toArray()).map(
      (s) => s.id,
    ),
  )
  const inRange = (s: WorkoutSet) => s.date >= start && s.date <= end && sessionIds.has(s.sessionId)
  let volume = 0
  let totalSets = 0
  const exPairs = new Set<string>()
  await db.sets.each((s) => {
    if (!inRange(s)) return
    totalSets++
    volume += setVolume(s)
    exPairs.add(s.sessionId + ':' + s.exerciseId)
  })
  return {
    sessions,
    rests,
    unrecorded,
    totalExercises: exPairs.size,
    totalSets,
    volume: Math.round(volume),
  }
}

/** 全库总训练量(游标聚合,不整表载入) */
export async function sumAllVolume(): Promise<number> {
  let total = 0
  await db.sets.each((s) => {
    total += setVolume(s)
  })
  return total
}

/* =============== 首页:今日状态 =============== */

export type TodayKind = 'trained' | 'active' | 'rest' | 'unrecorded'

export interface TodayState {
  kind: TodayKind
  session?: WorkoutSession
  actionCount?: number
  setCount?: number
  rest?: DailyStatus
}

export async function getTodayState(date = todayStr()): Promise<TodayState> {
  const todays = await db.sessions.where('date').equals(date).toArray()
  const active = todays.find((s) => s.status === 'active')
  if (active) {
    const [exCount, setCount] = await Promise.all([
      db.workoutExercises.where('sessionId').equals(active.id).count(),
      db.sets.where('sessionId').equals(active.id).count(),
    ])
    return { kind: 'active', session: active, actionCount: exCount, setCount }
  }
  const done = todays
    .filter((s) => s.status === 'completed')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
  if (done) {
    const [exCount, setCount] = await Promise.all([
      db.workoutExercises.where('sessionId').equals(done.id).count(),
      db.sets.where('sessionId').equals(done.id).count(),
    ])
    return { kind: 'trained', session: done, actionCount: exCount, setCount }
  }
  const rest = await db.dailyStatuses.get(date)
  if (rest?.status === 'rest') return { kind: 'rest', rest }
  return { kind: 'unrecorded' }
}

/* =============== 首页:核心指标 =============== */

export interface HomeStats {
  monthSessions: number
  weekSessions: number
  totalVolume: number
  last7: { date: string; kind: DayKind }[]
  last7Summary: { trained: number; rest: number; unrecorded: number }
  totalSessions: number
  weekAvgPerMonth: number
}

export async function getHomeStats(): Promise<HomeStats> {
  const today = todayStr()
  const month = currentMonthKey()
  const monthStart = `${month}-01`
  const d = new Date()
  const monthEnd = toLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))

  const weekStart = addDays(today, -6)
  const [monthCounts, weekSessions, allTimeVolume, totalSessions] = await Promise.all([
    countSummary(monthStart, monthEnd),
    db.sessions
      .where('date')
      .between(weekStart, today, true, true)
      .and((s) => s.status === 'completed')
      .count(),
    sumAllVolume(),
    db.sessions.where('status').equals('completed').count(),
  ])

  const last7map = await getDayStates(weekStart, today)
  const last7: { date: string; kind: DayKind }[] = []
  const last7Summary = { trained: 0, rest: 0, unrecorded: 0 }
  let dd = weekStart
  while (dd <= today) {
    const kind = last7map.get(dd)?.kind ?? 'unrecorded'
    last7.push({ date: dd, kind })
    last7Summary[kind]++
    dd = addDays(dd, 1)
  }

  return {
    monthSessions: monthCounts.sessions,
    weekSessions,
    totalVolume: Math.round(allTimeVolume),
    last7,
    last7Summary,
    totalSessions,
    weekAvgPerMonth: monthCounts.sessions / Math.max(1, new Date().getDate()),
  }
}

/* =============== 部位分布(月度) =============== */

export interface PartDistribution {
  part: BodyPartId
  name: string
  color: string
  /** 该部位被训练的次数(会话含该部位记 1 次) */
  sessions: number
  sets: number
  volume: number
}

export async function getPartDistribution(start: string, end: string): Promise<PartDistribution[]> {
  const sessions = await db.sessions
    .where('date')
    .between(start, end, true, true)
    .and((s) => s.status === 'completed')
    .toArray()
  const sets = await db.sets.where('date').between(start, end, true, true).toArray()
  const exs = await db.exercises.toArray()
  const exMap = new Map(exs.map((e) => [e.id, e]))

  const result = new Map<BodyPartId, PartDistribution>(
    BODY_PARTS.map((p) => [
      p,
      { part: p, name: BODY_PART_META[p].name, color: BODY_PART_META[p].color, sessions: 0, sets: 0, volume: 0 },
    ]),
  )

  for (const s of sessions) {
    for (const p of s.bodyParts) {
      const row = result.get(p)
      if (row) row.sessions++
    }
  }
  for (const st of sets) {
    const ex = exMap.get(st.exerciseId)
    if (!ex) continue
    const row = result.get(ex.bodyPart)
    if (!row) continue
    row.sets++
    row.volume += setVolume(st)
  }
  return [...result.values()]
}

/* =============== 训练频率(月度) =============== */

export interface FrequencyStats {
  month: string
  days: number
  sessions: number
  rests: number
  unrecorded: number
  /** 每周平均训练次数(按整月 4.345 周或当月已过周数) */
  weeklyAvg: number
  avgExercisesPerSession: number
  avgSetsPerSession: number
  totalSets: number
  totalVolume: number
  parts: PartDistribution[]
}

export async function getMonthFrequency(key: string): Promise<FrequencyStats> {
  const [y, m] = key.split('-').map(Number)
  const start = `${key}-01`
  const end = toLocalDate(new Date(y, m, 0))
  const isCurrent = key === currentMonthKey()
  const counts = await countSummary(start, end)
  const parts = await getPartDistribution(start, end)
  const weeksElapsed = isCurrent ? Math.max(1, new Date().getDate() / 7) : 4.345
  return {
    month: key,
    days: counts.sessions + counts.rests + counts.unrecorded,
    sessions: counts.sessions,
    rests: counts.rests,
    unrecorded: counts.unrecorded,
    weeklyAvg: counts.sessions / weeksElapsed,
    avgExercisesPerSession: counts.sessions ? counts.totalExercises / counts.sessions : 0,
    avgSetsPerSession: counts.sessions ? counts.totalSets / counts.sessions : 0,
    totalSets: counts.totalSets,
    totalVolume: counts.volume,
    parts,
  }
}

/* =============== 动作月度最佳(月报用) =============== */

export interface ExerciseMonthBest {
  exerciseId: string
  bestWeight: number
  bestWeightReps: number
  bestEst1rm: number
  bestEst1rmWeight: number
  bestEst1rmReps: number
  volume: number
  setCount: number
}

export async function getExerciseMonthStats(exerciseId: string, key: string): Promise<ExerciseMonthBest | null> {
  const [y, m] = key.split('-').map(Number)
  const start = `${key}-01`
  const end = toLocalDate(new Date(y, m, 0))
  const sets = await db.sets
    .where('[exerciseId+date]')
    .between([exerciseId, start], [exerciseId, end + '￿'], true, true)
    .toArray()
  if (!sets.length) return null
  const sessionIds = new Set((await db.sessions.where('date').between(start, end, true, true).toArray()).map((s) => s.id))
  const valid = sets.filter((s) => sessionIds.has(s.sessionId))
  if (!valid.length) return null

  let bestWeight = 0
  let bestWeightReps = 0
  let bestEst1rm = 0
  let bestEst1rmWeight = 0
  let bestEst1rmReps = 0
  let volume = 0
  for (const s of valid) {
    if (s.weightType === 'weight' || s.weightType === 'dumbbell') {
      if (s.weight > bestWeight) {
        bestWeight = s.weight
        bestWeightReps = s.reps
      }
      const est = estimate1RM(s.weight, s.reps)
      if (est !== null && est > bestEst1rm) {
        bestEst1rm = est
        bestEst1rmWeight = s.weight
        bestEst1rmReps = s.reps
      }
    }
    volume += setVolume(s)
  }
  return {
    exerciseId,
    bestWeight,
    bestWeightReps,
    bestEst1rm,
    bestEst1rmWeight,
    bestEst1rmReps,
    volume: Math.round(volume),
    setCount: valid.length,
  }
}

/** 月度力量对比:本月 vs 上月,按「动作」维度找进步最大的 */
export interface MonthProgress {
  exerciseId: string
  exerciseName: string
  thisMonth: { weight: number; reps: number; est1rm: number }
  lastMonth: { weight: number; reps: number; est1rm: number }
  weightDelta: number
  pctChange: number
}

export async function getMonthProgress(key: string, prevKey: string): Promise<MonthProgress[]> {
  // 本月有记录的动作集合
  const [y, m] = key.split('-').map(Number)
  const start = `${key}-01`
  const end = toLocalDate(new Date(y, m, 0))
  const sets = await db.sets.where('date').between(start, end, true, true).toArray()
  const exIds = [...new Set(sets.map((s) => s.exerciseId))]

  const out: MonthProgress[] = []
  for (const eid of exIds) {
    const cur = await getExerciseMonthStats(eid, key)
    const prev = await getExerciseMonthStats(eid, prevKey)
    if (!cur || !prev) continue
    if (cur.bestEst1rm <= 0 || prev.bestEst1rm <= 0) continue
    out.push({
      exerciseId: eid,
      exerciseName: (await db.exercises.get(eid))?.name ?? '',
      thisMonth: { weight: cur.bestEst1rmWeight, reps: cur.bestEst1rmReps, est1rm: cur.bestEst1rm },
      lastMonth: { weight: prev.bestEst1rmWeight, reps: prev.bestEst1rmReps, est1rm: prev.bestEst1rm },
      weightDelta: Math.round((cur.bestEst1rmWeight - prev.bestEst1rmWeight) * 10) / 10,
      pctChange: Math.round(((cur.bestEst1rm - prev.bestEst1rm) / prev.bestEst1rm) * 1000) / 10,
    })
  }
  return out.sort((a, b) => b.weightDelta - a.weightDelta)
}

/* =============== 动作历史趋势(详情页) =============== */

export interface TrendPoint {
  date: string
  weight: number
  est1rm: number
  volume: number
  reps: number
}

/** 每次训练一个点:该次训练中该动作的最佳重量/估算1RM/容量/总次数 */
export async function getExerciseTrend(exerciseId: string, limitDays?: number): Promise<TrendPoint[]> {
  let sets: WorkoutSet[]
  if (limitDays) {
    const cutoff = addDays(todayStr(), -limitDays)
    sets = await db.sets
      .where('[exerciseId+date]')
      .between([exerciseId, cutoff], [exerciseId, '￿'], true, true)
      .toArray()
  } else {
    sets = await db.sets.where('exerciseId').equals(exerciseId).toArray()
  }
  const bySession = new Map<string, TrendPoint & { firstSet: number }>()
  for (const s of sets) {
    const agg = bySession.get(s.sessionId) ?? {
      date: s.date,
      weight: 0,
      est1rm: 0,
      volume: 0,
      reps: 0,
      firstSet: s.createdAt,
    }
    if (s.weightType === 'weight' || s.weightType === 'dumbbell') {
      if (s.weight > agg.weight) agg.weight = s.weight
      const est = estimate1RM(s.weight, s.reps)
      if (est !== null && est > agg.est1rm) agg.est1rm = est
      agg.volume += setVolume(s)
    }
    agg.reps += s.reps
    bySession.set(s.sessionId, agg)
  }
  return [...bySession.values()]
    .sort((a, b) => (a.date === b.date ? a.firstSet - b.firstSet : a.date < b.date ? -1 : 1))
    .map(({ date, weight, est1rm, volume, reps }) => ({ date, weight, est1rm, volume, reps }))
}

/* =============== 月度 PR(本月刷新的纪录) =============== */

export interface MonthPR {
  exerciseId: string
  exerciseName: string
  type: string
  weight: number
  reps: number
  value: number
  date: string
}

export async function getMonthPRs(key: string): Promise<MonthPR[]> {
  const [y, m] = key.split('-').map(Number)
  const start = `${key}-01`
  const end = toLocalDate(new Date(y, m, 0))
  const events = await db.prEvents.where('date').between(start, end, true, true).toArray()
  const exMap = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  // 每个动作保留「最好的一类」:est1rm > maxWeight > maxReps
  const prio: Record<string, number> = { est1rm: 3, maxWeight: 2, maxReps: 1, volume: 0 }
  const best = new Map<string, (typeof events)[number]>()
  for (const e of events) {
    if (e.type === 'volume') continue
    const cur = best.get(e.exerciseId)
    if (!cur || prio[e.type] > prio[cur.type] || (prio[e.type] === prio[cur.type] && e.value > cur.value)) {
      best.set(e.exerciseId, e)
    }
  }
  return [...best.values()]
    .sort((a, b) => b.value - a.value)
    .map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: exMap.get(e.exerciseId)?.name ?? '已删除动作',
      type: e.type,
      weight: e.weight,
      reps: e.reps,
      value: e.value,
      date: e.date,
    }))
}

/* =============== 动作使用统计(排序/管理用) =============== */

export interface ExerciseUsage {
  exerciseId: string
  lastUsed: string
  useCount: number
  bestWeight: number
  bestEst1rm: number
}

export async function getExerciseUsageMap(): Promise<Map<string, ExerciseUsage>> {
  const map = new Map<string, ExerciseUsage>()
  await db.sets.each((s) => {
    const u = map.get(s.exerciseId) ?? { exerciseId: s.exerciseId, lastUsed: '', useCount: 0, bestWeight: 0, bestEst1rm: 0 }
    u.useCount++
    if (s.date > u.lastUsed) u.lastUsed = s.date
    if ((s.weightType === 'weight' || s.weightType === 'dumbbell') && s.weight > u.bestWeight) u.bestWeight = s.weight
    const est = estimate1RM(s.weight, s.reps)
    if (est !== null && est > u.bestEst1rm) u.bestEst1rm = est
    map.set(s.exerciseId, u)
  })
  return map
}

/* =============== 会话含月份(时间线分页) =============== */

export async function getSessionMonths(): Promise<string[]> {
  const dates = await db.sessions.orderBy('date').keys()
  const months = new Set<string>()
  for (const d of dates) {
    if (typeof d === 'string') months.add(monthKey(d))
  }
  const restRows = await db.dailyStatuses.toArray()
  for (const r of restRows) months.add(monthKey(r.date))
  return [...months].sort().reverse()
}
