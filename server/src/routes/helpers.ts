import { HttpError, newId } from '../auth.js'
import { TABLES, modelToRow, rowToModel, validateRow } from '../db/tables.js'
import type { Store, SqliteValue } from '../db/sqlite.js'

/**
 * 数据 CRUD 共用助手 —— 所有查询/写入都强制 user_id = token 用户。
 * 请求体中的 userId 字段一律被忽略/覆盖,防止伪造归属。
 * 归属校验失败一律 404(不泄露其他用户资源的存在性,防 IDOR 探测)。
 */

export function ownRow(store: Store, table: string, id: string, userId: string): Record<string, SqliteValue> {
  const def = TABLES[table]
  const pkCol = def.pk === 'id' ? 'id' : 'date'
  const row = store.get(`SELECT * FROM ${def.sqlName} WHERE ${pkCol} = ? AND user_id = ?`, id, userId)
  if (!row) throw new HttpError(404, 'NOT_FOUND', '记录不存在')
  return row
}

/** 插入或更新(仅当已有行属于当前用户);属于他人时返回 conflict,由调用方计数/报错 */
export function upsertOwned(
  store: Store,
  table: string,
  model: Record<string, unknown>,
  userId: string,
): 'inserted' | 'updated' | 'conflict' {
  const def = TABLES[table]
  const { cols, values } = modelToRow(table, model, userId)
  const pkCol = def.pk === 'id' ? 'id' : 'date'
  const pkVal = def.pk === 'id' ? String(model.id) : String(model.date)
  const existing = store.get(`SELECT user_id FROM ${def.sqlName} WHERE ${pkCol} = ?`, pkVal)
  if (!existing) {
    const idCols = def.pk === 'id' ? ['id'] : []
    const allCols = [...idCols, ...cols]
    const allVals = def.pk === 'id' ? [pkVal, ...values] : [...values]
    store.run(
      `INSERT INTO ${def.sqlName} (${allCols.map((c) => `"${c}"`).join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`,
      ...allVals,
    )
    return 'inserted'
  }
  if (existing.user_id !== userId) return 'conflict'
  const assignments = cols.map((c) => `"${c}" = ?`).join(', ')
  store.run(`UPDATE ${def.sqlName} SET ${assignments} WHERE ${pkCol} = ? AND user_id = ?`, ...values, pkVal, userId)
  return 'updated'
}

/** 清洗请求体:只保留表定义中的字段,丢弃未知字段与伪造的归属信息,并做基础校验 */
export function parseModel(table: string, body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象')
  const err = validateRow(table, body as Record<string, unknown>)
  if (err) throw new HttpError(400, 'INVALID_RECORD', err)
  const def = TABLES[table]
  const incoming = body as Record<string, unknown>
  const clean: Record<string, unknown> = {}
  // `id` 不是普通字段映射的一部分，但创建时要保留客户端 id 以支持幂等重试。
  if (def.pk === 'id' && 'id' in incoming) clean.id = incoming.id
  for (const key of Object.keys(def.fields)) clean[key] = incoming[key]
  return clean
}

export function getModel(store: Store, table: string, id: string, userId: string): Record<string, unknown> {
  return rowToModel(table, ownRow(store, table, id, userId))
}

export function createOwned(store: Store, table: string, body: unknown, userId: string): Record<string, unknown> {
  const model = parseModel(table, body)
  const def = TABLES[table]
  // 服务端补默认时间戳(与前端行为一致)
  const now = Date.now()
  if ('createdAt' in def.fields && (model.createdAt === undefined || model.createdAt === null)) model.createdAt = now
  if ('updatedAt' in def.fields && (model.updatedAt === undefined || model.updatedAt === null)) model.updatedAt = now
  if (table === 'sessions' && (model.startedAt === undefined || model.startedAt === null)) model.startedAt = now
  if (def.pk === 'id') {
    const recId = typeof model.id === 'string' && model.id.trim() ? model.id : newId()
    model.id = recId
    // 客户端自带 id 时保持幂等语义:已存在(不管归属)一律 409,避免静默覆盖
    const exists = store.get(`SELECT user_id FROM ${def.sqlName} WHERE id = ?`, recId)
    if (exists) throw new HttpError(409, 'ALREADY_EXISTS', '相同 id 的记录已存在')
  } else {
    const exists = store.get(`SELECT user_id FROM ${def.sqlName} WHERE date = ? AND user_id = ?`, String(model.date), userId)
    if (exists) throw new HttpError(409, 'ALREADY_EXISTS', '该日期已有记录')
  }
  upsertOwned(store, table, model, userId)
  return def.pk === 'id' ? getModel(store, table, String(model.id), userId) : model
}

/** PUT 语义(整体替换,用于同步场景)/ PATCH 走 mergeWith */
export function replaceOwned(store: Store, table: string, id: string, body: unknown, userId: string): Record<string, unknown> {
  const def = TABLES[table]
  if (def.pk === 'id') {
    const model = parseModel(table, body)
    if (model.id !== id) throw new HttpError(400, 'INVALID_RECORD', 'id 与路径不一致')
    upsertOwned(store, table, model, userId)
    return getModel(store, table, id, userId)
  }
  // (user_id, date) 主键表
  const model = parseModel(table, body)
  if (model.date !== id) throw new HttpError(400, 'INVALID_RECORD', 'date 与路径不一致')
  upsertOwned(store, table, model, userId)
  return model
}

export function patchOwned(store: Store, table: string, id: string, body: unknown, userId: string): Record<string, unknown> {
  const current = rowToModel(table, ownRow(store, table, id, userId))
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象')
  const incoming = body as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(TABLES[table].fields)) {
    if (key in incoming) patch[key] = incoming[key]
  }
  const merged = { ...current, ...patch }
  if (TABLES[table].pk === 'id') merged.id = id
  const err = validateRow(table, merged)
  if (err && err !== '缺少字符串 id') throw new HttpError(400, 'INVALID_RECORD', err)
  upsertOwned(store, table, merged, userId)
  return getModel(store, table, id, userId)
}

export function deleteOwned(store: Store, table: string, id: string, userId: string): void {
  const def = TABLES[table]
  const pkCol = def.pk === 'id' ? 'id' : 'date'
  const res = store.run(`DELETE FROM ${def.sqlName} WHERE ${pkCol} = ? AND user_id = ?`, id, userId)
  if (Number(res.changes) === 0) throw new HttpError(404, 'NOT_FOUND', '记录不存在')
}

/** 列表查询:全部强制 user_id 过滤 */
export function listOwned(
  store: Store,
  table: string,
  userId: string,
  opts: { from?: string; to?: string; where?: string[]; params?: SqliteValue[]; order?: string; limit?: number } = {},
): Record<string, unknown>[] {
  const conds = ['user_id = ?']
  const params: SqliteValue[] = [userId]
  if (opts.from) {
    conds.push('date >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    conds.push('date <= ?')
    params.push(opts.to)
  }
  if (opts.where) {
    conds.push(...opts.where)
    params.push(...(opts.params ?? []))
  }
  const def = TABLES[table]
  const sql = `SELECT * FROM ${def.sqlName} WHERE ${conds.join(' AND ')} ORDER BY ${opts.order ?? 'date DESC, created_at DESC'}${opts.limit ? ` LIMIT ${Math.floor(opts.limit)}` : ''}`
  return store.all(sql, ...params).map((row) => rowToModel(table, row))
}

export function requireString(body: Record<string, unknown>, field: string, maxLen = 500): string {
  const v = body[field]
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'INVALID_RECORD', `${field} 不能为空`)
  if (v.length > maxLen) throw new HttpError(400, 'INVALID_RECORD', `${field} 过长`)
  return v.trim()
}
