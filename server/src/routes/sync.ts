import { Router } from 'express'
import type { AppConfig } from '../config.js'
import type { Store } from '../db/sqlite.js'
import { requireAuth, authOf } from '../auth.js'
import { TABLES, rowToModel, validateRow, modelToRow } from '../db/tables.js'
import { upsertOwned } from './helpers.js'
import { HttpError } from '../auth.js'

/**
 * 云端数据导入/导出(迁移与备份共用):
 * - 导出:当前用户全部数据,BackupFile schema 3(与本地 JSON 备份同构)。
 * - 导入:幂等 upsert;**只信任 token 身份**:
 *   - 记录带 userId 且不是当前用户 → 拒绝(防越权导入);
 *   - id 已被其他用户占用 → 冲突跳过(不覆盖他人数据);
 *   - 字段非法 → 跳过并计数,绝不因个别脏数据导致整包失败(部分成功可重试)。
 * - appState 为设备级 KV,不参与云端同步。
 */

const IMPORTABLE_TABLES = [
  'exercises',
  'sessions',
  'workoutExercises',
  'sets',
  'dailyStatuses',
  'templates',
  'personalRecords',
  'prEvents',
  'activitySessions',
] as const

const MAX_ROWS_PER_COLLECTION = 100000

export interface ImportOutcome {
  imported: Record<string, number>
  skippedForeign: number
  skippedInvalid: number
  conflicts: number
}

export function syncRoutes(store: Store, _cfg: AppConfig): Router {
  const r = Router()
  r.use(requireAuth(store, _cfg))

  r.get('/export', (req, res) => {
    const { userId, user } = authOf(req)
    const data: Record<string, unknown[]> = {}
    for (const table of Object.keys(TABLES)) {
      data[table] = store.all(`SELECT * FROM ${TABLES[table].sqlName} WHERE user_id = ?`, userId).map((row) => rowToModel(table, row))
    }
    res.json({
      app: 'MyGymOS',
      schema: 3,
      exportedAt: new Date().toISOString(),
      unit: 'kg',
      exportedBy: { id: userId, nickname: user.nickname },
      data,
    })
  })

  r.post('/import', (req, res) => {
    const { userId } = authOf(req)
    const body = req.body as { app?: unknown; schema?: unknown; data?: unknown }
    if (body?.app !== 'MyGymOS' || typeof body.data !== 'object' || body.data === null) {
      throw new HttpError(400, 'INVALID_BACKUP', '不是 MyGym OS 的备份文件')
    }
    const data = body.data as Record<string, unknown>

    // 预校验:所有集合必须是数组且有上限
    for (const table of IMPORTABLE_TABLES) {
      const rows = data[table]
      if (rows === undefined) continue
      if (!Array.isArray(rows)) throw new HttpError(400, 'INVALID_BACKUP', `${table} 必须是数组`)
      if (rows.length > MAX_ROWS_PER_COLLECTION) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `${table} 记录数超限`)
    }

    const outcome: ImportOutcome = { imported: {}, skippedForeign: 0, skippedInvalid: 0, conflicts: 0 }

    store.transaction(() => {
      for (const table of IMPORTABLE_TABLES) {
        const rows = data[table] as unknown[] | undefined
        if (!Array.isArray(rows)) continue
        let count = 0
        for (const raw of rows) {
          if (typeof raw !== 'object' || raw === null) {
            outcome.skippedInvalid++
            continue
          }
          const rec = raw as Record<string, unknown>
          // 越权防护:记录声明归属别人 → 拒绝导入
          if (typeof rec.userId === 'string' && rec.userId && rec.userId !== userId) {
            outcome.skippedForeign++
            continue
          }
          if (validateRow(table, rec, true)) {
            outcome.skippedInvalid++
            continue
          }
          // 清洗字段(丢弃未知字段),归属统一改写为当前用户;
          // 旧版备份可能缺 createdAt/updatedAt 等必填时间戳 → 服务端补默认值,避免个别脏记录拖垮整包
          const def = TABLES[table]
          const clean: Record<string, unknown> = {}
          if (def.pk === 'id') clean.id = rec.id
          for (const key of Object.keys(def.fields)) clean[key] = rec[key]
          const now = Date.now()
          if ('createdAt' in def.fields && (clean.createdAt === undefined || clean.createdAt === null)) clean.createdAt = now
          if ('updatedAt' in def.fields && (clean.updatedAt === undefined || clean.updatedAt === null)) clean.updatedAt = now
          if (table === 'sessions' && (clean.startedAt === undefined || clean.startedAt === null)) clean.startedAt = clean.createdAt
          const result = upsertOwned(store, table, clean, userId)
          if (result === 'conflict') outcome.conflicts++
          else count++
        }
        outcome.imported[table] = count
      }
      void modelToRow // (保持引用:导入统一走 upsertOwned)
    })

    res.json(outcome)
  })

  return r
}
