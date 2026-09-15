import type { SqliteValue } from './sqlite.js'

/**
 * 前端数据模型(驼峰,BackupFile JSON 形态)⇄ SQLite 行(蛇形)的声明式映射。
 * 导入 / 导出 / CRUD 共用,避免每个端点手写转换。
 * userId 列由服务端统一从 token 注入,永远不信任请求体里的值。
 */

export type FieldType = 'text' | 'int' | 'real' | 'json'

export interface FieldDef {
  col: string
  type: FieldType
  /** 可选字段:undefined/null 存 NULL,读出时省略 */
  optional?: boolean
}

export interface TableDef {
  /** SQL 物理表名(蛇形) */
  sqlName: string
  /** 模型字段名 → 列定义;userId 由映射层自动处理,不在此列 */
  fields: Record<string, FieldDef>
  /** 主键字段名;'date' 表示以 (user_id, date) 为主键的表(dailyStatuses) */
  pk: 'id' | 'date'
}

export const TABLES: Record<string, TableDef> = {
  exercises: {
    sqlName: 'exercises',
    pk: 'id',
    fields: {
      name: { col: 'name', type: 'text' },
      bodyPart: { col: 'body_part', type: 'text' },
      equipment: { col: 'equipment', type: 'text' },
      defaultWeightType: { col: 'default_weight_type', type: 'text' },
      isCustom: { col: 'is_custom', type: 'int' },
      deletedAt: { col: 'deleted_at', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
      updatedAt: { col: 'updated_at', type: 'int' },
    },
  },
  sessions: {
    sqlName: 'sessions',
    pk: 'id',
    fields: {
      date: { col: 'date', type: 'text' },
      status: { col: 'status', type: 'text' },
      bodyParts: { col: 'body_parts', type: 'json' },
      title: { col: 'title', type: 'text', optional: true },
      notes: { col: 'notes', type: 'text', optional: true },
      feel: { col: 'feel', type: 'int', optional: true },
      durationSec: { col: 'duration_sec', type: 'int', optional: true },
      startedAt: { col: 'started_at', type: 'int' },
      completedAt: { col: 'completed_at', type: 'int', optional: true },
      copiedFromSessionId: { col: 'copied_from_session_id', type: 'text', optional: true },
      templateId: { col: 'template_id', type: 'text', optional: true },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
      updatedAt: { col: 'updated_at', type: 'int' },
    },
  },
  workoutExercises: {
    sqlName: 'workout_exercises',
    pk: 'id',
    fields: {
      sessionId: { col: 'session_id', type: 'text' },
      exerciseId: { col: 'exercise_id', type: 'text' },
      order: { col: 'sort_order', type: 'int' },
      note: { col: 'note', type: 'text', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
    },
  },
  sets: {
    sqlName: 'sets',
    pk: 'id',
    fields: {
      workoutExerciseId: { col: 'workout_exercise_id', type: 'text' },
      sessionId: { col: 'session_id', type: 'text' },
      exerciseId: { col: 'exercise_id', type: 'text' },
      setNumber: { col: 'set_number', type: 'int' },
      weight: { col: 'weight', type: 'real' },
      reps: { col: 'reps', type: 'int' },
      weightType: { col: 'weight_type', type: 'text' },
      rpe: { col: 'rpe', type: 'real', optional: true },
      date: { col: 'date', type: 'text' },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
    },
  },
  dailyStatuses: {
    sqlName: 'daily_statuses',
    pk: 'date',
    fields: {
      date: { col: 'date', type: 'text' },
      status: { col: 'status', type: 'text' },
      note: { col: 'note', type: 'text', optional: true },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
    },
  },
  templates: {
    sqlName: 'templates',
    pk: 'id',
    fields: {
      name: { col: 'name', type: 'text' },
      bodyParts: { col: 'body_parts', type: 'json' },
      items: { col: 'items', type: 'json' },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
      updatedAt: { col: 'updated_at', type: 'int' },
    },
  },
  personalRecords: {
    sqlName: 'personal_records',
    pk: 'id',
    fields: {
      exerciseId: { col: 'exercise_id', type: 'text' },
      type: { col: 'type', type: 'text' },
      value: { col: 'value', type: 'real' },
      weight: { col: 'weight', type: 'real' },
      reps: { col: 'reps', type: 'int' },
      sets: { col: 'sets_count', type: 'int', optional: true },
      date: { col: 'date', type: 'text' },
      sessionId: { col: 'session_id', type: 'text' },
      updatedAt: { col: 'updated_at', type: 'int' },
    },
  },
  prEvents: {
    sqlName: 'pr_events',
    pk: 'id',
    fields: {
      exerciseId: { col: 'exercise_id', type: 'text' },
      type: { col: 'type', type: 'text' },
      value: { col: 'value', type: 'real' },
      weight: { col: 'weight', type: 'real' },
      reps: { col: 'reps', type: 'int' },
      weightType: { col: 'weight_type', type: 'text' },
      prevValue: { col: 'prev_value', type: 'real', optional: true },
      date: { col: 'date', type: 'text' },
      sessionId: { col: 'session_id', type: 'text' },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
    },
  },
  activitySessions: {
    sqlName: 'activity_sessions',
    pk: 'id',
    fields: {
      sport: { col: 'sport', type: 'text' },
      date: { col: 'date', type: 'text' },
      startTime: { col: 'start_time', type: 'int', optional: true },
      durationMin: { col: 'duration_min', type: 'int', optional: true },
      venue: { col: 'venue', type: 'text', optional: true },
      playType: { col: 'play_type', type: 'text', optional: true },
      partners: { col: 'partners', type: 'text', optional: true },
      isMatch: { col: 'is_match', type: 'int', optional: true },
      score: { col: 'score', type: 'json', optional: true },
      scoreText: { col: 'score_text', type: 'text', optional: true },
      indoor: { col: 'indoor', type: 'text', optional: true },
      surface: { col: 'surface', type: 'text', optional: true },
      nature: { col: 'nature', type: 'text', optional: true },
      trainingTypes: { col: 'training_types', type: 'json', optional: true },
      trainingFocus: { col: 'training_focus', type: 'text', optional: true },
      sets: { col: 'set_scores', type: 'json', optional: true },
      technique: { col: 'technique', type: 'json', optional: true },
      fitness: { col: 'fitness', type: 'json', optional: true },
      volleyballSessionType: { col: 'volleyball_session_type', type: 'text', optional: true },
      volleyballPosition: { col: 'volleyball_position', type: 'text', optional: true },
      volleyballSets: { col: 'volleyball_sets', type: 'json', optional: true },
      volleyballStats: { col: 'volleyball_stats', type: 'json', optional: true },
      distanceM: { col: 'distance_m', type: 'real', optional: true },
      distanceUnit: { col: 'distance_unit', type: 'text', optional: true },
      stroke: { col: 'stroke', type: 'text', optional: true },
      poolLengthM: { col: 'pool_length_m', type: 'real', optional: true },
      laps: { col: 'laps', type: 'int', optional: true },
      calories: { col: 'calories', type: 'real', optional: true },
      rpe: { col: 'rpe', type: 'real', optional: true },
      notes: { col: 'notes', type: 'text', optional: true },
      isDemo: { col: 'is_demo', type: 'int', optional: true },
      createdAt: { col: 'created_at', type: 'int' },
      updatedAt: { col: 'updated_at', type: 'int' },
    },
  },
}

const COLUMN: Record<FieldType, string> = { text: 'TEXT', int: 'INTEGER', real: 'REAL', json: 'TEXT' }

/** 保证某张表的列齐全(新增字段时无需手工迁移,存量行补 NULL) */
export function ensureColumns(store: { db: { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[] } } }, table: string): void {
  const def = TABLES[table]
  if (!def) return
  const existing = store.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  const names = new Set(existing.map((r) => r.name))
  for (const key of Object.keys(def.fields)) {
    const f = def.fields[key]
    if (!names.has(f.col)) {
      store.db.exec(`ALTER TABLE ${table} ADD COLUMN ${f.col} ${COLUMN[f.type]}`)
    }
  }
}

function toJson(type: FieldType, value: unknown): SqliteValue {
  if (value === undefined || value === null) return null
  if (type === 'json') return JSON.stringify(value)
  if (type === 'int') {
    if (typeof value === 'boolean') return value ? 1 : 0
    return typeof value === 'number' ? Math.round(value) : (value as number)
  }
  if (type === 'real') return typeof value === 'number' ? value : Number(value)
  return String(value)
}

function fromJson(type: FieldType, raw: SqliteValue): unknown {
  if (raw === null || raw === undefined) return undefined
  if (type === 'json') {
    try {
      return JSON.parse(String(raw))
    } catch {
      return undefined
    }
  }
  if (type === 'int') return Number(raw)
  if (type === 'real') return Number(raw)
  return String(raw)
}

export function modelToRow(
  table: string,
  model: Record<string, unknown>,
  userId: string,
): { cols: string[]; values: SqliteValue[] } {
  const def = TABLES[table]
  const cols: string[] = ['user_id']
  const values: SqliteValue[] = [userId]
  for (const key of Object.keys(def.fields)) {
    const f = def.fields[key]
    cols.push(f.col)
    values.push(toJson(f.type, model[key]))
  }
  return { cols, values }
}

export function rowToModel(table: string, row: Record<string, SqliteValue>): Record<string, unknown> {
  const def = TABLES[table]
  const out: Record<string, unknown> = {}
  // 主键:id 表带 id 列;(user_id, date) 表的 date 已在字段映射中
  if (def.pk === 'id' && row.id !== undefined && row.id !== null) out.id = String(row.id)
  if (row.user_id !== undefined && row.user_id !== null) out.userId = String(row.user_id)
  for (const key of Object.keys(def.fields)) {
    const f = def.fields[key]
    const v = fromJson(f.type, row[f.col])
    if (v !== undefined) out[key] = v
  }
  return out
}

/** 基础合法性校验:返回错误消息,通过则返回 null。requireId=true 用于导入(必须带 id),创建时可为空由服务端生成 */
export function validateRow(table: string, model: Record<string, unknown>, requireId = false): string | null {
  const def = TABLES[table]
  if (typeof model !== 'object' || model === null) return '记录必须是对象'
  if (def.pk === 'id') {
    if (model.id === undefined) {
      if (requireId) return '缺少字符串 id'
    } else if (typeof model.id !== 'string' || !(model.id as string).trim()) {
      return 'id 不能为空'
    }
  }
  const dateFields = Object.keys(def.fields).filter((k) => def.fields[k].col === 'date')
  for (const f of dateFields) {
    if (typeof model[f] !== 'string' || !isCalendarDate(model[f] as string)) return '日期必须是有效的 YYYY-MM-DD'
  }
  for (const [key, field] of Object.entries(def.fields)) {
    const value = model[key]
    if (value === undefined || value === null) continue
    if (field.type === 'text' && typeof value !== 'string') return `${key} 必须是字符串`
    const booleanInt = field.type === 'int' && typeof value === 'boolean'
    if ((field.type === 'int' || field.type === 'real') && !booleanInt && (typeof value !== 'number' || !Number.isFinite(value))) return `${key} 必须是有限数字`
    if (field.type === 'int' && !booleanInt && !Number.isInteger(value)) return `${key} 必须是整数`
  }
  const requiredByTable: Record<string, string[]> = {
    exercises: ['name', 'bodyPart', 'defaultWeightType'],
    sessions: ['date', 'status', 'bodyParts'],
    workoutExercises: ['sessionId', 'exerciseId'],
    sets: ['workoutExerciseId', 'sessionId', 'exerciseId', 'setNumber', 'weight', 'reps', 'weightType', 'date'],
    dailyStatuses: ['date', 'status'],
    templates: ['name', 'bodyParts', 'items'],
    activitySessions: ['sport', 'date'],
  }
  for (const key of requiredByTable[table] || []) {
    const value = model[key]
    if (value === undefined || value === null || value === '') return `缺少 ${key}`
  }
  if (table === 'exercises') {
    if (!['chest', 'shoulders', 'back', 'biceps', 'triceps', 'legs'].includes(String(model.bodyPart))) return 'bodyPart 无效'
    if (!['weight', 'dumbbell', 'bodyweight', 'assisted'].includes(String(model.defaultWeightType))) return 'defaultWeightType 无效'
    if (String(model.name).trim().length > 100) return 'name 过长'
  }
  if (table === 'sessions') {
    if (!['active', 'completed'].includes(String(model.status))) return 'status 无效'
    if (!Array.isArray(model.bodyParts)) return 'bodyParts 必须是数组'
    if (model.durationSec !== undefined && !inRange(model.durationSec, 1, 604800, true)) return 'durationSec 必须是 1-604800 的整数'
  }
  if (table === 'sets') {
    if (!inRange(model.setNumber, 1, 100000, true)) return 'setNumber 必须是正整数'
    if (!inRange(model.reps, 1, 100000, true)) return 'reps 必须是正整数'
    if (!inRange(model.weight, -1000000, 1000000)) return 'weight 超出允许范围'
    if (!['weight', 'dumbbell', 'bodyweight', 'assisted'].includes(String(model.weightType))) return 'weightType 无效'
    if (model.rpe !== undefined && !inRange(model.rpe, 1, 10)) return 'rpe 必须是 1-10'
  }
  if (table === 'dailyStatuses' && !['rest', 'training'].includes(String(model.status))) return 'status 无效'
  if (table === 'templates') {
    if (!Array.isArray(model.bodyParts) || !Array.isArray(model.items)) return '模板内容必须是数组'
  }
  if (table === 'activitySessions') {
    const error = validateActivity(model)
    if (error) return error
  }
  return null
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function inRange(value: unknown, min: number, max: number, integer = false): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
}

function validateActivity(model: Record<string, unknown>): string | null {
  if (!['badminton', 'swimming', 'tennis', 'volleyball'].includes(String(model.sport))) return 'sport 无效'
  const positive: [string, number, boolean][] = [
    ['durationMin', 10080, false], ['distanceM', 10000000, false], ['poolLengthM', 10000, false],
    ['laps', 1000000, true], ['calories', 10000000, false],
  ]
  for (const [key, max, integer] of positive) {
    if (model[key] !== undefined && !inRange(model[key], Number.EPSILON, max, integer)) return `${key} 必须是有效正数`
  }
  if (model.rpe !== undefined && !inRange(model.rpe, 1, 10)) return 'rpe 必须是 1-10'
  if (model.startTime !== undefined && !inRange(model.startTime, 0, 9999999999999, true)) return 'startTime 无效'
  const lengths: Record<string, number> = { venue: 200, partners: 500, notes: 5000, scoreText: 500, trainingFocus: 2000 }
  for (const [key, max] of Object.entries(lengths)) {
    if (typeof model[key] === 'string' && (model[key] as string).length > max) return `${key} 过长`
  }
  if (model.trainingTypes !== undefined && !Array.isArray(model.trainingTypes)) return 'trainingTypes 必须是数组'
  if (model.score !== undefined) {
    if (!model.score || typeof model.score !== 'object' || Array.isArray(model.score)) return 'score 必须是对象'
    for (const value of Object.values(model.score as Record<string, unknown>)) {
      if (value !== undefined && value !== null && !inRange(value, 0, 1000000, true)) return '比分必须是非负整数'
    }
  }
  if (model.sets !== undefined) {
    if (!Array.isArray(model.sets)) return 'sets 必须是数组'
    for (const set of model.sets) {
      if (!set || typeof set !== 'object') return '逐盘比分格式无效'
      for (const value of Object.values(set as Record<string, unknown>)) {
        if (value !== undefined && value !== null && !inRange(value, 0, 99, true)) return '逐盘比分必须是 0-99 的整数'
      }
    }
  }
  for (const key of ['technique', 'fitness']) {
    const group = model[key]
    if (group === undefined) continue
    if (!group || typeof group !== 'object' || Array.isArray(group)) return `${key} 必须是对象`
    for (const value of Object.values(group as Record<string, unknown>)) {
      if (value !== undefined && value !== null && !inRange(value, 0, 10000000)) return `${key} 包含无效数字`
    }
  }
  if (model.volleyballSessionType !== undefined && !['training', 'casual', 'scrimmage', 'official'].includes(String(model.volleyballSessionType))) return 'volleyballSessionType 无效'
  if (model.volleyballPosition !== undefined && !['oh', 'mb', 'opp', 'setter', 'libero', 'none', 'other'].includes(String(model.volleyballPosition))) return 'volleyballPosition 无效'
  if (model.volleyballSets !== undefined) {
    if (!Array.isArray(model.volleyballSets)) return 'volleyballSets 必须是数组'
    for (const set of model.volleyballSets) {
      if (!set || typeof set !== 'object' || Array.isArray(set)) return '排球逐局比分格式无效'
      const row = set as Record<string, unknown>
      if (!inRange(row.ourScore, 0, 999, true) || !inRange(row.opponentScore, 0, 999, true)) return '排球逐局比分必须是 0-999 的整数'
    }
  }
  if (model.volleyballStats !== undefined) {
    if (!model.volleyballStats || typeof model.volleyballStats !== 'object' || Array.isArray(model.volleyballStats)) return 'volleyballStats 必须是对象'
    const groups = model.volleyballStats as Record<string, unknown>
    for (const group of Object.values(groups)) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return 'volleyballStats 分类格式无效'
      for (const value of Object.values(group as Record<string, unknown>)) {
        if (value !== undefined && value !== null && !inRange(value, 0, 1000000, true)) return 'volleyballStats 包含无效整数'
      }
    }
    const serve = (groups.serve ?? {}) as Record<string, number | undefined>
    const attack = (groups.attack ?? {}) as Record<string, number | undefined>
    const reception = (groups.reception ?? {}) as Record<string, number | undefined>
    const dig = (groups.dig ?? {}) as Record<string, number | undefined>
    const set = (groups.set ?? {}) as Record<string, number | undefined>
    const pairs: [number | undefined, number | undefined][] = [
      [serve.aces, serve.attempts], [serve.errors, serve.attempts],
      [attack.points, attack.attempts], [attack.errors, attack.attempts], [attack.blocked, attack.attempts],
      [reception.perfect, reception.attempts], [reception.errors, reception.attempts],
      [dig.successful, dig.attempts], [set.successful, set.attempts],
    ]
    if (pairs.some(([value, total]) => value !== undefined && total !== undefined && value > total)) return '排球子项统计不能大于总次数'
  }
  return null
}
