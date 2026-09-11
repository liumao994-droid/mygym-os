import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/index.js'
import { loadConfig } from '../src/config.js'
import { Store } from '../src/db/sqlite.js'

const cfg = loadConfig({
  NODE_ENV: 'test',
  JWT_SECRET: 'local-auth-test-secret',
  DB_FILE: ':memory:',
  ALLOWED_ORIGINS: 'http://localhost:5173',
})
const store = new Store(cfg.dbFile)
const server = createApp(cfg, store).listen(0, '127.0.0.1')
await new Promise<void>((resolve) => server.on('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`

after(() => {
  server.close()
  store.close()
})

async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return { status: response.status, json: await response.json() as Record<string, any> }
}

test('本地账号:注册、统一登录错误与用户数据隔离', async () => {
  const a = await request('/auth/register', {
    method: 'POST', body: { username: 'AthleteA', password: 'password-A', nickname: '训练者 A' },
  })
  assert.equal(a.status, 201)
  assert.equal(a.json.user.username, 'athletea')
  assert.equal('password' in a.json.user, false)
  assert.equal('passwordHash' in a.json.user, false)

  const duplicate = await request('/auth/register', {
    method: 'POST', body: { username: 'ATHLETEA', password: 'password-B', nickname: '重复用户' },
  })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.json.error, 'USERNAME_TAKEN')

  const wrongPassword = await request('/auth/login', { method: 'POST', body: { username: 'athletea', password: 'wrong-password' } })
  const missingUser = await request('/auth/login', { method: 'POST', body: { username: 'not-found', password: 'wrong-password' } })
  assert.equal(wrongPassword.status, 401)
  assert.equal(missingUser.status, 401)
  assert.equal(wrongPassword.json.message, '用户名或密码错误')
  assert.equal(missingUser.json.message, '用户名或密码错误')

  const tokenA = a.json.token as string
  const now = Date.now()
  const session = await request('/sessions', {
    method: 'POST', token: tokenA,
    body: { id: 'local-auth-session-a', date: '2026-09-11', status: 'completed', bodyParts: ['back'], startedAt: now, createdAt: now, updatedAt: now },
  })
  assert.equal(session.status, 201)
  assert.equal(session.json.session.userId, a.json.user.id)

  for (const sport of ['badminton', 'swimming', 'tennis', 'volleyball']) {
    const activity = await request('/activities', {
      method: 'POST', token: tokenA,
      body: { id: `local-auth-${sport}-a`, sport, date: '2026-09-11', durationMin: 30, createdAt: now, updatedAt: now },
    })
    assert.equal(activity.status, 201)
    assert.equal(activity.json.activity.userId, a.json.user.id)
  }

  const b = await request('/auth/register', {
    method: 'POST', body: { username: 'athleteb', password: 'password-B', nickname: '训练者 B' },
  })
  assert.equal(b.status, 201)
  const tokenB = b.json.token as string
  const sessionsB = await request('/sessions', { token: tokenB })
  assert.equal(sessionsB.status, 200)
  assert.equal(sessionsB.json.sessions.length, 0)
  const activitiesB = await request('/activities', { token: tokenB })
  assert.equal(activitiesB.status, 200)
  assert.equal(activitiesB.json.activities.length, 0)
  const foreignSession = await request('/sessions/local-auth-session-a', { token: tokenB })
  assert.equal(foreignSession.status, 404)

  const loginA = await request('/auth/login', { method: 'POST', body: { username: 'ATHLETEA', password: 'password-A' } })
  assert.equal(loginA.status, 200)
  assert.equal(loginA.json.user.id, a.json.user.id)
})
