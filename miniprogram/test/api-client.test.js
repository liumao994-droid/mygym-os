'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { freshWx } = require('./fakeWx.js')
const session = require('../utils/session.js')
const auth = require('../services/auth.js')
const data = require('../services/data.js')
const ai = require('../services/ai.js')

let wx

beforeEach(() => {
  wx = freshWx()
})

function preloadAuth() {
  session.saveAuth({
    token: 'jwt-user-a',
    user: { id: 'user-a', nickname: '用户A', authProvider: 'wechat' }
  })
}

test('微信登录:wx.login code 交给后端 /auth/wechat,并保存返回的统一 JWT', async () => {
  wx.loginResult = { code: 'temporary-code-abc' }
  wx.enqueue({
    statusCode: 200,
    data: { token: 'jwt-wx', user: { id: 'wx-1', nickname: '微信健身用户', authProvider: 'wechat' } }
  })

  const out = await auth.wechatLogin()
  assert.equal(out.token, 'jwt-wx')
  assert.equal(wx.requests.length, 1)
  assert.equal(wx.requests[0].url, 'http://127.0.0.1:8787/api/auth/wechat')
  assert.equal(wx.requests[0].data.code, 'temporary-code-abc')
  assert.equal(session.getToken(), 'jwt-wx')
  assert.equal(wx.loadingStack.some((item) => item.show), true)
  assert.equal(wx.loadingStack.some((item) => item.hide), true)
})

test('统一 client:数据/AI 服务都携带 Bearer token 且不发 AppSecret', async () => {
  preloadAuth()
  wx.enqueue({ statusCode: 200, data: { sessions: [] } })
  await data.listSessions()
  wx.enqueue({ statusCode: 200, data: { activities: [] } })
  await data.listActivities({ sport: 'swimming' })

  const now = Date.now()
  wx.enqueue({ statusCode: 201, data: { session: { id: 's-1' } } })
  await data.createSession({ date: '2026-09-08', status: 'completed', bodyParts: ['chest'], createdAt: now })
  wx.enqueue({ statusCode: 200, data: { session: { id: 's-1', notes: 'x' } } })
  await data.patchSession('s-1', { notes: 'x' })
  wx.enqueue({ statusCode: 200, data: {} })
  await data.deleteSession('s-1')
  wx.enqueue({ statusCode: 200, data: { content: 'ok', quota: { daily: { remaining: 1 } } } })
  await ai.trainingSummary({ kind: 'month', period: '2026-09', stats: {} })

  for (const req of wx.requests) {
    assert.equal(req.header.Authorization, 'Bearer jwt-user-a')
    assert.equal(JSON.stringify(req.data || {}).includes('secret'), false)
    assert.equal(JSON.stringify(req.data || {}).includes('appSecret'), false)
  }
  const urls = wx.requests.map((r) => r.url)
  assert.ok(urls.some((u) => u.endsWith('/api/sessions')))
  assert.ok(urls.some((u) => u.endsWith('/api/activities')))
  assert.ok(urls.some((u) => u.endsWith('/api/ai/training-summary')))
})

test('统一错误处理:401 清会话回登录;429 quota / 403 / 500 / 网络 / 超时分类正确', async () => {
  preloadAuth()
  wx.enqueue({ statusCode: 401, data: { error: 'UNAUTHORIZED', message: '登录已过期' } })
  await assert.rejects(data.listSessions(), (err) => err.code === 'UNAUTHORIZED' && err.status === 401)
  assert.equal(session.getToken(), '')
  assert.equal(wx.relaunchUrl, '/pages/login/login')

  preloadAuth()
  wx.enqueue({ statusCode: 429, data: { error: 'AI_QUOTA_EXCEEDED', message: '次数已用完' } })
  await assert.rejects(
    ai.trainingSummary({ kind: 'month', period: '2026-09', stats: {} }),
    (err) => err.code === 'AI_QUOTA_EXCEEDED' && err.status === 429
  )

  wx.enqueue({ statusCode: 403, data: { error: 'CORS_NOT_ALLOWED' } })
  await assert.rejects(data.listSessions(), (err) => err.status === 403 && err.code === 'CORS_NOT_ALLOWED')

  wx.enqueue({ statusCode: 500, data: { error: 'INTERNAL' } })
  await assert.rejects(data.listSessions(), (err) => err.status === 500 && err.code === 'INTERNAL')

  wx.enqueue({ error: 'request:fail timeout' })
  await assert.rejects(data.listSessions(), (err) => err.type === 'TIMEOUT' && err.code === 'TIMEOUT')

  wx.enqueue({ error: 'request:fail -2:net::ERR_CONNECTION_REFUSED' })
  await assert.rejects(data.listSessions(), (err) => err.type === 'NETWORK' && err.code === 'NETWORK')
})

test('CRUD 服务层按 REST 语义发出 POST / GET / PATCH / DELETE', async () => {
  preloadAuth()
  const now = Date.now()

  wx.enqueue({ statusCode: 200, data: { exercises: [{ id: 'ex-1', name: '卧推', isCustom: false }] } })
  const exercises = await data.listExercises()
  assert.equal(exercises[0].name, '卧推')

  wx.enqueue({ statusCode: 201, data: { session: { id: 'session-1' } } })
  await data.createSession({ date: '2026-09-08', status: 'completed', bodyParts: ['chest'], createdAt: now })

  wx.enqueue({ statusCode: 200, data: { session: { id: 'session-1' }, workoutExercises: [] } })
  const detail = await data.getSession('session-1')
  assert.equal(detail.session.id, 'session-1')

  wx.enqueue({ statusCode: 200, data: { session: { id: 'session-1', notes: 'ok' } } })
  await data.patchSession('session-1', { notes: 'ok' })

  wx.enqueue({ statusCode: 200, data: {} })
  await data.deleteSession('session-1')

  wx.enqueue({ statusCode: 201, data: { workoutExercise: { id: 'we-1' } } })
  await data.addWorkoutExercise('session-1', { exerciseId: 'ex-1', createdAt: now })
  wx.enqueue({ statusCode: 200, data: { set: { id: 'set-1', weight: 60, reps: 12 } } })
  await data.patchSet('set-1', { weight: 62.5, reps: 10 })
  wx.enqueue({ statusCode: 200, data: {} })
  await data.deleteSet('set-1')
  wx.enqueue({ statusCode: 200, data: {} })
  await data.deleteWorkoutExercise('we-1')

  const methods = wx.requests.map((r) => ({ m: r.method, u: r.url }))
  assert.deepEqual(methods.map((x) => x.m), ['GET', 'POST', 'GET', 'PATCH', 'DELETE', 'POST', 'PATCH', 'DELETE', 'DELETE'])
  assert.equal(methods[3].u.endsWith('/api/sessions/session-1'), true)
  assert.equal(methods[6].u.endsWith('/api/sets/set-1'), true)
  assert.equal(methods[7].u.endsWith('/api/sets/set-1'), true)
  assert.equal(methods[8].u.endsWith('/api/workout-exercises/we-1'), true)
})

test('动作库与模板 CRUD 全部复用认证 client', async () => {
  preloadAuth()
  const now = Date.now()
  wx.enqueue({ statusCode: 201, data: { exercise: { id: 'ex-custom' } } })
  await data.createExercise({ id: 'ex-custom', name: '测试动作', bodyPart: 'chest', createdAt: now, updatedAt: now })
  wx.enqueue({ statusCode: 200, data: { exercise: { id: 'ex-custom', name: '新名称' } } })
  await data.patchExercise('ex-custom', { name: '新名称' })
  wx.enqueue({ statusCode: 200, data: { ok: true } })
  await data.deleteExercise('ex-custom')

  wx.enqueue({ statusCode: 201, data: { template: { id: 'tpl-1' } } })
  await data.createTemplate({ id: 'tpl-1', name: '胸 A', bodyParts: ['chest'], items: [], createdAt: now, updatedAt: now })
  wx.enqueue({ statusCode: 200, data: { template: { id: 'tpl-1', name: '胸 B' } } })
  await data.patchTemplate('tpl-1', { name: '胸 B' })
  wx.enqueue({ statusCode: 200, data: { ok: true } })
  await data.deleteTemplate('tpl-1')

  assert.deepEqual(wx.requests.map((r) => r.method), ['POST', 'PATCH', 'DELETE', 'POST', 'PATCH', 'DELETE'])
  assert.ok(wx.requests.every((r) => r.header.Authorization === 'Bearer jwt-user-a'))
  assert.ok(wx.requests[0].url.endsWith('/api/exercises'))
  assert.ok(wx.requests[3].url.endsWith('/api/templates'))
})
