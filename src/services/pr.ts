import { db } from '@/db/db'
import type { PREvent, PRType, PersonalRecord, WorkoutSession, WorkoutSet } from '@/db/models'
import { estimate1RM, performanceScore, setVolume } from './calc'

/**
 * PR 系统
 *
 * PR = 每个动作四种类型的历史最佳:
 * - maxWeight  最大使用重量(仅器械/杠铃/哑铃)
 * - maxReps    单组最大次数(任何形式)
 * - est1rm     估算 1RM 最高的一组(Epley,次数 ≤ 15)
 * - volume     单次训练中该动作的总容量最高
 *
 * prEvents 通过「按时间重放该动作全部组数据」确定性重建,
 * 因此 编辑/删除/导入 等任何数据变更后重算即可保持一致,
 * 不会出现 PR 与历史数据不一致的情况。
 */

/** 单动作按时间线重放,生成 PR 事件与当前 PR(只统计已完成会话的组) */
export async function rebuildPRsForExercise(exerciseId: string, now = Date.now()): Promise<void> {
  const allSets = await db.sets.where('exerciseId').equals(exerciseId).toArray()
  // 只取已完成会话的组:进行中/已放弃的训练不产生 PR,避免污染与残留
  const sessionIds = [...new Set(allSets.map((s) => s.sessionId))]
  const sessionRows = await db.sessions.bulkGet(sessionIds)
  const completed = new Set<string>()
  sessionRows.forEach((s, i) => {
    if (s && s.status === 'completed') completed.add(sessionIds[i])
  })
  const sets = allSets.filter((s) => completed.has(s.sessionId))
  const events: PREvent[] = []
  const current = new Map<PRType, PersonalRecord>()

  const pushCandidate = (
    type: PRType,
    value: number,
    set: WorkoutSet,
    prevValue: number | null,
    setsCount?: number,
  ) => {
    events.push({
      id: `${exerciseId}:${type}:${set.id}`,
      exerciseId,
      type,
      value,
      weight: set.weight,
      reps: set.reps,
      weightType: set.weightType,
      prevValue,
      date: set.date,
      sessionId: set.sessionId,
      isDemo: set.isDemo,
      createdAt: set.createdAt,
    })
    current.set(type, {
      id: `${exerciseId}:${type}`,
      exerciseId,
      type,
      value,
      weight: set.weight,
      reps: set.reps,
      sets: setsCount,
      date: set.date,
      sessionId: set.sessionId,
      updatedAt: now,
    })
  }

  // --- 组级 PR:按 (date, createdAt) 时间重放 ---
  const chrono = [...sets].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))

  let bestWeight = 0
  let bestReps = 0
  let best1rm = 0
  for (const s of chrono) {
    if (s.weightType === 'weight' || s.weightType === 'dumbbell') {
      if (s.weight > bestWeight) {
        const prev = bestWeight
        bestWeight = s.weight
        pushCandidate('maxWeight', s.weight, s, prev > 0 ? prev : null)
      }
      const est = estimate1RM(s.weight, s.reps)
      if (est !== null && est > best1rm) {
        const prev = best1rm
        best1rm = est
        pushCandidate('est1rm', est, s, prev > 0 ? prev : null)
      }
    }
    if (s.reps > bestReps) {
      const prev = bestReps
      bestReps = s.reps
      pushCandidate('maxReps', s.reps, s, prev > 0 ? prev : null)
    }
  }

  // --- 会话级容量 PR ---
  const bySession = new Map<string, { total: number; date: string; sets: WorkoutSet[]; first: number }>()
  for (const s of sets) {
    const v = setVolume(s)
    if (v <= 0) continue
    const agg = bySession.get(s.sessionId) ?? { total: 0, date: s.date, sets: [], first: s.createdAt }
    agg.total += v
    agg.sets.push(s)
    bySession.set(s.sessionId, agg)
  }
  const sessionAggs = [...bySession.entries()].sort((a, b) =>
    a[1].date === b[1].date ? a[1].first - b[1].first : a[1].date < b[1].date ? -1 : 1,
  )
  let bestVol = 0
  for (const [sessionId, agg] of sessionAggs) {
    if (agg.total > bestVol) {
      const prev = bestVol
      const best = agg.sets.reduce((m, s) => (setVolume(s) > setVolume(m) ? s : m), agg.sets[0])
      const firstSet = agg.sets.reduce((m, s) => (s.setNumber < m.setNumber ? s : m), agg.sets[0])
      bestVol = agg.total
      events.push({
        id: `${exerciseId}:volume:${sessionId}`,
        exerciseId,
        type: 'volume',
        value: Math.round(agg.total * 100) / 100,
        weight: firstSet.weight,
        reps: firstSet.reps,
        weightType: firstSet.weightType,
        prevValue: prev > 0 ? prev : null,
        date: agg.date,
        sessionId,
        isDemo: firstSet.isDemo,
        createdAt: agg.first,
      })
      current.set('volume', {
        id: `${exerciseId}:volume`,
        exerciseId,
        type: 'volume',
        value: Math.round(agg.total * 100) / 100,
        weight: best.weight,
        reps: best.reps,
        sets: agg.sets.length,
        date: agg.date,
        sessionId,
        updatedAt: now,
      })
    }
  }

  await db.transaction('rw', db.prEvents, db.personalRecords, async () => {
    await db.prEvents.where('exerciseId').equals(exerciseId).delete()
    await db.personalRecords.where('exerciseId').equals(exerciseId).delete()
    if (events.length) await db.prEvents.bulkPut(events)
    if (current.size) await db.personalRecords.bulkPut([...current.values()])
  })
}

/** 重建全部动作 PR(导入/清空/批量删除后调用) */
export async function rebuildAllPRs(): Promise<void> {
  const exercises = await db.exercises.toArray()
  for (const e of exercises) {
    await rebuildPRsForExercise(e.id)
  }
}

export async function getPRs(exerciseId: string): Promise<PersonalRecord[]> {
  return db.personalRecords.where('exerciseId').equals(exerciseId).toArray()
}

export async function getPR(exerciseId: string, type: PRType): Promise<PersonalRecord | undefined> {
  return db.personalRecords.get(`${exerciseId}:${type}`)
}

export interface BestSetInfo {
  weight: number
  reps: number
  est1rm: number | null
  date: string
}

/** 历史最佳一组:est1RM 最高;无估算时退化为最重组 */
export async function getBestSet(exerciseId: string): Promise<BestSetInfo | null> {
  const pr = await getPR(exerciseId, 'est1rm')
  if (pr) return { weight: pr.weight, reps: pr.reps, est1rm: pr.value, date: pr.date }
  const mw = await getPR(exerciseId, 'maxWeight')
  if (mw) return { weight: mw.weight, reps: mw.reps, est1rm: null, date: mw.date }
  const mr = await getPR(exerciseId, 'maxReps')
  if (mr) return { weight: mr.weight, reps: mr.reps, est1rm: null, date: mr.date }
  return null
}

/** 该动作最近的 N 条 PR 事件(用于详情页时间线) */
export async function getPREvents(exerciseId: string, limit = 30): Promise<PREvent[]> {
  const events = await db.prEvents.where('exerciseId').equals(exerciseId).toArray()
  return events.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)).slice(0, limit)
}

/** 最近 N 天各动作 PR 事件(首页「最近进步」) */
export async function getRecentPREvents(days: number): Promise<PREvent[]> {
  const cutoff = new Date(Date.now() - days * 86400000)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  const events = await db.prEvents.where('date').aboveOrEqual(cutoffStr).toArray()
  // 只保留「类型历史最佳」事件(重放产生的事件每条都是当时最佳,天然符合)
  return events.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
}

/** 供比较逻辑使用:同一重量下的历史最高次数 */
export function bestRepsAtWeight(sets: WorkoutSet[], weight: number): number {
  let best = 0
  for (const s of sets) if (s.weight === weight && s.reps > best) best = s.reps
  return best
}

/** 某动作最近一次(已完成)训练的组数据,供「上次」提示与复制 */
export async function getLastPerformance(
  exerciseId: string,
  excludeSessionId?: string,
): Promise<{ sessionId: string; date: string; sets: WorkoutSet[] } | null> {
  const sets = await db.sets.where('exerciseId').equals(exerciseId).toArray()
  const candidates = sets.filter((s) => s.sessionId !== excludeSessionId)
  if (!candidates.length) return null
  candidates.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
  // 只取已完成会话中的最近一次
  const sessionCache = new Map<string, WorkoutSession | undefined>()
  const statusOf = async (sessionId: string) => {
    if (!sessionCache.has(sessionId)) sessionCache.set(sessionId, await db.sessions.get(sessionId))
    return sessionCache.get(sessionId)
  }
  for (const s of candidates) {
    const session = await statusOf(s.sessionId)
    if (session && session.status === 'completed') {
      return {
        sessionId: s.sessionId,
        date: s.date,
        sets: candidates.filter((c) => c.sessionId === s.sessionId).sort((a, b) => a.setNumber - b.setNumber),
      }
    }
  }
  return null
}

export { performanceScore }
