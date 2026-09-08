import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createApp } from '../src/index.js'
import { loadConfig } from '../src/config.js'
import { Store } from '../src/db/sqlite.js'

/**
 * MyGym API 集成测试:
 * 覆盖 认证 / 双用户数据隔离(A/B) / 越权(伪造 userId、访问他人资源) /
 * 导入导出(越权过滤、脏数据、冲突) / AI(额度、缓存、Provider 错误、超时、未配置) / CORS。
 */

/* ---------------- mock AI Provider ---------------- */

const mockBehavior: { mode: 'ok' | 'error' | 'timeout'; delay: number; calls: number } = { mode: 'ok', delay: 0, calls: 0 }
let mockServer: Server
let mockPort = 0

async function startMockProvider(): Promise<void> {
  if (mockPort) return
  mockServer = createHttpServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
      mockBehavior.calls++
      setTimeout(() => {
        if (mockBehavior.mode === 'timeout') {
          // 保持连接，直到客户端 AbortController 超时；after hook 会主动关闭所有连接。
          return
        }
        if (mockBehavior.mode === 'error') {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'upstream boom' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: `模拟分析:${JSON.parse(body).messages[1].content.slice(0, 24)}` } }] }))
      }, mockBehavior.delay)
    })
  })
  mockServer.keepAliveTimeout = 1000
  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
  mockServer.unref()
  mockPort = (mockServer.address() as { port: number }).port
}

before(startMockProvider)

/* ---------------- 测试实例 ---------------- */

interface TestApp {
  url: string
  close: () => Promise<void>
}

const toClose: TestApp[] = []

async function startApp(envOverrides: Record<string, string> = {}): Promise<string> {
  // Node test 的全局 hook 不保证与其他 hook 的注册顺序一致;配置端口前确保 mock 已就绪。
  await startMockProvider()
  const base = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret',
    DB_FILE: ':memory:',
    ALLOWED_ORIGINS: 'http://allowed.example',
    AI_API_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    AI_API_KEY: 'test-key-not-real',
    AI_MODEL: 'mock-model',
    AI_REQUEST_TIMEOUT_MS: '300',
    AI_DAILY_LIMIT: '2',
    AI_MONTHLY_LIMIT: '10',
    ...envOverrides,
  })
  const store = new Store(base.dbFile)
  const app = createApp(base, store)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  server.unref()
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  toClose.push({
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
        store.close()
      }),
  })
  return url
}

async function api(
  url: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown; origin?: string } = {},
): Promise<{ status: number; json: any; headers: Record<string, string> }> {
  const res = await fetch(`${url}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) }
}

interface Session {
  token: string
  userId: string
}

async function login(url: string, nickname: string): Promise<Session> {
  const r = await api(url, '/auth/dev-login', { method: 'POST', body: { nickname } })
  assert.equal(r.status, 200, `login ${nickname} failed: ${JSON.stringify(r.json)}`)
  return { token: r.json.token as string, userId: r.json.user.id as string }
}

/* ---------------- 1. 健康检查与认证 ---------------- */

let url: string
let A: Session
let B: Session

before(async () => {
  url = await startApp()
  A = await login(url, '用户A')
  B = await login(url, '用户B')
})

test('health 探测无需登录', async () => {
  const r = await api(url, '/health')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.service, 'mygym-api')
})

test('生产配置:强制关闭开发登录且拒绝通配 CORS', () => {
  const production = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'production-secret', ALLOWED_ORIGINS: 'https://app.example.com', DEV_AUTH_ENABLED: 'true' })
  assert.equal(production.devAuthEnabled, false)
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'production-secret', ALLOWED_ORIGINS: '*' }), /ALLOWED_ORIGINS/)
})

test('dev 登录:重复登录返回同一用户', async () => {
  const again = await login(url, '用户A')
  assert.equal(again.userId, A.userId)
})

test('me:带 token 返回用户,不带/坏 token 401', async () => {
  const ok = await api(url, '/auth/me', { token: A.token })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.user.nickname, '用户A')
  assert.equal(ok.json.user.authProvider, 'dev')

  const noToken = await api(url, '/auth/me')
  assert.equal(noToken.status, 401)
  assert.equal(noToken.json.error, 'UNAUTHORIZED')

  const bad = await api(url, '/auth/me', { token: 'bad.token.here' })
  assert.equal(bad.status, 401)
})

test('dev 登录:空昵称 400;微信端点 501 占位', async () => {
  const empty = await api(url, '/auth/dev-login', { method: 'POST', body: { nickname: '  ' } })
  assert.equal(empty.status, 400)
  const wx = await api(url, '/auth/wechat', { method: 'POST', body: { code: 'x' } })
  assert.equal(wx.status, 501)
  assert.equal(wx.json.error, 'NOT_IMPLEMENTED')
})

test('未登录访问数据接口 401', async () => {
  const r = await api(url, '/sessions')
  assert.equal(r.status, 401)
})

/* ---------------- 2. 力量训练:双用户隔离 ---------------- */

let sessionA: string
let setA: string
let weA: string

test('A 创建训练,B 不可见', async () => {
  const create = await api(url, '/sessions', {
    method: 'POST',
    token: A.token,
    body: { date: '2026-09-01', status: 'completed', bodyParts: ['chest', 'triceps'], title: '胸+三头', startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() },
  })
  assert.equal(create.status, 201)
  sessionA = create.json.session.id
  // 伪造归属:请求体声称属于 B —— 服务端必须以 token 为准
  const spoof = await api(url, '/sessions', {
    method: 'POST',
    token: A.token,
    body: { id: 'spoof-session-1', date: '2026-09-02', status: 'completed', bodyParts: ['back'], startedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), userId: B.userId },
  })
  assert.equal(spoof.status, 201)

  const listA = await api(url, '/sessions', { token: A.token })
  assert.equal(listA.json.sessions.length, 2)
  const listB = await api(url, '/sessions', { token: B.token })
  assert.equal(listB.json.sessions.length, 0)

  const detailB = await api(url, `/sessions/${sessionA}`, { token: B.token })
  assert.equal(detailB.status, 404)
})

test('A 创建组数据;B 不能修改/删除 A 的组与会话', async () => {
  // A 的默认动作库里取一个动作
  const ex = await api(url, '/exercises', { token: A.token })
  const exerciseId = ex.json.exercises[0].id
  const we = await api(url, `/sessions/${sessionA}/exercises`, { method: 'POST', token: A.token, body: { exerciseId } })
  assert.equal(we.status, 201)
  weA = we.json.workoutExercise.id
  const set = await api(url, `/sessions/${sessionA}/sets`, {
    method: 'POST',
    token: A.token,
    body: { workoutExerciseId: weA, weight: 60, reps: 8, weightType: 'weight' },
  })
  assert.equal(set.status, 201)
  setA = set.json.set.id
  assert.equal(set.json.set.date, '2026-09-01')
  assert.equal(set.json.set.exerciseId, exerciseId)

  // B 尝试改/删 A 的数据 → 404(不泄露存在性)
  const patchSet = await api(url, `/sets/${setA}`, { method: 'PATCH', token: B.token, body: { weight: 1 } })
  assert.equal(patchSet.status, 404)
  const delSet = await api(url, `/sets/${setA}`, { method: 'DELETE', token: B.token })
  assert.equal(delSet.status, 404)
  const delSession = await api(url, `/sessions/${sessionA}`, { method: 'DELETE', token: B.token })
  assert.equal(delSession.status, 404)
  // B 向 A 的会话添加组 → 404
  const addSetB = await api(url, `/sessions/${sessionA}/sets`, { method: 'POST', token: B.token, body: { workoutExerciseId: weA, weight: 1, reps: 1, weightType: 'weight' } })
  assert.equal(addSetB.status, 404)
})

test('A 可以修改自己的数据', async () => {
  const patch = await api(url, `/sets/${setA}`, { method: 'PATCH', token: A.token, body: { weight: 62.5 } })
  assert.equal(patch.status, 200)
  assert.equal(patch.json.set.weight, 62.5)
  const patchSession = await api(url, `/sessions/${sessionA}`, { method: 'PATCH', token: A.token, body: { notes: '状态不错' } })
  assert.equal(patchSession.status, 200)
  assert.equal(patchSession.json.session.notes, '状态不错')
})

/* ---------------- 3. 羽毛球/游泳/网球:隔离 ---------------- */

test('运动记录:双用户隔离 + 越权 404', async () => {
  const mk = (sport: string, extra: Record<string, unknown> = {}) => ({
    sport,
    date: '2026-09-03',
    durationMin: 90,
    playType: 'singles',
    score: { gamesTotal: 3, gamesWon: 2, gamesLost: 1 },
    ...extra,
  })
  const bad = await api(url, '/activities', { method: 'POST', token: A.token, body: mk('badminton', { venue: '球馆A' }) })
  assert.equal(bad.status, 201)
  const actA = bad.json.activity.id
  const ten = await api(url, '/activities', {
    method: 'POST',
    token: B.token,
    body: mk('tennis', { sets: [{ a: 6, b: 4 }], scoreText: '6-4', surface: 'hard', nature: 'official' }),
  })
  assert.equal(ten.status, 201)

  const listA = await api(url, '/activities?sport=badminton', { token: A.token })
  assert.equal(listA.json.activities.length, 1)
  const listA_all = await api(url, '/activities', { token: A.token })
  assert.equal(listA_all.json.activities.length, 1) // 只看到自己的羽毛球,看不到 B 的网球
  const listB_all = await api(url, '/activities', { token: B.token })
  assert.equal(listB_all.json.activities.length, 1)
  assert.equal(listB_all.json.activities[0].sport, 'tennis')

  const getB = await api(url, `/activities/${actA}`, { token: B.token })
  assert.equal(getB.status, 404)
  const patchB = await api(url, `/activities/${actA}`, { method: 'PATCH', token: B.token, body: { durationMin: 1 } })
  assert.equal(patchB.status, 404)
  const delB = await api(url, `/activities/${actA}`, { method: 'DELETE', token: B.token })
  assert.equal(delB.status, 404)
  const delA = await api(url, `/activities/${actA}`, { method: 'DELETE', token: A.token })
  assert.equal(delA.status, 200)
})

/* ---------------- 4. 模板 / 休息日 / 动作库隔离 ---------------- */

test('模板、休息日、动作库互相隔离', async () => {
  const tpl = await api(url, '/templates', {
    method: 'POST',
    token: A.token,
    body: { name: '背+二头', bodyParts: ['back', 'biceps'], items: [], createdAt: Date.now(), updatedAt: Date.now() },
  })
  assert.equal(tpl.status, 201)
  const tplB = await api(url, '/templates', { token: B.token })
  assert.equal(tplB.json.templates.length, 0)
  const delTplB = await api(url, `/templates/${tpl.json.template.id}`, { method: 'DELETE', token: B.token })
  assert.equal(delTplB.status, 404)

  const rest = await api(url, '/daily-statuses/2026-09-04', { method: 'PUT', token: A.token, body: { status: 'rest' } })
  assert.equal(rest.status, 200)
  const restB = await api(url, '/daily-statuses?from=2026-09-01&to=2026-09-30', { token: B.token })
  assert.equal(restB.json.dailyStatuses.length, 0)

  const ex = await api(url, '/exercises', { method: 'POST', token: A.token, body: { name: '自定义动作A', bodyPart: 'chest', isCustom: 1, createdAt: Date.now(), updatedAt: Date.now() } })
  assert.equal(ex.status, 201)
  const exB = await api(url, '/exercises?includeDeleted=1', { token: B.token })
  assert.equal(exB.json.exercises.some((e: { name: string }) => e.name === '自定义动作A'), false)
  // 同名动作在 B 的库里不冲突(动作按用户隔离)
  const exB2 = await api(url, '/exercises', { method: 'POST', token: B.token, body: { name: '自定义动作A', bodyPart: 'chest', isCustom: 1, createdAt: Date.now(), updatedAt: Date.now() } })
  assert.equal(exB2.status, 201)
})

/* ---------------- 5. 导入 / 导出 ---------------- */

test('导出:schema 3 + 归属当前用户', async () => {
  const r = await api(url, '/data/export', { token: A.token, }, )
  assert.equal(r.status, 200)
  assert.equal(r.json.schema, 3)
  assert.equal(r.json.app, 'MyGymOS')
  assert.equal(r.json.exportedBy.id, A.userId)
  assert.ok(r.json.data.sessions.length >= 2)
  assert.ok(r.json.data.exercises.length >= 30) // 新用户播种的默认动作库
  for (const s of r.json.data.sessions) {
    assert.equal(s.userId, A.userId)
  }
})

test('导入:A 的云端导出被 B 导入 → 全部因越权被拒', async () => {
  const exp = await api(url, '/data/export', { token: A.token })
  const r = await api(url, '/data/import', { method: 'POST', token: B.token, body: exp.json })
  assert.equal(r.status, 200)
  const total = Object.values(r.json.imported as Record<string, number>).reduce((a, b) => a + b, 0)
  assert.equal(total, 0)
  assert.ok(r.json.skippedForeign > 0, '应存在被拒绝的越权记录')
})

test('导入:旧版无 userId 的备份 → 绑定导入者,幂等重跑', async () => {
  const legacy = {
    app: 'MyGymOS',
    schema: 2,
    exportedAt: '2025-01-01T00:00:00.000Z',
    unit: 'kg',
    data: {
      exercises: [{ id: 'ex-old-1', name: '旧动作', bodyPart: 'back', equipment: 'machine', defaultWeightType: 'weight', isCustom: 1, createdAt: 1, updatedAt: 1 }],
      sessions: [{ id: 'sess-old-1', date: '2025-01-02', status: 'completed', bodyParts: ['back'], startedAt: 1, createdAt: 1, updatedAt: 1 }],
      workoutExercises: [{ id: 'we-old-1', sessionId: 'sess-old-1', exerciseId: 'ex-old-1', order: 0, createdAt: 1 }],
      sets: [{ id: 'set-old-1', workoutExerciseId: 'we-old-1', sessionId: 'sess-old-1', exerciseId: 'ex-old-1', setNumber: 1, weight: 50, reps: 10, weightType: 'weight', date: '2025-01-02', createdAt: 1 }],
      activitySessions: [{ id: 'act-old-1', sport: 'swimming', date: '2025-01-03', distanceM: 1000, durationMin: 30, stroke: 'freestyle' }],
    },
  }
  const r1 = await api(url, '/data/import', { method: 'POST', token: B.token, body: legacy })
  assert.equal(r1.status, 200)
  assert.equal(r1.json.imported.sessions, 1)
  assert.equal(r1.json.imported.sets, 1)
  assert.equal(r1.json.imported.activitySessions, 1)
  // 重跑幂等:upsert 更新而非重复插入(列表长度不变)
  const r2 = await api(url, '/data/import', { method: 'POST', token: B.token, body: legacy })
  assert.equal(r2.status, 200)
  assert.equal(r2.json.conflicts, 0)
  const listB = await api(url, '/sessions', { token: B.token })
  assert.equal(listB.json.sessions.filter((s: { id: string }) => s.id === 'sess-old-1').length, 1)
  const actsB = await api(url, '/activities', { token: B.token })
  const importedActivity = actsB.json.activities.find((a: { id: string }) => a.id === 'act-old-1')
  assert.equal(importedActivity?.userId, B.userId) // 旧数据已绑定导入者

  // 与 A 的已有记录 id 冲突(A 拥有 spoof-session-1)→ B 导入同名 id 被跳过
  const conflict = await api(url, '/data/import', {
    method: 'POST',
    token: B.token,
    body: { app: 'MyGymOS', schema: 2, data: { sessions: [{ id: 'spoof-session-1', date: '2026-05-01', status: 'completed', bodyParts: ['legs'], startedAt: 1, createdAt: 1, updatedAt: 1 }] } },
  })
  assert.equal(conflict.json.conflicts, 1)
})

test('导入:脏数据逐条跳过;缺 data / 坏 JSON / 超限 → 4xx', async () => {
  const dirty = await api(url, '/data/import', {
    method: 'POST',
    token: B.token,
    body: {
      app: 'MyGymOS',
      schema: 3,
      data: {
        sessions: [
          'not-an-object',
          { date: '2026-01-01', status: 'completed', bodyParts: [] }, // 缺 id
          { id: 's-ok', date: '2026-01-01', status: 'completed', bodyParts: ['legs'], startedAt: 1, createdAt: 1, updatedAt: 1 },
          { id: 's-bad-date', date: '20260101', status: 'completed', bodyParts: [], startedAt: 1, createdAt: 1, updatedAt: 1 },
        ],
      },
    },
  })
  assert.equal(dirty.status, 200)
  assert.equal(dirty.json.imported.sessions, 1)
  assert.equal(dirty.json.skippedInvalid, 3)

  const noData = await api(url, '/data/import', { method: 'POST', token: B.token, body: { app: 'MyGymOS' } })
  assert.equal(noData.status, 400)
  const wrongApp = await api(url, '/data/import', { method: 'POST', token: B.token, body: { app: 'Other', data: {} } })
  assert.equal(wrongApp.status, 400)

  const raw = await fetch(`${url}/data/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${B.token}` },
    body: '{not json',
  })
  assert.equal(raw.status, 400)
  assert.equal(((await raw.json()) as { error: string }).error, 'INVALID_JSON')
})

/* ---------------- 6. AI:额度 / 缓存 / 错误 / 超时 ---------------- */

test('AI:未登录 401;参数校验 400', async () => {
  const unauth = await api(url, '/ai/quota')
  assert.equal(unauth.status, 401)
  const unauthPost = await api(url, '/ai/training-summary', { method: 'POST', body: { kind: 'month', period: '2026-09', stats: {} } })
  assert.equal(unauthPost.status, 401)

  const badKind = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'week', period: '2026-09', stats: {} } })
  assert.equal(badKind.status, 400)
  const badPeriod = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '202609', stats: {} } })
  assert.equal(badPeriod.status, 400)
  const noStats = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '2026-09' } })
  assert.equal(noStats.status, 400)
  const big = await api(url, '/ai/training-summary', {
    method: 'POST',
    token: A.token,
    body: { kind: 'month', period: '2026-12', stats: { blob: 'x'.repeat(200_001) } },
  })
  assert.equal(big.status, 413)
})

test('AI:成功消耗额度;缓存命中不消耗;超出日额度 429', async () => {
  mockBehavior.mode = 'ok'
  mockBehavior.delay = 0
  const stats = { trainingDays: 12, totalVolume: 42000 }
  const q0 = await api(url, '/ai/quota', { token: A.token })
  assert.equal(q0.json.daily.used, 0)
  assert.equal(q0.json.daily.limit, 2)

  const p1 = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '2026-01', stats } })
  assert.equal(p1.status, 200)
  assert.equal(p1.json.cached, false)
  assert.ok(p1.json.content.includes('模拟分析'))
  assert.equal(p1.json.quota.daily.used, 1)

  const p1again = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '2026-01', stats } })
  assert.equal(p1again.status, 200)
  assert.equal(p1again.json.cached, true)
  assert.equal(p1again.json.quota.daily.used, 1) // 缓存命中不扣额度

  const p2 = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '2026-02', stats } })
  assert.equal(p2.status, 200)
  assert.equal(p2.json.quota.daily.used, 2)
  assert.equal(p2.json.quota.monthly.used, 2)

  const p3 = await api(url, '/ai/training-summary', { method: 'POST', token: A.token, body: { kind: 'month', period: '2026-03', stats } })
  assert.equal(p3.status, 429)
  assert.equal(p3.json.error, 'AI_QUOTA_EXCEEDED')
  assert.equal(p3.json.quota.daily.remaining, 0)

  // 用户 B 独立额度
  const b1 = await api(url, '/ai/training-summary', { method: 'POST', token: B.token, body: { kind: 'month', period: '2026-05', stats } })
  assert.equal(b1.status, 200)
  assert.equal(b1.json.quota.daily.used, 1)
})

test('AI:Provider 失败 502 不消耗额度;超时 504 不消耗', async () => {
  mockBehavior.delay = 0
  // B 日额度已用 1,尚有余额 → 用 B 验证失败路径
  const before = await api(url, '/ai/quota', { token: B.token })
  assert.equal(before.json.daily.used, 1)
  mockBehavior.mode = 'error'
  const fail = await api(url, '/ai/training-summary', { method: 'POST', token: B.token, body: { kind: 'month', period: '2026-06', stats: {} } })
  assert.equal(fail.status, 502)
  assert.equal(fail.json.error, 'AI_PROVIDER_ERROR')
  const afterFail = await api(url, '/ai/quota', { token: B.token })
  assert.equal(afterFail.json.daily.used, before.json.daily.used)

  mockBehavior.mode = 'timeout'
  const slow = await api(url, '/ai/training-summary', { method: 'POST', token: B.token, body: { kind: 'month', period: '2026-07', stats: {} } })
  assert.equal(slow.status, 504)
  assert.equal(slow.json.error, 'AI_TIMEOUT')
  const afterTimeout = await api(url, '/ai/quota', { token: B.token })
  assert.equal(afterTimeout.json.daily.used, before.json.daily.used)

  mockBehavior.mode = 'ok'
  const okAfter = await api(url, '/ai/training-summary', { method: 'POST', token: B.token, body: { kind: 'month', period: '2026-08', stats: {} } })
  assert.equal(okAfter.status, 200)
  assert.equal(okAfter.json.quota.daily.used, 2)
})

test('AI:月额度独立生效(独立实例:日 10 / 月 1)', async () => {
  const url2 = await startApp({ AI_DAILY_LIMIT: '10', AI_MONTHLY_LIMIT: '1' })
  const u = await login(url2, '月额用户')
  const ok = await api(url2, '/ai/training-summary', { method: 'POST', token: u.token, body: { kind: 'year', period: '2026', stats: { trainingDays: 3 } } })
  assert.equal(ok.status, 200)
  const exceed = await api(url2, '/ai/training-summary', { method: 'POST', token: u.token, body: { kind: 'year', period: '2025', stats: { trainingDays: 3 } } })
  assert.equal(exceed.status, 429)
  assert.equal(exceed.json.quota.monthly.remaining, 0)
  assert.equal(exceed.json.quota.daily.used, 1) // 月预扣失败时日额度已返还
  assert.equal(exceed.json.quota.daily.remaining, 9)
})

test('AI:相同周期并发请求只调用一次 Provider 且只扣一次额度', async () => {
  const url4 = await startApp({ AI_DAILY_LIMIT: '1', AI_MONTHLY_LIMIT: '10' })
  const u = await login(url4, '并发用户')
  mockBehavior.mode = 'ok'
  mockBehavior.delay = 80
  mockBehavior.calls = 0
  const body = { kind: 'month', period: '2026-10', stats: { trainingDays: 1 } }
  const [first, duplicate] = await Promise.all([
    api(url4, '/ai/training-summary', { method: 'POST', token: u.token, body }),
    api(url4, '/ai/training-summary', { method: 'POST', token: u.token, body }),
  ])
  assert.equal(first.status, 200)
  assert.equal(duplicate.status, 200)
  assert.equal(mockBehavior.calls, 1)
  const q = await api(url4, '/ai/quota', { token: u.token })
  assert.equal(q.json.daily.used, 1)
  mockBehavior.delay = 0
})

test('AI:未配置 Provider → 503', async () => {
  const url3 = await startApp({ AI_API_KEY: '', AI_API_BASE_URL: '' })
  const u = await login(url3, '无AI用户')
  const r = await api(url3, '/ai/training-summary', { method: 'POST', token: u.token, body: { kind: 'month', period: '2026-09', stats: {} } })
  assert.equal(r.status, 503)
  assert.equal(r.json.error, 'AI_NOT_CONFIGURED')
  const q = await api(url3, '/ai/quota', { token: u.token })
  assert.equal(q.json.enabled, false)
})

/* ---------------- 7. CORS ---------------- */

test('CORS:白名单来源放行,未知来源拒绝;无 Origin(小程序)放行', async () => {
  const ok = await api(url, '/health', { origin: 'http://allowed.example' })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['access-control-allow-origin'], 'http://allowed.example')

  const bad = await api(url, '/health', { origin: 'http://evil.example' })
  assert.equal(bad.status, 403)
  assert.equal(bad.json.error, 'CORS_NOT_ALLOWED')

  const noOrigin = await api(url, '/health')
  assert.equal(noOrigin.status, 200)

  // 预检
  const pre = await fetch(`${url}/sessions`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://allowed.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' },
  })
  assert.equal(pre.status, 204)
})

after(async () => {
  await Promise.all(toClose.map((t) => t.close()))
  mockServer.closeAllConnections?.()
  await new Promise<void>((resolve) => mockServer.close(() => resolve()))
})
