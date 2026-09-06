import { db } from '@/db/db'
import { DEFAULT_EXERCISES } from '@/db/defaults'
import type {
  BodyPartId,
  DailyStatus,
  Exercise,
  FeelLevel,
  ID,
  PRType,
  WeightType,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/db/models'
import { BODY_PART_META, FEEL_LABEL } from '@/db/models'
import { todayStr, uid } from '@/lib/util'
import { rebuildPRsForExercise, rebuildAllPRs } from './pr'

/**
 * 数据访问层:所有写操作的唯一入口。
 * 保证 完整性约束(动作软删除、PR 一致重算、Demo 数据隔离)。
 */

export function sessionTitle(bodyParts: BodyPartId[]): string {
  return bodyParts.map((p) => BODY_PART_META[p].name).join(' · ')
}

/* =============== 初始化 =============== */

/** 首次启动:写入默认动作库(事务内原子判断,防止并发双写) */
export async function ensureDefaultExercises(): Promise<void> {
  await db.transaction('rw', [db.exercises, db.appState], async () => {
    const seeded = await db.appState.get('defaultExercisesSeeded')
    if (seeded?.value === true) return
    const count = await db.exercises.count()
    if (count === 0) {
      const now = Date.now()
      const rows: Exercise[] = DEFAULT_EXERCISES.map((d) => ({
        id: uid(),
        name: d.name,
        bodyPart: d.bodyPart,
        equipment: d.equipment,
        defaultWeightType: d.defaultWeightType,
        isCustom: false,
        createdAt: now,
        updatedAt: now,
      }))
      await db.exercises.bulkAdd(rows)
    }
    await db.appState.put({ key: 'defaultExercisesSeeded', value: true, updatedAt: Date.now() })
  })
}

/* =============== 会话 =============== */

export async function startSession(
  bodyParts: BodyPartId[],
  opts: { date?: string; copiedFromSessionId?: ID; templateId?: ID } = {},
): Promise<WorkoutSession> {
  const now = Date.now()
  const session: WorkoutSession = {
    id: uid(),
    date: opts.date ?? todayStr(),
    status: 'active',
    bodyParts,
    title: sessionTitle(bodyParts),
    startedAt: now,
    copiedFromSessionId: opts.copiedFromSessionId,
    templateId: opts.templateId,
    createdAt: now,
    updatedAt: now,
  }
  await db.sessions.put(session)
  return session
}

/** 复制上次训练:克隆最近一次已完成会话的结构与组数据,以「未完成」状态开始今天 */
export async function copyLastSession(date = todayStr()): Promise<{ session: WorkoutSession } | null> {
  const last = await db.sessions
    .where('status')
    .equals('completed')
    .toArray()
    .then((rows) => rows.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))[0])
  if (!last) return null

  const src = await getSessionDetail(last.id)
  if (!src) return null

  const now = Date.now()
  const session: WorkoutSession = {
    id: uid(),
    date,
    status: 'active',
    bodyParts: last.bodyParts,
    title: last.title ?? sessionTitle(last.bodyParts),
    startedAt: now,
    copiedFromSessionId: last.id,
    createdAt: now,
    updatedAt: now,
  }
  const wes: WorkoutExercise[] = []
  const sets: WorkoutSet[] = []
  for (const item of src.exercises) {
    const weId = uid()
    wes.push({
      id: weId,
      sessionId: session.id,
      exerciseId: item.exercise.id,
      order: item.order,
      createdAt: now,
    })
    item.sets.forEach((s, i) => {
      sets.push({
        id: uid(),
        workoutExerciseId: weId,
        sessionId: session.id,
        exerciseId: item.exercise.id,
        setNumber: i + 1,
        weight: s.weight,
        reps: s.reps,
        weightType: s.weightType,
        date,
        createdAt: now,
      })
    })
  }
  await db.transaction('rw', db.sessions, db.workoutExercises, db.sets, async () => {
    await db.sessions.put(session)
    await db.workoutExercises.bulkPut(wes)
    await db.sets.bulkPut(sets)
  })
  return { session }
}

/** 从模板开始训练 */
export async function startFromTemplate(templateId: ID, date = todayStr()): Promise<WorkoutSession | null> {
  const tpl = await db.templates.get(templateId)
  if (!tpl) return null
  const session = await startSession(tpl.bodyParts, { date, templateId })
  const now = Date.now()
  for (let i = 0; i < tpl.items.length; i++) {
    const item = tpl.items[i]
    const weId = uid()
    await db.workoutExercises.put({
      id: weId,
      sessionId: session.id,
      exerciseId: item.exerciseId,
      order: i,
      createdAt: now,
    })
    const sets: WorkoutSet[] = []
    let n = 1
    for (const g of item.sets) {
      for (let c = 0; c < Math.max(1, g.count); c++) {
        sets.push({
          id: uid(),
          workoutExerciseId: weId,
          sessionId: session.id,
          exerciseId: item.exerciseId,
          setNumber: n++,
          weight: g.weight,
          reps: g.reps,
          weightType: g.weightType,
          date,
          createdAt: now,
        })
      }
    }
    if (sets.length) await db.sets.bulkPut(sets)
  }
  return session
}

export interface SessionDetail {
  session: WorkoutSession
  exercises: { id: ID; order: number; exercise: Exercise; sets: WorkoutSet[] }[]
}

export async function getSessionDetail(sessionId: ID): Promise<SessionDetail | null> {
  const session = await db.sessions.get(sessionId)
  if (!session) return null
  const wes = (await db.workoutExercises.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.order - b.order)
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  const exs = await db.exercises.toArray()
  const exMap = new Map(exs.map((e) => [e.id, e]))
  return {
    session,
    exercises: wes
      .map((we) => {
        const exercise =
          exMap.get(we.exerciseId) ??
          ({
            id: we.exerciseId,
            name: '已删除动作',
            bodyPart: 'chest',
            equipment: 'other',
            defaultWeightType: 'weight',
            isCustom: true,
            createdAt: 0,
            updatedAt: 0,
            deletedAt: 1,
          } as Exercise)
        return {
          id: we.id,
          order: we.order,
          exercise,
          sets: sets
            .filter((s) => s.workoutExerciseId === we.id)
            .sort((a, b) => a.setNumber - b.setNumber),
        }
      })
      .filter((x) => !!x.exercise),
  }
}

export async function updateSession(id: ID, patch: Partial<WorkoutSession>): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: Date.now() })
}

export async function discardSession(id: ID): Promise<void> {
  await db.transaction('rw', db.sessions, db.workoutExercises, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete()
    await db.workoutExercises.where('sessionId').equals(id).delete()
    await db.sessions.delete(id)
  })
}

export interface CompletionResult {
  newPRs: { exerciseId: ID; exerciseName: string; type: PRType; value: number; weight: number; reps: number; date: string }[]
}

/** 完成训练:重算相关动作 PR,返回本次产生的新 PR 列表(用于庆祝动画) */
export async function completeSession(
  id: ID,
  patch: { notes?: string; feel?: FeelLevel; durationSec?: number },
): Promise<CompletionResult> {
  const session = await db.sessions.get(id)
  if (!session) return { newPRs: [] }
  const wes = await db.workoutExercises.where('sessionId').equals(id).toArray()
  const exerciseIds = [...new Set(wes.map((w) => w.exerciseId))]

  // 前置:记录完成前各动作的当前 PR
  const before = new Map<string, Map<PRType, number>>()
  for (const eid of exerciseIds) {
    const prs = await db.personalRecords.where('exerciseId').equals(eid).toArray()
    before.set(eid, new Map(prs.map((p) => [p.type, p.value])))
  }

  await db.sessions.update(id, { ...patch, status: 'completed', completedAt: Date.now(), updatedAt: Date.now() })
  for (const eid of exerciseIds) await rebuildPRsForExercise(eid)

  // 后置:对比得到新 PR(仅取 组级类型,容量 PR 不弹庆祝;每个动作只保留最显著一条)
  const newPRs: CompletionResult['newPRs'] = []
  const exMap = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  const prPriority: Record<PRType, number> = { est1rm: 3, maxWeight: 2, maxReps: 1, volume: 0 }
  for (const eid of exerciseIds) {
    const prs = await db.personalRecords.where('exerciseId').equals(eid).toArray()
    const b = before.get(eid) ?? new Map()
    let bestForExercise: CompletionResult['newPRs'][number] | null = null
    for (const p of prs) {
      if (p.type === 'volume') continue
      const prev = b.get(p.type)
      if (prev === undefined || p.value > prev) {
        const item = {
          exerciseId: eid,
          exerciseName: exMap.get(eid)?.name ?? '动作',
          type: p.type,
          value: p.value,
          weight: p.weight,
          reps: p.reps,
          date: p.date,
        }
        if (!bestForExercise || prPriority[item.type] > prPriority[bestForExercise.type]) {
          bestForExercise = item
        }
      }
    }
    if (bestForExercise) newPRs.push(bestForExercise)
  }
  return { newPRs }
}

/* =============== 训练动作 & 组 =============== */

export async function addExerciseToSession(sessionId: ID, exerciseId: ID): Promise<ID> {
  const existing = await db.workoutExercises.where('sessionId').equals(sessionId).toArray()
  const id = uid()
  await db.workoutExercises.put({
    id,
    sessionId,
    exerciseId,
    order: existing.length,
    createdAt: Date.now(),
  })
  return id
}

export async function removeExerciseFromSession(workoutExerciseId: ID): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId)
  await db.transaction('rw', db.workoutExercises, db.sets, async () => {
    await db.sets.where('workoutExerciseId').equals(workoutExerciseId).delete()
    await db.workoutExercises.delete(workoutExerciseId)
  })
  // 历史数据被修改,重算该动作 PR
  if (we) await rebuildPRsForExercise(we.exerciseId)
}

export async function reorderSessionExercises(_sessionId: ID, orderedIds: ID[]): Promise<void> {
  await db.transaction('rw', db.workoutExercises, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.workoutExercises.update(orderedIds[i], { order: i })
    }
  })
}

export async function addSet(
  workoutExerciseId: ID,
  data: { weight: number; reps: number; weightType: WeightType; rpe?: number },
): Promise<void> {
  const we = await db.workoutExercises.get(workoutExerciseId)
  if (!we) throw new Error('训练动作不存在')
  const session = await db.sessions.get(we.sessionId)
  if (!session) throw new Error('训练不存在')
  const existing = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray()
  const set: WorkoutSet = {
    id: uid(),
    workoutExerciseId,
    sessionId: we.sessionId,
    exerciseId: we.exerciseId,
    setNumber: existing.length + 1,
    weight: data.weight,
    reps: data.reps,
    weightType: data.weightType,
    rpe: data.rpe,
    date: session.date,
    createdAt: Date.now(),
  }
  await db.sets.put(set)
}

export async function addSetBulk(
  workoutExerciseId: ID,
  data: { weight: number; reps: number; count: number; weightType: WeightType; rpe?: number },
): Promise<void> {
  for (let i = 0; i < data.count; i++) await addSet(workoutExerciseId, data)
}

export async function updateSet(setId: ID, patch: Partial<Pick<WorkoutSet, 'weight' | 'reps' | 'rpe'>>): Promise<void> {
  await db.sets.update(setId, patch)
  // 重量/次数变化影响 PR(尤其是编辑历史训练时)
  if (patch.weight !== undefined || patch.reps !== undefined) {
    const set = await db.sets.get(setId)
    if (set) await rebuildPRsForExercise(set.exerciseId)
  }
}

export async function deleteSet(setId: ID): Promise<void> {
  const s = await db.sets.get(setId)
  if (!s) return
  await db.sets.delete(setId)
  // 重排 setNumber,保持连续
  const siblings = (await db.sets.where('workoutExerciseId').equals(s.workoutExerciseId).toArray()).sort(
    (a, b) => a.setNumber - b.setNumber,
  )
  await db.transaction('rw', db.sets, async () => {
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].setNumber !== i + 1) await db.sets.update(siblings[i].id, { setNumber: i + 1 })
    }
  })
  // 历史数据可能被修改,重算该动作 PR
  await rebuildPRsForExercise(s.exerciseId)
}

/* =============== 日状态(休息日) =============== */

export async function markRest(date: string, note?: string): Promise<void> {
  await db.dailyStatuses.put({ date, status: 'rest', note })
}

export async function unmarkRest(date: string): Promise<void> {
  await db.dailyStatuses.delete(date)
}

export async function getRestMap(dates: string[]): Promise<Map<string, DailyStatus>> {
  const rows = await db.dailyStatuses.bulkGet(dates)
  const map = new Map<string, DailyStatus>()
  rows.forEach((r) => {
    if (r) map.set(r.date, r)
  })
  return map
}

/* =============== 动作管理 =============== */

export async function createExercise(data: {
  name: string
  bodyPart: BodyPartId
  defaultWeightType?: WeightType
}): Promise<Exercise> {
  const now = Date.now()
  const exercise: Exercise = {
    id: uid(),
    name: data.name.trim(),
    bodyPart: data.bodyPart,
    equipment: guessEquipment(data.defaultWeightType ?? 'weight'),
    defaultWeightType: data.defaultWeightType ?? 'weight',
    isCustom: true,
    createdAt: now,
    updatedAt: now,
  }
  if (!exercise.name) throw new Error('动作名称不能为空')
  const dup = await db.exercises.where('name').equals(exercise.name).first()
  if (dup && !dup.deletedAt) throw new Error('已存在同名动作')
  await db.exercises.put(exercise)
  return exercise
}

function guessEquipment(t: WeightType): Exercise['equipment'] {
  if (t === 'bodyweight') return 'bodyweight'
  if (t === 'assisted') return 'assisted'
  if (t === 'dumbbell') return 'dumbbell'
  return 'machine'
}

export async function updateExercise(
  id: ID,
  patch: Partial<Pick<Exercise, 'name' | 'bodyPart' | 'defaultWeightType'>>,
): Promise<void> {
  const ex = await db.exercises.get(id)
  if (!ex) throw new Error('动作不存在')
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('动作名称不能为空')
  if (patch.name) {
    const dup = await db.exercises.where('name').equals(patch.name.trim()).first()
    if (dup && dup.id !== id && !dup.deletedAt) throw new Error('已存在同名动作')
    patch.name = patch.name.trim()
  }
  await db.exercises.update(id, { ...patch, updatedAt: Date.now() })
}

/** 软删除:历史训练仍正确关联展示 */
export async function deleteExercise(id: ID): Promise<void> {
  await db.exercises.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
}

export async function restoreExercise(id: ID): Promise<void> {
  await db.exercises.update(id, { deletedAt: undefined, updatedAt: Date.now() })
}

/* =============== 模板 =============== */

export async function saveTemplate(data: {
  id?: ID
  name: string
  bodyParts: BodyPartId[]
  items: { exerciseId: ID; sets: { weight: number; reps: number; count: number; weightType: WeightType }[] }[]
}): Promise<WorkoutTemplate> {
  if (!data.name.trim()) throw new Error('模板名称不能为空')
  if (!data.items.length) throw new Error('模板至少需要一个动作')
  const now = Date.now()
  const tpl: WorkoutTemplate = {
    id: data.id ?? uid(),
    name: data.name.trim(),
    bodyParts: data.bodyParts,
    items: data.items,
    createdAt: now,
    updatedAt: now,
  }
  await db.templates.put(tpl)
  return tpl
}

export async function saveSessionAsTemplate(sessionId: ID, name: string): Promise<WorkoutTemplate> {
  const detail = await getSessionDetail(sessionId)
  if (!detail) throw new Error('训练不存在')
  return saveTemplate({
    name,
    bodyParts: detail.session.bodyParts,
    items: detail.exercises.map((e) => ({
      exerciseId: e.exercise.id,
      sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps, count: 1, weightType: s.weightType })),
    })),
  })
}

export async function deleteTemplate(id: ID): Promise<void> {
  await db.templates.delete(id)
}

/* =============== Demo 数据 =============== */

export async function clearDemoData(): Promise<void> {
  const demoSessions = await db.sessions.where('isDemo').equals(1).toArray()
  const demoSessionIds = demoSessions.map((s) => s.id)
  await db.transaction(
    'rw',
    [db.sessions, db.workoutExercises, db.sets, db.dailyStatuses, db.templates, db.personalRecords, db.prEvents],
    async () => {
      for (const sid of demoSessionIds) {
        await db.sets.where('sessionId').equals(sid).delete()
        await db.workoutExercises.where('sessionId').equals(sid).delete()
      }
      await db.sessions.bulkDelete(demoSessionIds)
      await db.dailyStatuses.where('isDemo').equals(1).delete()
      const demoTpls = await db.templates.filter((t) => t.isDemo === 1).toArray()
      await db.templates.bulkDelete(demoTpls.map((t) => t.id))
    },
  )
  // 重算全部 PR,清除 Demo 造成的记录
  await db.prEvents.filter((e) => e.isDemo === 1).delete()
  await rebuildAllPRs()
}

/* =============== 清空全部 =============== */

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.exercises, db.sessions, db.workoutExercises, db.sets, db.dailyStatuses, db.templates, db.personalRecords, db.prEvents, db.aiAnalyses, db.appState, db.activitySessions],
    async () => {
      await Promise.all([
        db.exercises.clear(),
        db.sessions.clear(),
        db.workoutExercises.clear(),
        db.sets.clear(),
        db.dailyStatuses.clear(),
        db.templates.clear(),
        db.personalRecords.clear(),
        db.prEvents.clear(),
        db.aiAnalyses.clear(),
        db.activitySessions.clear(),
      ])
      // 重置播种标记(保留用户设置:单位/主题/昵称等其它 appState)
      await db.appState.delete('defaultExercisesSeeded')
    },
  )
  await ensureDefaultExercises()
}

/* =============== 展示辅助 =============== */

export function feelLabel(f?: FeelLevel): string {
  return f ? FEEL_LABEL[f] : ''
}
