import { db } from '@/db/db'
import { ensureDefaultExercises } from './repo'
import { rebuildAllPRs } from './pr'
import { WEIGHT_TYPE_LABEL, type BackupFile } from '@/db/models'
import { setVolume } from './calc'

/**
 * 数据导出/导入 —— 数据是用户的,必须可以拿走。
 * JSON:完整备份(版本化);CSV:训练组明细,便于分析。
 */

export async function exportJSON(): Promise<{ blob: Blob; filename: string }> {
  const [exercises, sessions, workoutExercises, sets, dailyStatuses, templates, personalRecords, prEvents, appState, activitySessions] =
    await Promise.all([
      db.exercises.toArray(),
      db.sessions.toArray(),
      db.workoutExercises.toArray(),
      db.sets.toArray(),
      db.dailyStatuses.toArray(),
      db.templates.toArray(),
      db.personalRecords.toArray(),
      db.prEvents.toArray(),
      db.appState.toArray(),
      db.activitySessions.toArray(),
    ])
  const backup: BackupFile = {
    app: 'MyGymOS',
    schema: 2,
    exportedAt: new Date().toISOString(),
    unit: 'kg',
    data: {
      exercises,
      sessions,
      activitySessions,
      workoutExercises,
      sets,
      dailyStatuses,
      templates,
      personalRecords,
      prEvents,
      appState,
    },
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const date = new Date().toISOString().slice(0, 10)
  return { blob, filename: `mygym-os-backup-${date}.json` }
}

const CSV_HEADER = [
  '日期',
  '训练ID',
  '训练状态',
  '动作',
  '部位',
  '组号',
  '重量(kg)',
  '次数',
  '重量形式',
  'RPE',
  '单组容量(kg)',
]

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export async function exportCSV(): Promise<{ blob: Blob; filename: string }> {
  const [sets, sessions, exs] = await Promise.all([
    db.sets.orderBy('date').toArray(),
    db.sessions.toArray(),
    db.exercises.toArray(),
  ])
  const sMap = new Map(sessions.map((s) => [s.id, s]))
  const eMap = new Map(exs.map((e) => [e.id, e]))
  const rows: string[][] = [CSV_HEADER]
  for (const s of sets) {
    const session = sMap.get(s.sessionId)
    const ex = eMap.get(s.exerciseId)
    rows.push([
      s.date,
      s.sessionId,
      session?.status ?? '',
      ex?.name ?? '已删除动作',
      ex?.bodyPart ?? '',
      String(s.setNumber),
      String(s.weight),
      String(s.reps),
      WEIGHT_TYPE_LABEL[s.weightType],
      s.rpe !== undefined ? String(s.rpe) : '',
      String(setVolume(s)),
    ])
  }
  const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const date = new Date().toISOString().slice(0, 10)
  return { blob, filename: `mygym-os-sets-${date}.csv` }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export interface ImportResult {
  sessions: number
  sets: number
  exercises: number
  activities: number
}

/** 导入 JSON 备份。mode=merge 合并(同 ID 覆盖),mode=replace 清空后导入 */
export async function importJSON(file: File, mode: 'merge' | 'replace' = 'merge'): Promise<ImportResult> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const backup = parsed as BackupFile
  if (!backup || backup.app !== 'MyGymOS' || !backup.data) {
    throw new Error('不是 MyGym OS 的备份文件')
  }
  const d = backup.data
  const requiredCollections = ['exercises', 'sessions', 'workoutExercises', 'sets'] as const
  if (requiredCollections.some((key) => !Array.isArray(d[key]))) {
    throw new Error('备份文件缺少必要字段')
  }
  const exerciseIdMap = new Map<string, string>()
  if (mode === 'merge') {
    const existingDefaults = new Map(
      (await db.exercises.toArray())
        .filter((exercise) => !exercise.isCustom)
        .map((exercise) => [`${exercise.name}\u0000${exercise.bodyPart}`, exercise.id]),
    )
    for (const exercise of d.exercises) {
      if (exercise.isCustom) continue
      const existingId = existingDefaults.get(`${exercise.name}\u0000${exercise.bodyPart}`)
      if (existingId && existingId !== exercise.id) exerciseIdMap.set(exercise.id, existingId)
    }
  }
  const remapExerciseId = (id: string): string => exerciseIdMap.get(id) ?? id
  const exercises = d.exercises.map((exercise) => ({ ...exercise, id: remapExerciseId(exercise.id) }))
  const workoutExercises = d.workoutExercises?.map((item) => ({ ...item, exerciseId: remapExerciseId(item.exerciseId) }))
  const sets = d.sets?.map((set) => ({ ...set, exerciseId: remapExerciseId(set.exerciseId) }))
  const templates = d.templates?.map((template) => ({
    ...template,
    items: template.items.map((item) => ({ ...item, exerciseId: remapExerciseId(item.exerciseId) })),
  }))
  const personalRecords = d.personalRecords?.map((record) => ({
    ...record,
    id: `${remapExerciseId(record.exerciseId)}:${record.type}`,
    exerciseId: remapExerciseId(record.exerciseId),
  }))
  const prEvents = d.prEvents?.map((event) => ({ ...event, exerciseId: remapExerciseId(event.exerciseId) }))
  if (mode === 'replace') {
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
      },
    )
  }
  await db.transaction(
    'rw',
    [db.exercises, db.sessions, db.workoutExercises, db.sets, db.dailyStatuses, db.templates, db.personalRecords, db.prEvents, db.appState, db.activitySessions],
    async () => {
      if (exercises) await db.exercises.bulkPut(exercises)
      if (d.sessions) await db.sessions.bulkPut(d.sessions)
      // schema 2:运动记录(不依赖 exercises,无需重映射)
      if (d.activitySessions) await db.activitySessions.bulkPut(d.activitySessions)
      if (workoutExercises) await db.workoutExercises.bulkPut(workoutExercises)
      if (sets) await db.sets.bulkPut(sets)
      if (d.dailyStatuses) await db.dailyStatuses.bulkPut(d.dailyStatuses)
      if (templates) await db.templates.bulkPut(templates)
      if (personalRecords) await db.personalRecords.bulkPut(personalRecords)
      if (prEvents) await db.prEvents.bulkPut(prEvents)
      if (d.appState) await db.appState.bulkPut(d.appState)
    },
  )
  await rebuildAllPRs()
  return {
    sessions: d.sessions?.length ?? 0,
    sets: d.sets?.length ?? 0,
    exercises: d.exercises?.length ?? 0,
    activities: d.activitySessions?.length ?? 0,
  }
}

/** 确保首次启动基础数据存在 */
export async function bootstrapDB(): Promise<void> {
  await ensureDefaultExercises()
}
