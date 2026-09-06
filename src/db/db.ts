import Dexie, { type Table } from 'dexie'
import type {
  ActivitySession,
  AIAnalysis,
  AppStateRow,
  DailyStatus,
  Exercise,
  PREvent,
  PersonalRecord,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from './models'

/**
 * MyGym OS 本地数据库(IndexedDB via Dexie)
 *
 * 索引设计面向高频查询:
 * - sets: [exerciseId+date] → 动作力量历史 / 月度统计
 * - sets: [sessionId+setNumber] → 训练详情按序展示
 * - sessions: date / status → 日历、时间线、活跃会话
 * - prEvents: [exerciseId+createdAt] → 动作 PR 时间线
 */
export class MyGymDB extends Dexie {
  exercises!: Table<Exercise, string>
  sessions!: Table<WorkoutSession, string>
  workoutExercises!: Table<WorkoutExercise, string>
  sets!: Table<WorkoutSet, string>
  dailyStatuses!: Table<DailyStatus, string>
  templates!: Table<WorkoutTemplate, string>
  personalRecords!: Table<PersonalRecord, string>
  prEvents!: Table<PREvent, string>
  aiAnalyses!: Table<AIAnalysis, string>
  appState!: Table<AppStateRow, string>
  /** 非力量运动(羽毛球等)通用会话表(v2) */
  activitySessions!: Table<ActivitySession, string>

  constructor() {
    super('mygym-os')
    this.version(1).stores({
      exercises: 'id, name, bodyPart, deletedAt, [bodyPart+deletedAt]',
      sessions: 'id, date, status, [status+date], isDemo',
      workoutExercises: 'id, sessionId, exerciseId, [sessionId+order]',
      sets:
        'id, sessionId, exerciseId, workoutExerciseId, date, isDemo, [exerciseId+date], [sessionId+setNumber], [exerciseId+weight]',
      dailyStatuses: 'date, isDemo',
      templates: 'id, name, updatedAt',
      personalRecords: 'id, exerciseId, [exerciseId+type]',
      prEvents: 'id, exerciseId, sessionId, date, [exerciseId+createdAt]',
      aiAnalyses: 'id, kind, period',
      appState: 'key',
    })

    // v2:新增非力量运动表(增量迁移,力量数据结构不变)
    this.version(2).stores({
      activitySessions: 'id, date, sport, isDemo, [sport+date], [date+isDemo]',
    })
  }
}

export const db = new MyGymDB()

/** appState KV 便捷读写 */
export async function getAppState<T>(key: string, fallback: T): Promise<T> {
  const row = await db.appState.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setAppState(key: string, value: unknown): Promise<void> {
  await db.appState.put({ key, value, updatedAt: Date.now() })
}

/* ---------------- 全局统计(供设置页/关于) ---------------- */

export async function getDataStats() {
  const [sessions, sets, exercises] = await Promise.all([
    db.sessions.filter((s) => s.status === 'completed').count(),
    db.sets.count(),
    db.exercises.filter((e) => !e.deletedAt).count(),
  ])
  return { sessions, sets, exercises }
}
