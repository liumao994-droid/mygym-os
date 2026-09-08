import { db } from '@/db/db'
import { ensureDefaultExercises } from './repo'
import { rebuildAllPRs } from './pr'
import { WEIGHT_TYPE_LABEL, SPORT_TYPES, type BackupFile, type SportType } from '@/db/models'
import { setVolume } from './calc'

/**
 * 数据导出/导入 —— 数据是用户的,必须可以拿走。
 * JSON:完整备份(版本化);CSV:训练组明细,便于分析。
 */

/** 当前本地资料的可传输快照。认证信息与旧版 AI Key 永不包含其中。 */
export async function createBackup(): Promise<BackupFile> {
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
  return {
    app: 'MyGymOS',
    schema: 3,
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
      appState: appState.filter((row) => row.key !== 'aiConfig'),
    },
  }
}

export function backupBlob(backup: BackupFile): Blob {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

export async function exportJSON(): Promise<{ blob: Blob; filename: string }> {
  const blob = backupBlob(await createBackup())
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
  /** 因 sportType 不认识而被跳过的运动记录数 */
  skippedActivities: number
}

/** 导入到账号隔离库时，归属只由当前数据库 hook 写入，绝不信任备份内的 userId。 */
function stripUserId<T>(row: T): T {
  const { userId: _userId, ...rest } = row as T & { userId?: string }
  return rest as T
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
  return importBackup(parsed as BackupFile, mode)
}

/** 将已经解析的备份合并/恢复到当前资料库。 */
export async function importBackup(backup: BackupFile, mode: 'merge' | 'replace' = 'merge'): Promise<ImportResult> {
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
  const exercises = d.exercises.map((exercise) => ({ ...stripUserId(exercise), id: remapExerciseId(exercise.id) }))
  const sessions = d.sessions.map(stripUserId)
  const workoutExercises = d.workoutExercises?.map((item) => ({ ...stripUserId(item), exerciseId: remapExerciseId(item.exerciseId) }))
  const sets = d.sets?.map((set) => ({ ...stripUserId(set), exerciseId: remapExerciseId(set.exerciseId) }))
  const templates = d.templates?.map((template) => ({
    ...stripUserId(template),
    items: template.items.map((item) => ({ ...item, exerciseId: remapExerciseId(item.exerciseId) })),
  }))
  const personalRecords = d.personalRecords?.map((record) => ({
    ...stripUserId(record),
    id: `${remapExerciseId(record.exerciseId)}:${record.type}`,
    exerciseId: remapExerciseId(record.exerciseId),
  }))
  const prEvents = d.prEvents?.map((event) => ({ ...stripUserId(event), exerciseId: remapExerciseId(event.exerciseId) }))
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
  // 运动记录 sanitize:必须含字符串 id/sport/date,数字字段容错转换;不合格条目跳过
  // sportType 不在已知列表内的记录同样跳过,避免未知运动类型导致界面崩溃(导入完成时会明确提示条数,不静默丢数据)
  const allActivitySessions = (d.activitySessions ?? []).filter(
    (a) => a && typeof a.id === 'string' && typeof a.sport === 'string' && typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date),
  )
  const skippedActivities = allActivitySessions.filter((a) => !SPORT_TYPES.includes(a.sport as SportType)).length
  const activitySessions = allActivitySessions.filter((a) => SPORT_TYPES.includes(a.sport as SportType)).map(stripUserId)
  const dailyStatuses = d.dailyStatuses?.map(stripUserId)
  await db.transaction(
    'rw',
    [db.exercises, db.sessions, db.workoutExercises, db.sets, db.dailyStatuses, db.templates, db.personalRecords, db.prEvents, db.appState, db.activitySessions],
    async () => {
      if (exercises) await db.exercises.bulkPut(exercises)
      if (sessions) await db.sessions.bulkPut(sessions)
      if (activitySessions.length) await db.activitySessions.bulkPut(activitySessions)
      if (workoutExercises) await db.workoutExercises.bulkPut(workoutExercises)
      if (sets) await db.sets.bulkPut(sets)
      if (dailyStatuses) await db.dailyStatuses.bulkPut(dailyStatuses)
      if (templates) await db.templates.bulkPut(templates)
      if (personalRecords) await db.personalRecords.bulkPut(personalRecords)
      if (prEvents) await db.prEvents.bulkPut(prEvents)
      if (d.appState) await db.appState.bulkPut(d.appState.filter((row) => row.key !== 'aiConfig'))
    },
  )
  await rebuildAllPRs()
  return {
    sessions: d.sessions?.length ?? 0,
    sets: d.sets?.length ?? 0,
    exercises: d.exercises?.length ?? 0,
    activities: activitySessions.length,
    skippedActivities,
  }
}

/** 确保首次启动基础数据存在 */
export async function bootstrapDB(): Promise<void> {
  // 清除旧版保存在 IndexedDB 的第三方 AI Key；新版只使用后端代理。
  await db.appState.delete('aiConfig')
  await ensureDefaultExercises()
}
