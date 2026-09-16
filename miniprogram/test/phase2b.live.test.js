'use strict'

/**
 * Phase 2B 生命周期回归 —— 在隔离服务器(临时 DB + 独立端口)上驱动
 * 真实小程序服务层与页面代码,覆盖:
 *   1. 力量训练完整闭环(开始→动作→加组→编辑/删组→完成→统计→复制/放弃)
 *   2. 羽毛球/游泳/网球 新增、保存、详情回填、编辑、历史
 *   3. MG-001/MG-004:未完成(active)训练不得进入正式统计
 *   4. MG-003 前端校验 + 服务端兜底;busy 防重复点击;网络失败与重试
 *   5. 超长历史压力(600 训练 / 1800 组 / 900 活动 / 40 休息日,1440 行时间线)
 *
 * 用户真实数据不受影响:连接 127.0.0.1 隔离端口,DB 位于 os.tmpdir()。
 * 服务器无法启动时本文件整体 skip(不阻塞常规 npm test)。
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { startIsolatedServer, makeRequester, stopServer } = require('./helpers/live-server.js')
const { RealWx, pageInstance, waitUntil } = require('./helpers/real-wx.js')
const session = require('../utils/session.js')
const auth = require('../services/auth.js')
const data = require('../services/data.js')
const strength = require('../services/strength.js')
const { todayStr } = require('../models/contracts.js')

const ctx = {
  ready: false,
  reason: '',
  req: null,
  wxh: null,
  metrics: {},
  userA: null,
  userB: null,
  A: { completedSessions: 0, completedSets: 0, volume: 0, activities: 0, badminton: 0, swimming: 0, tennis: 0, volleyball: 0 },
  ids: {},
  workoutPages: []
}

/** workout 页在 active 会话上会持有 1s 计时器,统一登记防止挂住 Node 事件循环 */
function workoutPage() {
  const page = pageInstance(ctx.wxh, 'pages/workout/workout.js')
  ctx.workoutPages.push(page)
  return page
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateOffset(daysBack) {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function tsAt(dateStr, hour) {
  return new Date(`${dateStr}T${pad2(hour)}:00:00`).getTime()
}

function inMonth(dateStr, monthKey) {
  return typeof dateStr === 'string' && dateStr.slice(0, 7) === monthKey
}

async function loginAs(nickname) {
  const res = await ctx.req('POST', '/auth/dev-login', { body: { nickname } })
  assert.equal(res.status, 200, `dev-login 失败: ${JSON.stringify(res.body)}`)
  return res.body
}

function become(user) {
  session.saveAuth({ token: user.token, user: user.user })
}

async function loadPageViaShow(page, what) {
  page.onShow()
  await waitUntil(() => !page.data.loading, { what: what || 'page load' })
  return page
}

/* ---------------- 启动 / 清理 ---------------- */

before(async () => {
  const handle = await startIsolatedServer()
  if (!handle.ok) {
    ctx.reason = handle.reason || '未知原因'
    return
  }
  ctx.handle = handle
  ctx.req = makeRequester(handle.port)
  ctx.wxh = new RealWx(`http://127.0.0.1:${handle.port}`).install()
  ctx.wxh.setStorageSync('mygym.apiBase', `http://127.0.0.1:${handle.port}`)
  ctx.userA = await loginAs('Phase2B-用户A')
  ctx.userB = await loginAs('Phase2B-压测B')
  ctx.ready = true
})

after(async () => {
  for (const page of ctx.workoutPages) {
    try { page.clearTimer() } catch (e) { /* 尽力清理 */ }
  }
  await stopServer(ctx.handle)
})

function live(name, fn) {
  test(name, async (t) => {
    if (!ctx.ready) return t.skip(`隔离服务器不可用: ${ctx.reason}`)
    await fn(t)
  })
}

/* ================= 一、力量训练完整闭环(用户 A) ================= */

live('闭环① 开始训练:创建 active 会话并加入动作与组', async () => {
  become(ctx.userA)
  const started = await strength.startSession(['chest', 'back'])
  assert.equal(started.status, 'active')
  assert.equal(started.title, '胸 + 背')
  ctx.ids.s1 = started.id

  const exercises = await data.listExercises()
  assert.ok(exercises.length === 34, `默认动作库应为 34 个,实际 ${exercises.length}`)
  ctx.ids.bench = exercises.find((e) => e.name === '杠铃卧推' && e.bodyPart === 'chest')

  const we = await strength.addExerciseToSession(ctx.ids.s1, ctx.ids.bench)
  ctx.ids.we1 = we.id

  await strength.addSetGroup(ctx.ids.s1, ctx.ids.we1, {
    weightType: 'weight', weight: '60', reps: '8', count: '3', date: started.date, baseSetNumber: 0
  })
  await strength.addSetGroup(ctx.ids.s1, ctx.ids.we1, {
    weightType: 'weight', weight: '40', reps: '10', count: '2', date: started.date, baseSetNumber: 3
  })

  const detail = await data.getSession(ctx.ids.s1)
  assert.equal(detail.workoutExercises.length, 1)
  assert.equal(detail.workoutExercises[0].sets.length, 5)
  assert.deepEqual(detail.workoutExercises[0].sets.map((s) => s.setNumber), [1, 2, 3, 4, 5])
})

live('闭环② 编辑组重量、删除组并触发组号重排', async () => {
  become(ctx.userA)
  const before = await data.getSession(ctx.ids.s1)
  const sets = before.workoutExercises[0].sets
  await strength.updateSet(sets[1].id, { weight: 62.5 })
  await strength.removeSet(sets[4].id)

  const after = await data.getSession(ctx.ids.s1)
  const rest = after.workoutExercises[0].sets
  assert.equal(rest.length, 4)
  assert.deepEqual(rest.map((s) => s.setNumber), [1, 2, 3, 4], '删除后组号应连续重排')
  assert.deepEqual(rest.map((s) => s.weight), [60, 62.5, 60, 40])
  assert.deepEqual(rest.map((s) => s.reps), [8, 8, 8, 10])

  // 训练页渲染:组数与训练量与云端一致
  const page = workoutPage()
  page.sessionId = ctx.ids.s1
  await page.load()
  assert.equal(page.data.totalSets, 4)
  assert.equal(page.data.totalVolume, 1860)
  assert.equal(page.data.readOnly, false)
  assert.equal(page.data.items[0].name, '杠铃卧推')
  assert.equal(page.data.items[0].sets[1].displayWeight, '62.5kg')
  page.clearTimer()
})

live('闭环③ MG-001/MG-004:active 会话不进入我的/首页/历史统计', async () => {
  become(ctx.userA)
  // 我的
  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  await loadPageViaShow(me, 'me load (active period)')
  assert.deepEqual(me.data.stats, { sessions: 0, sets: 0, exercises: 34, volume: 0, activities: 0 })
  // 首页
  const home = pageInstance(ctx.wxh, 'pages/home/home.js')
  home.onLoad()
  await waitUntil(() => !home.data.loading && home.hasLoaded, { what: 'home refresh (active period)' })
  const strengthCard = home.data.sports.find((s) => s.id === 'strength')
  assert.equal(strengthCard.count, 0, '首页力量次数不得包含 active 会话')
  assert.equal(strengthCard.recent.length, 0)
  assert.equal(home.data.totalRecords, 0)
  assert.equal(home.data.monthRecords, 0)
  assert.equal(home.data.latestDate, '--')
  // 历史
  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history load (active period)')
  assert.equal(history.data.rows.length, 0)
  assert.equal(history.data.visibleRows.length, 0)
})

live('闭环④ 完成训练:详情落库,统计与历史同步出现', async () => {
  become(ctx.userA)
  await strength.completeWorkout(ctx.ids.s1, { notes: 'Phase 2B 闭环', feel: 4, durationSec: 1200 })
  ctx.A.completedSessions += 1
  ctx.A.completedSets += 4
  ctx.A.volume += 1860

  const detail = await data.getSession(ctx.ids.s1)
  assert.equal(detail.session.status, 'completed')
  assert.equal(detail.session.notes, 'Phase 2B 闭环')
  assert.equal(detail.session.feel, 4)
  assert.equal(detail.session.durationSec, 1200)
  assert.ok(detail.session.completedAt)

  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  await loadPageViaShow(me, 'me load after complete')
  assert.deepEqual(me.data.stats, {
    sessions: 1, sets: 4, exercises: 34, volume: 1860, activities: 0
  })

  const home = pageInstance(ctx.wxh, 'pages/home/home.js')
  home.onLoad()
  await waitUntil(() => !home.data.loading && home.hasLoaded, { what: 'home refresh after complete' })
  const strengthCard = home.data.sports.find((s) => s.id === 'strength')
  assert.equal(strengthCard.count, 1)
  assert.equal(strengthCard.recent[0].summary, '胸 + 背')
  assert.equal(home.data.totalRecords, 1)
  assert.equal(home.data.monthRecords, 1)
  assert.equal(home.data.latestDate, todayStr().slice(5).replace('-', '.'))

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history load after complete')
  const row = history.data.rows.find((r) => r.id === ctx.ids.s1)
  assert.ok(row, '历史时间线应包含刚完成的训练')
  assert.equal(row.sport, 'strength')
  assert.equal(row.detail, '20 分钟')
  const todayCell = history.data.calendar.find((c) => c.date === todayStr())
  assert.equal(todayCell.strength, true)
  assert.deepEqual(history.data.counts, { training: 1, rest: 0 })
})

live('闭环⑤ MG-002 计时器生命周期:active 启动、完成后同一页面实例立即停止', async () => {
  become(ctx.userA)
  const s2 = await strength.startSession(['legs'])
  ctx.ids.s2 = s2.id

  const page = workoutPage()
  page.sessionId = s2.id
  await page.load()
  assert.ok(page.timer, 'active 会话应启动计时器')
  const startedAtElapsed = page.data.elapsed

  await strength.completeWorkout(s2.id, { durationSec: 600 })
  ctx.A.completedSessions += 1
  ctx.A.volume += 0
  await page.load()
  assert.equal(page.timer, null, '完成后重新加载必须清理计时器(MG-002)')
  assert.equal(page.data.readOnly, true)

  const fresh = workoutPage()
  fresh.sessionId = s2.id
  await fresh.load()
  assert.equal(fresh.timer, null, 'completed 页面不应再保留定时器')
  assert.equal(fresh.data.readOnly, true)
  assert.ok(startedAtElapsed, '计时文本曾在 active 阶段渲染')
})

live('闭环⑥ MG-302 动作选择复用页面已加载动作库,不重复请求', async () => {
  become(ctx.userA)
  const s3 = await strength.startSession(['chest'])
  ctx.ids.s3 = s3.id
  const exercises = await data.listExercises()
  const rope = exercises.find((e) => e.name === '绳索夹胸')
  const pushup = exercises.find((e) => e.name === '俯卧撑')
  ctx.ids.rope = rope
  const we = await strength.addExerciseToSession(s3.id, rope)
  await strength.addSetGroup(s3.id, we.id, {
    weightType: 'weight', weight: '20', reps: '10', count: '1', date: s3.date, baseSetNumber: 0
  })

  const page = workoutPage()
  page.sessionId = s3.id
  await page.load()
  const exerciseGets = ctx.wxh.requestsTo('/api/exercises').length
  page.onOpenPicker()
  assert.equal(page.data.pickerOpen, true)
  assert.equal(page.data.pickableExercises.length, page.data.exercises.length)
  assert.ok(page.data.pickableExercises.length > 0)
  assert.equal(
    ctx.wxh.requestsTo('/api/exercises').length,
    exerciseGets,
    '打开选择器不得再次请求动作库(MG-302)'
  )

  await page.onPickExercise({ currentTarget: { dataset: { id: pushup.id } } })
  assert.equal(page.data.pickerOpen, false)
  assert.equal(page.data.items.length, 2)

  // 通过页面交互为俯卧撑(bodyweight)加一组
  await page.onAddSetGroup({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.items[1].sets.length, 1)
  page.clearTimer()

  await strength.completeWorkout(s3.id, { durationSec: 900 })
  ctx.A.completedSessions += 1
  ctx.A.completedSets += 2
  ctx.A.volume += 200
})

live('闭环⑦ 复制上次训练:active 副本不进统计,放弃后删除', async () => {
  become(ctx.userA)
  const copy = await strength.copyLastCompletedSession()
  assert.ok(copy)
  assert.equal(copy.status, 'active')
  const detail = await data.getSession(copy.id)
  assert.equal(detail.workoutExercises.length, 2)
  const allSets = detail.workoutExercises.flatMap((w) => w.sets)
  assert.equal(allSets.length, 2)

  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  await loadPageViaShow(me, 'me load during copy')
  assert.equal(me.data.stats.sessions, ctx.A.completedSessions, 'active 副本不得计入已完成次数')
  assert.equal(me.data.stats.sets, ctx.A.completedSets)

  await strength.discardWorkout(copy.id)
  const gone = await ctx.req('GET', `/sessions/${copy.id}`, { token: ctx.userA.token })
  assert.equal(gone.status, 404)
  data.clearReadCache()
})

live('闭环⑧ 训练 Tab:最近完成列表(此时无 active 会话)', async () => {
  become(ctx.userA)
  const page = pageInstance(ctx.wxh, 'pages/strength/strength.js')
  await loadPageViaShow(page, 'strength tab load')
  assert.equal(page.data.active, null, '所有会话已完成/放弃后无恢复入口')
  assert.equal(page.data.recent.length, ctx.A.completedSessions)
})

/* ================= 二、羽毛球/游泳/网球 回归(用户 A) ================= */

live('羽毛球:新增→保存→历史→详情回填→编辑', async () => {
  become(ctx.userA)
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'badminton' })
  await loadPageViaShow(page, 'badminton list load')
  assert.equal(ctx.wxh.titles[ctx.wxh.titles.length - 1], '羽毛球')

  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onTimeChange({ detail: { value: '10:30' } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '90' } })
  page.onField({ currentTarget: { dataset: { field: 'venue' } }, detail: { value: '测试球馆' } })
  page.onField({ currentTarget: { dataset: { field: 'notes' } }, detail: { value: '羽毛球备注' } })
  page.onRpe({ currentTarget: { dataset: { value: 7 } } })
  page.onField({ currentTarget: { dataset: { field: 'gamesWon' } }, detail: { value: '2' } })
  page.onField({ currentTarget: { dataset: { field: 'gamesLost' } }, detail: { value: '1' } })
  assert.equal(page.data.form.gamesTotal, '3', '羽毛球胜负输入应自动汇总总场数')
  page.onMatchChange({ detail: { value: true } })

  await page.onSave()
  assert.equal(page.data.formOpen, false)
  ctx.A.activities += 1
  ctx.A.badminton += 1

  const raw = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  const rec = raw.body.activities[0]
  ctx.ids.badminton = rec.id
  assert.equal(rec.durationMin, 90)
  assert.equal(rec.venue, '测试球馆')
  assert.equal(rec.notes, '羽毛球备注')
  assert.equal(rec.rpe, 7)
  assert.equal(rec.isMatch, 1)
  assert.deepEqual(rec.score, { gamesWon: 2, gamesLost: 1, gamesTotal: 3 })
  assert.ok(rec.startTime)

  // 历史出现,摘要正确
  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history after badminton create')
  const row = history.data.rows.find((r) => r.id === rec.id)
  assert.ok(row)
  assert.equal(row.sport, 'badminton')
  assert.equal(row.detail, '2 胜 · 1 负局')

  // 详情回填 + 编辑
  const edit = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  edit.onLoad({ sport: 'badminton' })
  await loadPageViaShow(edit, 'badminton edit load')
  await edit.onEdit({ currentTarget: { dataset: { id: rec.id } } })
  assert.equal(edit.data.formOpen, true)
  assert.equal(edit.data.editingId, rec.id)
  assert.equal(edit.data.form.durationMin, 90)
  assert.equal(edit.data.form.venue, '测试球馆')
  assert.equal(edit.data.form.gamesWon, 2)
  assert.equal(edit.data.form.isMatch, true)
  assert.equal(edit.data.form.startTimeText, '10:30')

  edit.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '105' } })
  edit.onField({ currentTarget: { dataset: { field: 'gamesWon' } }, detail: { value: '3' } })
  assert.equal(edit.data.form.gamesTotal, '4')
  await edit.onSave()
  assert.equal(edit.data.formOpen, false)

  const after = await ctx.req('GET', `/activities/${rec.id}`, { token: ctx.userA.token })
  assert.equal(after.body.activity.durationMin, 105)
  assert.equal(after.body.activity.score.gamesWon, 3)
  assert.equal(after.body.activity.score.gamesTotal, 4)

  // 历史摘要同步更新
  const history2 = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history2, 'history after badminton edit')
  assert.equal(history2.data.rows.find((r) => r.id === rec.id).detail, '3 胜 · 1 负局')
})

live('游泳:新增(含配速)→保存→详情回填→编辑→历史', async () => {
  become(ctx.userA)
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'swimming' })
  await loadPageViaShow(page, 'swimming list load')
  assert.equal(ctx.wxh.titles[ctx.wxh.titles.length - 1], '游泳')

  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '45' } })
  page.onField({ currentTarget: { dataset: { field: 'distanceM' } }, detail: { value: '1500' } })
  page.onField({ currentTarget: { dataset: { field: 'poolLengthM' } }, detail: { value: '50' } })
  page.onField({ currentTarget: { dataset: { field: 'laps' } }, detail: { value: '30' } })
  page.onField({ currentTarget: { dataset: { field: 'calories' } }, detail: { value: '400' } })
  page.onStrokeChange({ detail: { value: '1' } })
  page.onRpe({ currentTarget: { dataset: { value: 6 } } })
  assert.equal(page.data.paceLabel, '3:00 / 100m', '1500m/45min 自动配速')

  await page.onSave()
  ctx.A.activities += 1
  ctx.A.swimming += 1

  const raw = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'swimming' } })
  const rec = raw.body.activities[0]
  ctx.ids.swimming = rec.id
  assert.equal(rec.distanceM, 1500)
  assert.equal(rec.poolLengthM, 50)
  assert.equal(rec.laps, 30)
  assert.equal(rec.stroke, 'freestyle')
  assert.equal(rec.calories, 400)

  // 英里换算(payload 语义,不落库)
  const conv = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  conv.onLoad({ sport: 'swimming' })
  conv.onCreate()
  conv.onField({ currentTarget: { dataset: { field: 'distanceM' } }, detail: { value: '1' } })
  conv.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '30' } })
  conv.onDistanceUnit({ currentTarget: { dataset: { value: 'mi' } } })
  const payload = conv.payload()
  assert.ok(Math.abs(payload.distanceM - 1609.344) < 0.01, '英里应换算为米')
  assert.equal(conv.data.paceLabel, '1:52 / 100m')

  // 详情回填 + 编辑圈数
  const edit = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  edit.onLoad({ sport: 'swimming' })
  await loadPageViaShow(edit, 'swimming edit load')
  await edit.onEdit({ currentTarget: { dataset: { id: rec.id } } })
  assert.equal(edit.data.form.distanceM, 1500)
  assert.equal(edit.data.form.laps, 30)
  assert.equal(edit.data.strokeIndex, 1)
  edit.onField({ currentTarget: { dataset: { field: 'laps' } }, detail: { value: '32' } })
  await edit.onSave()
  const after = await ctx.req('GET', `/activities/${rec.id}`, { token: ctx.userA.token })
  assert.equal(after.body.activity.laps, 32)

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history after swimming')
  assert.equal(history.data.rows.find((r) => r.id === rec.id).detail, '1500 米 · 45 分钟')
})

live('网球:逐盘比分联动、技术/体能/彩蛋备注,新增→详情→编辑→历史', async () => {
  become(ctx.userA)
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'tennis' })
  await loadPageViaShow(page, 'tennis list load')
  assert.equal(ctx.wxh.titles[ctx.wxh.titles.length - 1], '网球')

  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '120' } })
  page.onField({ currentTarget: { dataset: { field: 'venue' } }, detail: { value: '网球场' } })
  page.onField({ currentTarget: { dataset: { field: 'notes' } }, detail: { value: '今天有没有想三毛?' } })
  page.onRpe({ currentTarget: { dataset: { value: 8 } } })
  page.onSurfaceChange({ detail: { value: '1' } })
  page.onNatureChange({ detail: { value: '1' } })
  page.onAddTennisSet()
  page.onAddTennisSet()
  page.onTennisSetField({ currentTarget: { dataset: { index: 0, side: 'a' } }, detail: { value: '6' } })
  page.onTennisSetField({ currentTarget: { dataset: { index: 0, side: 'b' } }, detail: { value: '4' } })
  page.onTennisSetField({ currentTarget: { dataset: { index: 1, side: 'a' } }, detail: { value: '7' } })
  page.onTennisSetField({ currentTarget: { dataset: { index: 1, side: 'b' } }, detail: { value: '5' } })
  assert.equal(page.data.form.gamesTotal, '2')
  assert.equal(page.data.form.gamesWon, '2')
  assert.equal(page.data.form.gamesLost, '0')
  assert.equal(page.data.form.scoreText, '6-4 7-5')
  page.onTrainingType({ currentTarget: { dataset: { label: '正手' } } })
  page.onTrainingType({ currentTarget: { dataset: { label: '发球' } } })
  page.onNestedField({ currentTarget: { dataset: { group: 'technique', field: 'firstServeIn' } }, detail: { value: '35' } })
  page.onNestedField({ currentTarget: { dataset: { group: 'technique', field: 'firstServePoints' } }, detail: { value: '50' } })
  page.onNestedField({ currentTarget: { dataset: { group: 'fitness', field: 'runMinutes' } }, detail: { value: '30' } })
  page.onNestedField({ currentTarget: { dataset: { group: 'fitness', field: 'avgHr' } }, detail: { value: '140' } })
  page.onField({ currentTarget: { dataset: { field: 'trainingFocus' } }, detail: { value: '底线稳定性' } })

  await page.onSave()
  ctx.A.activities += 1
  ctx.A.tennis += 1

  const raw = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'tennis' } })
  const rec = raw.body.activities[0]
  ctx.ids.tennis = rec.id
  assert.equal(rec.notes, '今天有没有想三毛?', '网球备注彩蛋数据必须原样保存')
  assert.deepEqual(rec.sets, [{ a: 6, b: 4 }, { a: 7, b: 5 }])
  assert.equal(rec.scoreText, '6-4 7-5')
  assert.deepEqual(rec.score, { gamesWon: 2, gamesLost: 0, gamesTotal: 2 })
  assert.deepEqual(rec.trainingTypes, ['正手', '发球'])
  assert.equal(rec.technique.firstServeIn, 35)
  assert.equal(rec.fitness.avgHr, 140)
  assert.equal(rec.surface, 'hard')
  assert.equal(rec.nature, 'training')

  // 详情回填 + 增加第三盘
  const edit = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  edit.onLoad({ sport: 'tennis' })
  await loadPageViaShow(edit, 'tennis edit load')
  await edit.onEdit({ currentTarget: { dataset: { id: rec.id } } })
  assert.equal(edit.data.form.notes, '今天有没有想三毛?')
  assert.deepEqual(edit.data.form.sets, [{ a: 6, b: 4 }, { a: 7, b: 5 }])
  assert.equal(edit.data.form.technique.firstServeIn, 35)
  edit.onAddTennisSet()
  edit.onTennisSetField({ currentTarget: { dataset: { index: 2, side: 'a' } }, detail: { value: '6' } })
  edit.onTennisSetField({ currentTarget: { dataset: { index: 2, side: 'b' } }, detail: { value: '2' } })
  assert.equal(edit.data.form.scoreText, '6-4 7-5 6-2')
  await edit.onSave()
  const after = await ctx.req('GET', `/activities/${rec.id}`, { token: ctx.userA.token })
  assert.deepEqual(after.body.activity.sets, [{ a: 6, b: 4 }, { a: 7, b: 5 }, { a: 6, b: 2 }])

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history after tennis')
  assert.equal(history.data.rows.find((r) => r.id === rec.id).detail, '3 胜 · 0 负盘')
})

live('排球:动态局分、六类技术统计、个人得分、月/年统计、编辑与删除', async () => {
  become(ctx.userA)
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'volleyball' })
  await loadPageViaShow(page, 'volleyball list load')
  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '90' } })
  page.onVbSessionType({ detail: { value: '3' } })
  page.onVbPosition({ detail: { value: '1' } })
  for (let i = 0; i < 3; i++) page.onAddVbSet()
  ;[['25','20'],['20','25'],['15','10']].forEach((scores, index) => {
    page.onVbSetField({ currentTarget: { dataset: { index, side: 'our' } }, detail: { value: scores[0] } })
    page.onVbSetField({ currentTarget: { dataset: { index, side: 'their' } }, detail: { value: scores[1] } })
  })
  const stats = {
    serve: { attempts: '20', aces: '3', errors: '2' },
    attack: { attempts: '30', points: '10', errors: '2', blocked: '1' },
    block: { points: '2', effective: '4' },
    reception: { attempts: '25', perfect: '18', errors: '1' },
    dig: { attempts: '12', successful: '9' },
    set: { attempts: '40', successful: '35' }
  }
  Object.entries(stats).forEach(([group, fields]) => Object.entries(fields).forEach(([field, value]) => {
    page.onVbStatField({ currentTarget: { dataset: { group, field } }, detail: { value } })
  }))
  await page.onSave()

  const listed = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'volleyball' } })
  const rec = listed.body.activities[0]
  assert.deepEqual(rec.volleyballSets, [{ ourScore: 25, opponentScore: 20 }, { ourScore: 20, opponentScore: 25 }, { ourScore: 15, opponentScore: 10 }])
  assert.equal(rec.volleyballStats.serve.aces, 3)
  assert.equal(rec.volleyballStats.attack.points, 10)
  assert.equal(rec.volleyballStats.block.points, 2)
  assert.equal(rec.volleyballStats.reception.perfect, 18)
  assert.equal(rec.volleyballStats.dig.successful, 9)
  assert.equal(rec.volleyballStats.set.successful, 35)

  const edit = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  edit.onLoad({ sport: 'volleyball' })
  await loadPageViaShow(edit, 'volleyball edit load')
  await edit.openEdit(rec.id)
  assert.equal(edit.data.form.vbSets.length, 3)
  edit.onVbStatField({ currentTarget: { dataset: { group: 'serve', field: 'aces' } }, detail: { value: '4' } })
  await edit.onSave()

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history after volleyball')
  assert.equal(history.data.rows.find((row) => row.id === rec.id).detail, '2 胜 · 1 负局 · 个人 16 分')

  const reports = pageInstance(ctx.wxh, 'pages/reports/reports.js')
  await loadPageViaShow(reports, 'reports after volleyball')
  assert.equal(reports.data.report.volleyball.count, 1)
  assert.equal(reports.data.report.volleyball.personalPoints, 16)
  assert.equal(reports.data.year.volleyball.personalPoints, 16)
  assert.equal(/NaN|Infinity|undefined/.test(JSON.stringify(reports.data)), false)

  await edit.onDelete({ currentTarget: { dataset: { id: rec.id } } })
  const afterDelete = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'volleyball' } })
  assert.equal(afterDelete.body.activities.length, 0)
  await reports.load()
  assert.equal(reports.data.report.volleyball.count, 0)
  assert.equal(reports.data.year.volleyball.personalPoints, 0)
})

live('MG-003 前端校验:异常输入全部拦截且不发出任何请求', async () => {
  become(ctx.userA)
  const postsBefore = ctx.wxh.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/activities')).length
  const cases = [
    ['badminton', (p) => p.onDateChange({ detail: { value: '2026-02-30' } }), '请选择有效日期'],
    ['badminton', (p) => p.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '-5' } }), '时长超出允许范围'],
    ['badminton', (p) => p.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: 'abc' } }), '时长必须是数字'],
    ['badminton', (p) => p.onField({ currentTarget: { dataset: { field: 'gamesWon' } }, detail: { value: '-1' } }), '胜场超出允许范围'],
    ['badminton', (p) => p.onField({ currentTarget: { dataset: { field: 'pointsTotal' } }, detail: { value: '2.5' } }), '总得分必须是整数'],
    ['swimming', (p) => p.onField({ currentTarget: { dataset: { field: 'laps' } }, detail: { value: '2.5' } }), '趟数必须是整数'],
    ['swimming', (p) => p.onField({ currentTarget: { dataset: { field: 'poolLengthM' } }, detail: { value: '20000' } }), '泳池长度超出允许范围'],
    ['swimming', (p) => p.onField({ currentTarget: { dataset: { field: 'distanceM' } }, detail: { value: '-3' } }), '距离超出允许范围'],
    ['tennis', (p) => { p.onAddTennisSet(); p.onTennisSetField({ currentTarget: { dataset: { index: 0, side: 'a' } }, detail: { value: '100' } }) }, '逐盘比分超出允许范围'],
    ['tennis', (p) => p.onNestedField({ currentTarget: { dataset: { group: 'technique', field: 'aces' } }, detail: { value: '-2' } }), '技术统计超出允许范围'],
    ['tennis', (p) => p.onNestedField({ currentTarget: { dataset: { group: 'fitness', field: 'avgHr' } }, detail: { value: '500' } }), '平均心率超出允许范围'],
    ['badminton', (p) => p.onRpe({ currentTarget: { dataset: { value: 11 } } }), '主观强度必须是 1-10'],
    ['badminton', (p) => p.onRpe({ currentTarget: { dataset: { value: 0 } } }), '主观强度必须是 1-10']
  ]
  for (const [sport, setup, expected] of cases) {
    const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
    page.onLoad({ sport })
    page.onCreate()
    setup(page)
    await page.onSave()
    const toast = ctx.wxh.lastToast()
    assert.equal(toast && toast.title, expected, `${sport} 异常输入应提示「${expected}」,实际「${toast && toast.title}」`)
    assert.equal(page.data.formOpen, true, '校验失败时表单必须保持打开')
    assert.equal(page.data.busy, false)
  }
  const postsAfter = ctx.wxh.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/activities')).length
  assert.equal(postsAfter, postsBefore, '异常输入不得发出任何创建请求')

  // RPE=10 边界可用且可保存
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'badminton' })
  await loadPageViaShow(page, 'rpe boundary load')
  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '10' } })
  page.onRpe({ currentTarget: { dataset: { value: 10 } } })
  await page.onSave()
  ctx.A.activities += 1
  ctx.A.badminton += 1
})

live('MG-003 服务端兜底:异常 payload 全部 400,未知字段被清洗', async () => {
  become(ctx.userA)
  const token = ctx.userA.token
  const invalid = [
    { sport: 'badminton', date: todayStr(), durationMin: -1 },
    { sport: 'badminton', date: todayStr(), durationMin: 0 },
    { sport: 'swimming', date: todayStr(), laps: 2.5 },
    { sport: 'swimming', date: todayStr(), distanceM: -5 },
    { sport: 'swimming', date: todayStr(), poolLengthM: 0 },
    { sport: 'swimming', date: todayStr(), calories: -1 },
    { sport: 'badminton', date: todayStr(), rpe: 0 },
    { sport: 'badminton', date: todayStr(), rpe: 11 },
    { sport: 'badminton', date: todayStr(), startTime: -1 },
    { sport: 'badminton', date: todayStr(), score: { gamesWon: -2 } },
    { sport: 'badminton', date: todayStr(), score: { gamesWon: 2.5 } },
    { sport: 'tennis', date: todayStr(), sets: [{ a: 100, b: 0 }] },
    { sport: 'tennis', date: todayStr(), technique: { aces: 10000001 } },
    { sport: 'badminton', date: '2026-13-40' },
    { sport: 'football', date: todayStr() },
    { sport: 'badminton', date: todayStr(), venue: 'x'.repeat(201) },
    { sport: 'badminton', date: todayStr(), notes: 'x'.repeat(5001) },
    { sport: 'badminton', date: todayStr(), durationMin: 'many' }
  ]
  for (const body of invalid) {
    const res = await ctx.req('POST', '/activities', { token, body })
    assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 80)} 应被拒绝`)
    assert.equal(res.body.error, 'INVALID_RECORD')
  }

  // 未知字段清洗:合法字段保留,垃圾字段不落库
  const res = await ctx.req('POST', '/activities', {
    token,
    body: { sport: 'badminton', date: todayStr(), durationMin: 20, junkField: 'hack', userId: 'someone-else' }
  })
  assert.equal(res.status, 201)
  assert.equal(res.body.activity.junkField, undefined)
  assert.notEqual(res.body.activity.userId, 'someone-else')
  const del = await ctx.req('DELETE', `/activities/${res.body.activity.id}`, { token })
  assert.equal(del.status, 200)
  data.clearReadCache()
})

live('防重复点击:保存/完成训练并发双击只产生一次写入', async () => {
  become(ctx.userA)
  // 双击保存(第一次请求延迟 400ms 模拟慢网)
  const before = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'badminton' })
  await loadPageViaShow(page, 'busy save load')
  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '30' } })
  ctx.wxh.delayNext = 400
  const p1 = page.onSave()
  const p2 = page.onSave()
  await Promise.all([p1, p2])
  const after = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  assert.equal(after.body.activities.length, before.body.activities.length + 1, '双击保存只允许写入一条')
  ctx.A.activities += 1
  ctx.A.badminton += 1

  // 双击完成训练
  const s4 = await strength.startSession(['back'])
  const we = await strength.addExerciseToSession(s4.id, ctx.ids.bench)
  await strength.addSetGroup(s4.id, we.id, {
    weightType: 'weight', weight: '50', reps: '10', count: '1', date: s4.date, baseSetNumber: 0
  })
  const wp = workoutPage()
  wp.sessionId = s4.id
  await wp.load()
  wp.onOpenFinish()
  ctx.wxh.delayNext = 400
  const f1 = wp.onConfirmFinish()
  const f2 = wp.onConfirmFinish()
  await Promise.all([f1, f2])
  const detail = await data.getSession(s4.id)
  assert.equal(detail.session.status, 'completed', '双击完成只应生效一次')
  assert.equal(detail.session.status, 'completed')
  assert.equal(detail.workoutExercises[0].sets.length, 1)
  ctx.A.completedSessions += 1
  ctx.A.completedSets += 1
  ctx.A.volume += 500
})

live('网络失败:保存失败有提示且不写脏数据,重试成功;失败会话保持 active', async () => {
  become(ctx.userA)
  // 活动保存断网
  const before = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  const page = pageInstance(ctx.wxh, 'pages/activity/activity.js')
  page.onLoad({ sport: 'badminton' })
  await loadPageViaShow(page, 'network fail load')
  page.onCreate()
  page.onDateChange({ detail: { value: todayStr() } })
  page.onField({ currentTarget: { dataset: { field: 'durationMin' } }, detail: { value: '25' } })
  ctx.wxh.failNext = 1
  await page.onSave()
  const toast = ctx.wxh.lastToast()
  assert.equal(toast && toast.title, '无法连接服务器，请稍后重试')
  assert.equal(page.data.formOpen, true, '断网后表单不得关闭,数据不丢')
  assert.equal(page.data.busy, false)
  const mid = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  assert.equal(mid.body.activities.length, before.body.activities.length, '断网保存不得写入')

  await page.onSave()
  const after = await ctx.req('GET', '/activities', { token: ctx.userA.token, query: { sport: 'badminton' } })
  assert.equal(after.body.activities.length, before.body.activities.length + 1, '恢复后重试成功')
  ctx.A.activities += 1
  ctx.A.badminton += 1

  // 训练中加组断网 → 重试成功,会话保持 active(继续验证 MG-001)
  const s5 = await strength.startSession(['chest'])
  ctx.ids.s5 = s5.id
  const exercises = await data.listExercises()
  const we = await strength.addExerciseToSession(s5.id, exercises.find((e) => e.name === '蝴蝶机夹胸'))
  const wp = workoutPage()
  wp.sessionId = s5.id
  await wp.load()
  ctx.wxh.failNext = 1
  await wp.onAddSetGroup({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(ctx.wxh.lastToast().title, '无法连接服务器，请稍后重试')
  let detail = await data.getSession(s5.id)
  assert.equal(detail.workoutExercises[0].sets.length, 0, '失败请求不得产生半写入')
  await wp.onAddSetGroup({ currentTarget: { dataset: { index: 0 } } })
  detail = await data.getSession(s5.id)
  assert.equal(detail.workoutExercises[0].sets.length, 1)
  assert.equal(detail.session.status, 'active')
  wp.clearTimer()
})

live('最终一致性:存在 active 会话时,全部统计页保持正确口径', async () => {
  become(ctx.userA)
  // 网络失败测试遗留的 s5 仍为 active:训练 Tab 应展示恢复入口,且不进任何统计
  const tab = pageInstance(ctx.wxh, 'pages/strength/strength.js')
  await loadPageViaShow(tab, 'strength tab with active')
  assert.equal(tab.data.active.id, ctx.ids.s5, '训练 Tab 应展示 active 会话恢复入口')
  assert.equal(tab.data.recent.length, ctx.A.completedSessions, '恢复入口不影响最近完成列表')

  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  await loadPageViaShow(me, 'me final')
  assert.deepEqual(me.data.stats, {
    sessions: ctx.A.completedSessions,
    sets: ctx.A.completedSets,
    exercises: 34,
    volume: ctx.A.volume,
    activities: ctx.A.activities
  })

  const home = pageInstance(ctx.wxh, 'pages/home/home.js')
  home.onLoad()
  await waitUntil(() => !home.data.loading && home.hasLoaded, { what: 'home final' })
  const bySport = Object.fromEntries(home.data.sports.map((s) => [s.id, s.count]))
  assert.deepEqual(bySport, {
    strength: ctx.A.completedSessions,
    badminton: ctx.A.badminton,
    swimming: ctx.A.swimming,
    tennis: ctx.A.tennis,
    volleyball: ctx.A.volleyball
  })
  assert.equal(home.data.totalRecords, ctx.A.completedSessions + ctx.A.activities)
  assert.equal(home.data.monthRecords, ctx.A.completedSessions + ctx.A.activities)

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  await loadPageViaShow(history, 'history final')
  assert.equal(history.data.rows.length, ctx.A.completedSessions + ctx.A.activities)
  assert.equal(history.data.visibleRows.length, ctx.A.completedSessions + ctx.A.activities)

  // 历史点击跳转语义
  history.onOpen({ currentTarget: { dataset: { id: ctx.ids.tennis, sport: 'tennis' } } })
  assert.equal(ctx.wxh.navigations[ctx.wxh.navigations.length - 1].url, `/pages/activity/activity?sport=tennis&id=${ctx.ids.tennis}`)
  history.onOpen({ currentTarget: { dataset: { id: ctx.ids.s1, sport: 'strength' } } })
  assert.equal(ctx.wxh.navigations[ctx.wxh.navigations.length - 1].url, `/pages/workout/workout?id=${ctx.ids.s1}`)
})

live('Profile 与每周目标:默认值、云端保存、2/3→3/3→2/3', async () => {
  const userC = await loginAs('Phase2B-周目标C')
  become(userC)
  const defaults = await auth.getProfile()
  assert.equal(defaults.weeklyGoal, 3)
  assert.deepEqual(defaults.favoriteSports, [])
  await auth.updateProfile({ nickname: '周目标用户', avatar: 'yellow', bio: '稳定训练', favoriteSports: ['strength', 'badminton'], weeklyGoal: 3 })
  const now = Date.now()
  const completed = await data.createSession({ date: todayStr(), status: 'completed', bodyParts: ['chest'], durationSec: 1800, startedAt: now - 1800000, completedAt: now, createdAt: now - 1800000, updatedAt: now })
  const firstActivity = await data.createActivity({ sport: 'swimming', date: todayStr(), durationMin: 30, createdAt: now, updatedAt: now })
  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  await loadPageViaShow(me, 'weekly goal 2/3')
  assert.equal(me.data.summary.weeklyCount, 2)
  assert.equal(me.data.summary.weeklyGoal, 3)
  const third = await data.createActivity({ sport: 'badminton', date: todayStr(), durationMin: 45, createdAt: now + 1, updatedAt: now + 1 })
  await me.load()
  assert.equal(me.data.summary.weeklyCount, 3)
  await data.deleteActivity(third.id)
  await me.load()
  assert.equal(me.data.summary.weeklyCount, 2)
  assert.equal(me.data.profile.bio, '稳定训练')
  assert.equal(me.data.profile.avatar, 'yellow')
  assert.equal(completed.status, 'completed')
  assert.equal(firstActivity.sport, 'swimming')
})

/* ================= 三、超长历史压力测试(用户 B) ================= */

const seed = { sessions: [], workoutExercises: [], sets: [], activitySessions: [], dailyStatuses: [] }

function buildStressSeed() {
  const exId = 'p2b-ex-1'
  for (let i = 0; i < 600; i++) {
    const date = dateOffset(i + 2)
    const id = `p2b-s-${i}`
    seed.sessions.push({
      id, date, status: 'completed', bodyParts: ['chest'], title: `压力训练 #${i + 1}`,
      startedAt: tsAt(date, 10), completedAt: tsAt(date, 11), durationSec: 3600,
      createdAt: tsAt(date, 10), updatedAt: tsAt(date, 11)
    })
    const weId = `p2b-we-${i}`
    seed.workoutExercises.push({ id: weId, sessionId: id, exerciseId: exId, order: 0, createdAt: tsAt(date, 10) })
    for (let n = 1; n <= 3; n++) {
      seed.sets.push({
        id: `p2b-set-${i}-${n}`, workoutExerciseId: weId, sessionId: id, exerciseId: exId,
        setNumber: n, weight: 50, reps: 10, weightType: 'weight', date, createdAt: tsAt(date, 10)
      })
    }
  }
  for (let j = 0; j < 900; j++) {
    const sport = ['badminton', 'swimming', 'tennis'][j % 3]
    const date = dateOffset(j * 2 + 3)
    const extra = sport === 'swimming'
      ? { distanceM: 1000, stroke: 'freestyle' }
      : sport === 'badminton'
        ? { score: { gamesWon: 2, gamesLost: 1, gamesTotal: 3 } }
        : { notes: '压力网球' }
    seed.activitySessions.push({
      id: `p2b-a-${j}`, sport, date, durationMin: 40 + (j % 30), venue: `场馆${j}`,
      createdAt: tsAt(date, 9), updatedAt: tsAt(date, 9), ...extra
    })
  }
  for (let i = 0; i < 40; i++) {
    seed.dailyStatuses.push({ date: dateOffset(i * 9 + 1), status: 'rest', note: '休息' })
  }
}

live('压力① 导入 600 训练 / 1800 组 / 900 活动 / 40 休息日', async () => {
  become(ctx.userB)
  buildStressSeed()
  const startedAt = Date.now()
  const res = await ctx.req('POST', '/data/import', {
    token: ctx.userB.token,
    body: { app: 'MyGymOS', schema: 3, data: seed }
  })
  const elapsed = Date.now() - startedAt
  ctx.metrics.importMs = elapsed
  assert.equal(res.status, 200, `导入失败: ${JSON.stringify(res.body).slice(0, 200)}`)
  assert.equal(res.body.imported.sessions, 600)
  assert.equal(res.body.imported.workoutExercises, 600)
  assert.equal(res.body.imported.sets, 1800)
  assert.equal(res.body.imported.activitySessions, 900)
  assert.equal(res.body.imported.dailyStatuses, 40)
  assert.equal(res.body.skippedInvalid, 0)
  assert.equal(res.body.conflicts, 0)
  data.clearReadCache()
})

live('压力② 历史页 1440 行:首批 80 条分批渲染、过滤、选日、月切换', async (t) => {
  become(ctx.userB)
  const listStart = Date.now()
  const sessionsRes = await ctx.req('GET', '/sessions', { token: ctx.userB.token, query: { limit: 500 } })
  const activitiesRes = await ctx.req('GET', '/activities', { token: ctx.userB.token, query: { limit: 1000 } })
  ctx.metrics.sessions500Ms = Date.now() - listStart
  ctx.metrics.sessions500Bytes = sessionsRes.bytes
  ctx.metrics.activities1000Bytes = activitiesRes.bytes
  assert.equal(sessionsRes.body.sessions.length, 500, 'listSessions 上限 500')
  assert.equal(activitiesRes.body.activities.length, 900)

  const history = pageInstance(ctx.wxh, 'pages/history/history.js')
  const loadStart = Date.now()
  await loadPageViaShow(history, 'history stress load')
  ctx.metrics.historyLoadMs = Date.now() - loadStart
  ctx.metrics.historyRows = history.data.rows.length
  assert.equal(history.data.rows.length, 1440, '500 会话 + 900 活动 + 40 休息日')
  assert.equal(history.data.visibleRows.length, 80, '时间线首批只渲染 80 条')
  ctx.metrics.firstBatchBytes = Buffer.byteLength(JSON.stringify(history.data.visibleRows))

  // 切到时间线模式后到底分批追加
  history.onMode({ currentTarget: { dataset: { mode: 'timeline' } } })
  assert.equal(history.data.visibleRows.length, 80, '切模式后回到首批 80 条')
  history.onReachBottom()
  assert.equal(history.data.visibleRows.length, 160)
  history.onReachBottom()
  assert.equal(history.data.visibleRows.length, 240)

  // 过滤
  history.onFilter({ currentTarget: { dataset: { id: 'strength' } } })
  assert.equal(history.data.rows.length, 500)
  assert.equal(history.data.visibleRows.length, 80)
  history.onFilter({ currentTarget: { dataset: { id: 'all' } } })
  assert.equal(history.data.visibleRows.length, 80, '切换过滤后分页重置回首批 80 条')

  // 选日:昨天只有 1 条休息日
  history.onSelectDay({ currentTarget: { dataset: { date: dateOffset(1) } } })
  assert.equal(history.data.visibleRows.length, 1)
  assert.equal(history.data.visibleRows[0].sport, 'rest')
  history.onClearDay()

  // 月切换(上月):按种子公式动态核算
  const now = new Date()
  const prevMonthKey = `${new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear()}-${pad2(new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth() + 1)}`
  history.onMonth({ currentTarget: { dataset: { delta: '-1' } } })
  assert.equal(history.data.month, prevMonthKey)
  const expStrength = seed.sessions.filter((s) => inMonth(s.date, prevMonthKey)).length
  const expActivities = seed.activitySessions.filter((a) => inMonth(a.date, prevMonthKey)).length
  const expRest = seed.dailyStatuses.filter((d) => inMonth(d.date, prevMonthKey)).length
  assert.deepEqual(history.data.counts, {
    training: expStrength + expActivities,
    rest: expRest
  })
  assert.ok(ctx.metrics.historyLoadMs < 10000, `历史装载应 <10s,实际 ${ctx.metrics.historyLoadMs}ms`)
})

live('压力③ 我的页全量备份统计正确并记录耗时', async () => {
  become(ctx.userB)
  const exportStart = Date.now()
  const backup = await ctx.req('GET', '/data/export', { token: ctx.userB.token })
  ctx.metrics.exportMs = Date.now() - exportStart
  ctx.metrics.exportBytes = backup.bytes

  const me = pageInstance(ctx.wxh, 'pages/me/me.js')
  const loadStart = Date.now()
  await loadPageViaShow(me, 'me stress load')
  ctx.metrics.meLoadMs = Date.now() - loadStart
  assert.deepEqual(me.data.stats, {
    sessions: 600, sets: 1800, exercises: 34, volume: 900000, activities: 900
  })
})

live('压力④ 首页在超长数据下的口径(每类上限 100)', async () => {
  become(ctx.userB)
  const home = pageInstance(ctx.wxh, 'pages/home/home.js')
  const start = Date.now()
  home.onLoad()
  await waitUntil(() => !home.data.loading && home.hasLoaded, { what: 'home stress load' })
  ctx.metrics.homeLoadMs = Date.now() - start
  const bySport = Object.fromEntries(home.data.sports.map((s) => [s.id, s.count]))
  assert.deepEqual(bySport, { strength: 100, badminton: 100, swimming: 100, tennis: 100, volleyball: 0 })
  assert.equal(home.data.totalRecords, 400)
  // 当月记录数按种子公式动态核算(首页各类只看最近 100 条)
  const monthKey = dateOffset(0).slice(0, 7)
  const expSessions = seed.sessions.slice(0, 100).filter((s) => inMonth(s.date, monthKey)).length
  const expActivities = [0, 1, 2].reduce((sum, sport) => {
    return sum + seed.activitySessions.filter((a) => a.sport === ['badminton', 'swimming', 'tennis'][sport])
      .slice(0, 100).filter((a) => inMonth(a.date, monthKey)).length
  }, 0)
  assert.equal(home.data.monthRecords, expSessions + expActivities)
  assert.equal(home.data.latestDate, dateOffset(2).slice(5).replace('-', '.'))
})

test('Phase 2B 压力指标汇总', async (t) => {
  if (!ctx.ready) return t.skip('隔离服务器不可用')
  console.log('[Phase2B metrics]', JSON.stringify(ctx.metrics))
})
