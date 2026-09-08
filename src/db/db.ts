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
 * 多用户隔离策略(2.0 第一阶段):
 * - 未登录(或云端功能未启用):使用遗留库 `mygym-os`,行为与单用户版完全一致。
 * - 登录后:每个用户使用自己的库 `mygym-os-u-<userId>`,不同账号的数据
 *   在浏览器层面物理隔离;登录/登出通过 setActiveUser() 切换。
 * - 遗留库永不被删除:登录后通过「认领」把旧数据复制进当前用户的库,
 *   再上传云端,任何一步失败原数据都还在。
 *
 * `db` 采用 ES Module live binding:切换用户后,所有 `import { db }`
 * 的模块在下一次属性访问时自动指向新实例,现有代码无需改动。
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

  constructor(name = 'mygym-os') {
    super(name)
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

/** 遗留单用户库(未登录时使用;老用户既有数据都在这里,永不删除) */
export const LEGACY_DB_NAME = 'mygym-os'

/** 需要归属用户的表(appState 是设备级 KV,不做用户隔离) */
const USER_DATA_TABLES = [
  'exercises',
  'sessions',
  'workoutExercises',
  'sets',
  'dailyStatuses',
  'templates',
  'personalRecords',
  'prEvents',
  'activitySessions',
  'aiAnalyses',
] as const

function createInstance(name: string, ownerUserId: string | null): MyGymDB {
  const instance = new MyGymDB(name)
  if (ownerUserId) {
    // 写入自动归属:所有用户数据表在创建行时补 userId,
    // 上层代码(repo/activity 等)无需感知当前用户。
    for (const t of USER_DATA_TABLES) {
      instance.table(t).hook('creating', (_primKey, obj) => {
        if (obj && typeof obj === 'object' && (obj as { userId?: string }).userId === undefined) {
          ;(obj as { userId?: string }).userId = ownerUserId
        }
      })
    }
  }
  return instance
}

const legacyDb = createInstance(LEGACY_DB_NAME, null)
const userDbs = new Map<string, MyGymDB>()

/**
 * 当前生效的数据库实例(live binding)。
 * 未登录 → 遗留库;登录 → 当前用户的库。
 */
export let db: MyGymDB = legacyDb

/** 当前登录用户 id(未登录为 null)。与 db 实例始终同步。 */
export let activeUserId: string | null = null

/**
 * 切换当前用户(登录 / 登出)。
 * 返回新的 db 实例;调用方应触发 UI 重挂载,使 useLiveQuery 订阅切换到新实例。
 */
export function setActiveUser(userId: string | null): MyGymDB {
  activeUserId = userId
  if (!userId) {
    db = legacyDb
    return db
  }
  let userDb = userDbs.get(userId)
  if (!userDb) {
    userDb = createInstance(`mygym-os-u-${userId}`, userId)
    userDbs.set(userId, userDb)
  }
  db = userDb
  return db
}

/** 当前遗留库中未归属(认领前)的旧数据是否存在:供登录后迁移提示 */
export async function getLegacyDataCounts(): Promise<{ sessions: number; sets: number; activities: number }> {
  const [sessions, sets, activities] = await Promise.all([
    legacyDb.sessions.count(),
    legacyDb.sets.count(),
    legacyDb.activitySessions.count(),
  ])
  return { sessions, sets, activities }
}

/** 遗留库实例(仅迁移/认领流程使用) */
export function getLegacyDb(): MyGymDB {
  return legacyDb
}

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
