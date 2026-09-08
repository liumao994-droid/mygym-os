'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { freshWx } = require('./fakeWx.js')
const session = require('../utils/session.js')
const strength = require('../services/strength.js')

let wx

beforeEach(() => {
  wx = freshWx()
  session.saveAuth({
    token: 'jwt-user-a',
    user: { id: 'user-a', nickname: '用户A', authProvider: 'wechat' }
  })
})

test('startSession 创建服务端 active 会话,标题由部位生成', async () => {
  wx.enqueue({
    statusCode: 201,
    data: {
      session: {
        id: 'session-active-1',
        status: 'active',
        bodyParts: ['chest', 'triceps'],
        title: '胸 + 三头',
        date: '2026-09-08'
      }
    }
  })
  const sessionRow = await strength.startSession(['chest', 'triceps'])
  assert.equal(sessionRow.id, 'session-active-1')
  const req = wx.requests[0]
  assert.equal(req.method, 'POST')
  assert.equal(req.url, 'http://127.0.0.1:8787/api/sessions')
  assert.equal(req.data.status, 'active')
  assert.deepEqual(req.data.bodyParts, ['chest', 'triceps'])
  assert.equal(req.header.Authorization, 'Bearer jwt-user-a')
})

test('copyLastCompletedSession 复制最近训练为新的 active 会话', async () => {
  wx.enqueue({ statusCode: 200, data: { sessions: [{ id: 'last-1', status: 'completed', bodyParts: ['back'], title: '背' }] } })
  wx.enqueue({
    statusCode: 200,
    data: {
      session: { id: 'last-1', date: '2026-09-07', status: 'completed', bodyParts: ['back'] },
      workoutExercises: [
        {
          id: 'we-1',
          exerciseId: 'ex-1',
          order: 0,
          sets: [{ id: 'set-1', setNumber: 1, weight: 50, reps: 10, weightType: 'weight' }]
        }
      ]
    }
  })
  wx.enqueue({ statusCode: 201, data: { session: { id: 'copy-1', status: 'active' } } })
  wx.enqueue({ statusCode: 201, data: { workoutExercise: { id: 'we-copy-1', exerciseId: 'ex-1' } } })
  wx.enqueue({ statusCode: 201, data: { set: { id: 'set-copy-1' } } })

  const created = await strength.copyLastCompletedSession()
  assert.equal(created.id, 'copy-1')
  const methods = wx.requests.map((r) => r.method)
  assert.deepEqual(methods, ['GET', 'GET', 'POST', 'POST', 'POST'])
  assert.equal(wx.requests[2].data.status, 'active')
  assert.equal(wx.requests[3].data.exerciseId, 'ex-1')
  assert.equal(wx.requests[4].data.reps, 10)
  assert.equal(wx.requests[4].data.weight, 50)
})

test('addSetGroup 按 count 连续写组并保留 kg 底层语义', async () => {
  wx.enqueue({ statusCode: 200, data: { sessions: [{ id: 's-1' }] } })
  await strength.getActiveSession()
  wx.enqueue({ statusCode: 201, data: { set: { id: 'set-2' } } })
  wx.enqueue({ statusCode: 201, data: { set: { id: 'set-3' } } })
  await strength.addSetGroup('s-1', 'we-1', {
    weightType: 'assisted',
    weight: '20',
    reps: '8',
    count: '2',
    date: '2026-09-08',
    baseSetNumber: 1
  })
  const posts = wx.requests.filter((r) => r.method === 'POST')
  assert.equal(posts.length, 2)
  assert.equal(posts[0].data.weight, -20)
  assert.equal(posts[1].data.setNumber, 3)
})
