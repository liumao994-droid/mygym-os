import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/index.js'
import { loadConfig } from '../src/config.js'
import { Store } from '../src/db/sqlite.js'

const cfg = loadConfig({
  NODE_ENV: 'production',
  JWT_SECRET: 'security-audit-test-secret',
  DB_FILE: ':memory:',
  ALLOWED_ORIGINS: 'https://app.example.test',
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
  return { status: response.status, json: await response.json() as Record<string, unknown>, headers: response.headers }
}

test('安全修复: 注销立即撤销 JWT，且生产响应包含安全头', async () => {
  const registered = await request('/auth/register', {
    method: 'POST', body: { username: 'security-user', password: 'security-password', nickname: '安全测试' },
  })
  assert.equal(registered.status, 201)
  assert.match(String(registered.headers.get('content-security-policy')), /default-src 'self'/)
  assert.equal(registered.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(registered.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')

  const token = registered.json.token as string
  assert.equal((await request('/auth/me', { token })).status, 200)
  assert.equal((await request('/auth/logout', { method: 'POST', token })).status, 200)
  assert.equal((await request('/auth/me', { token })).status, 401)
  assert.equal((await request('/activities', { token })).status, 401)
})

test('安全修复: 登录和注册具备基础限流', async () => {
  for (let i = 0; i < 5; i++) {
    const result = await request('/auth/login', { method: 'POST', body: { username: 'bruteforce-target', password: 'wrong' } })
    assert.equal(result.status, 401)
  }
  const blockedLogin = await request('/auth/login', { method: 'POST', body: { username: 'bruteforce-target', password: 'wrong' } })
  assert.equal(blockedLogin.status, 429)
  assert.equal(blockedLogin.json.error, 'LOGIN_RATE_LIMITED')

  for (let i = 0; i < 4; i++) {
    const result = await request('/auth/register', {
      method: 'POST', body: { username: `rate-user-${i}`, password: 'security-password', nickname: `限流${i}` },
    })
    assert.equal(result.status, 201)
  }
  const blockedRegistration = await request('/auth/register', {
    method: 'POST', body: { username: 'rate-user-blocked', password: 'security-password', nickname: '限流阻止' },
  })
  assert.equal(blockedRegistration.status, 429)
  assert.equal(blockedRegistration.json.error, 'REGISTER_RATE_LIMITED')
})
