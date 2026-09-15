import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TABLES, rowToModel } from '../src/db/tables.js'

/**
 * 只读导出本机 SQLite 指定用户，再导入 Railway 当前账号。
 * 本机数据库永不修改；网络导入前先落一份 JSON 备份，成功后逐 ID 校验。
 */

const localDb = resolve(process.env.MIGRATION_LOCAL_DB ?? 'server-data/mygym.db')
const sourceUserId = (process.env.MIGRATION_SOURCE_USER_ID ?? '').trim()
const username = (process.env.MIGRATION_TARGET_USERNAME ?? '').trim()
const password = process.env.MIGRATION_TARGET_PASSWORD ?? ''
const cloudBase = (process.env.MIGRATION_CLOUD_BASE ?? 'https://mygym-os-production.up.railway.app').replace(/\/+$/, '')

if (!sourceUserId || !username || !password) {
  throw new Error('需要 MIGRATION_SOURCE_USER_ID、MIGRATION_TARGET_USERNAME、MIGRATION_TARGET_PASSWORD')
}

const db = new DatabaseSync(localDb, { readOnly: true })
const data: Record<string, Record<string, unknown>[]> = {}
for (const [name, def] of Object.entries(TABLES)) {
  data[name] = db.prepare(`SELECT * FROM ${def.sqlName} WHERE user_id = ?`).all(sourceUserId)
    .map((row) => {
      const model = rowToModel(name, row as never)
      delete model.userId
      return model
    })
}
db.close()

const backup = { app: 'MyGymOS', schema: 3, exportedAt: new Date().toISOString(), unit: 'kg', data }
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = resolve('migration-backups', `local-${sourceUserId}-${stamp}.json`)
mkdirSync(dirname(backupFile), { recursive: true })
writeFileSync(backupFile, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 })

async function jsonRequest(path: string, init: RequestInit = {}, token = ''): Promise<any> {
  const response = await fetch(`${cloudBase}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.message ?? body.error ?? '请求失败'}`)
  return body
}

const login = await jsonRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
const me = await jsonRequest('/auth/me', {}, login.token)
if (!me.user?.id || me.user.id !== login.user?.id) throw new Error('Railway JWT 与 /auth/me 用户不一致，已停止迁移')

const imported = await jsonRequest('/data/import', { method: 'POST', body: JSON.stringify(backup) }, login.token)
const exported = await jsonRequest('/data/export', {}, login.token)
const missing: string[] = []
for (const [name, rows] of Object.entries(data)) {
  const cloudIds = new Set((exported.data?.[name] ?? []).map((row: Record<string, unknown>) => row.id ?? row.date))
  for (const row of rows) {
    const key = row.id ?? row.date
    if (key !== undefined && !cloudIds.has(key)) missing.push(`${name}:${String(key)}`)
  }
}
if (missing.length) throw new Error(`Railway 校验失败，缺少 ${missing.slice(0, 20).join(', ')}`)

console.log(JSON.stringify({ ok: true, sourceUserId, targetUserId: me.user.id, backupFile, imported }, null, 2))
