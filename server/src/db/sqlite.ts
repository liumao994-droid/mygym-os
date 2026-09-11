import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite 存储层(Node 22.5+ 内置 node:sqlite,零原生依赖)。
 *
 * 表结构与字段和前端 Dexie 模型一一对应(驼峰 → 蛇形),
 * 所有业务数据表都带 user_id 列:数据隔离在存储层强制执行,
 * 未来切换 Supabase / Postgres 时可按同一 schema 平移(见 README)。
 */

export type SqliteValue = string | number | bigint | Buffer | null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  password_hash TEXT,
  nickname TEXT NOT NULL,
  avatar TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'dev',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_nickname ON users(auth_provider, nickname);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_id)
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body_part TEXT NOT NULL,
  equipment TEXT NOT NULL,
  default_weight_type TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  body_parts TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  feel INTEGER,
  duration_sec INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  copied_from_session_id TEXT,
  template_id TEXT,
  is_demo INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_we_user_session ON workout_exercises(user_id, session_id);

CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workout_exercise_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL,
  weight_type TEXT NOT NULL,
  rpe REAL,
  date TEXT NOT NULL,
  is_demo INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sets_user_session ON sets(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_sets_user_exercise_date ON sets(user_id, exercise_id, date);

CREATE TABLE IF NOT EXISTS daily_statuses (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  is_demo INTEGER,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body_parts TEXT NOT NULL,
  items TEXT NOT NULL,
  is_demo INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);

CREATE TABLE IF NOT EXISTS personal_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  sets_count INTEGER,
  date TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_user_exercise ON personal_records(user_id, exercise_id);

CREATE TABLE IF NOT EXISTS pr_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  weight_type TEXT NOT NULL,
  prev_value REAL,
  date TEXT NOT NULL,
  session_id TEXT NOT NULL,
  is_demo INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_events_user_date ON pr_events(user_id, date);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time INTEGER,
  duration_min INTEGER,
  venue TEXT,
  play_type TEXT,
  partners TEXT,
  is_match INTEGER,
  score TEXT,
  score_text TEXT,
  indoor TEXT,
  surface TEXT,
  nature TEXT,
  training_types TEXT,
  training_focus TEXT,
  set_scores TEXT,
  technique TEXT,
  fitness TEXT,
  volleyball_session_type TEXT,
  volleyball_position TEXT,
  volleyball_sets TEXT,
  volleyball_stats TEXT,
  distance_m REAL,
  distance_unit TEXT,
  stroke TEXT,
  pool_length_m REAL,
  laps INTEGER,
  calories REAL,
  rpe REAL,
  notes TEXT,
  is_demo INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_user_sport_date ON activity_sessions(user_id, sport, date);

CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  period_type TEXT NOT NULL,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_type, period)
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_user ON ai_analyses(user_id, kind, period);

CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
`

export class Store {
  readonly db: DatabaseSync

  constructor(dbFile: string) {
    if (dbFile !== ':memory:') {
      mkdirSync(dirname(dbFile), { recursive: true })
    }
    this.db = new DatabaseSync(dbFile)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
    this.ensureUserAuthColumns()
  }

  /** 为已有 dev / 微信用户的 SQLite 文件补齐本地账号列，历史账号保持可用。 */
  private ensureUserAuthColumns(): void {
    const columns = new Set(this.all('PRAGMA table_info(users)').map((row) => String(row.name)))
    if (!columns.has('username')) this.db.exec('ALTER TABLE users ADD COLUMN username TEXT')
    if (!columns.has('password_hash')) this.db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT')
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL')
  }

  run(sql: string, ...params: SqliteValue[]): { changes: number | bigint } {
    return this.db.prepare(sql).run(...params)
  }

  get(sql: string, ...params: SqliteValue[]): Record<string, SqliteValue> | undefined {
    return this.db.prepare(sql).get(...params) as Record<string, SqliteValue> | undefined
  }

  all(sql: string, ...params: SqliteValue[]): Record<string, SqliteValue>[] {
    return this.db.prepare(sql).all(...params) as Record<string, SqliteValue>[]
  }

  /** 事务:SQLite 驱动为同步执行,异常时回滚 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  close(): void {
    this.db.close()
  }
}
