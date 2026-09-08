'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { todayStr } = require('../../models/contracts.js')
const { newClientId } = require('../../utils/id.js')

Page({
  data: {
    running: false,
    passed: false,
    logs: []
  },

  onLoad() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.log('登录态有效。可点击下方按钮执行完整链路。')
  },

  log(text) {
    const logs = this.data.logs.concat({
      id: newClientId('log'),
      text: String(text)
    })
    this.setData({ logs })
  },

  async onRunCrud() {
    if (this.data.running) return
    this.setData({ running: true, passed: false, logs: [] })
    const createdId = newClientId('crud-session')
    const now = Date.now()
    const date = todayStr()
    try {
      this.log('1/8 获取当前用户(auth/me)')
      const user = await auth.getMe()
      this.log(`✅ 用户:${user.nickname} (${user.authProvider}) id=${user.id}`)

      this.log('2/8 读取动作库(默认动作应由服务端播种)')
      const exercises = await data.listExercises()
      if (!exercises || exercises.length === 0) throw new Error('动作库为空')
      const exercise = exercises.find((e) => !e.isCustom) || exercises[0]
      this.log(`✅ 动作库 ${exercises.length} 个,使用:${exercise.name}`)

      this.log('3/8 创建力量训练记录(POST /sessions)')
      const session = await data.createSession({
        id: createdId,
        date,
        status: 'completed',
        bodyParts: ['chest'],
        title: '小程序 CRUD 自检',
        notes: '自动创建',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        isDemo: 1
      })
      this.log(`✅ 已创建 session ${session.id}`)

      this.log('4/8 添加训练动作(POST /sessions/:id/exercises)')
      const workoutExercise = await data.addWorkoutExercise(session.id, {
        exerciseId: exercise.id,
        order: 0,
        createdAt: now
      })
      this.log(`✅ 已添加动作 ${workoutExercise.id}`)

      this.log('5/8 添加一组记录(POST /sessions/:id/sets)')
      const set = await data.addSet(session.id, {
        workoutExerciseId: workoutExercise.id,
        weight: 60,
        reps: 10,
        weightType: 'weight',
        date,
        createdAt: now
      })
      this.log(`✅ 已添加组 set ${set.id}`)

      this.log('6/8 读取详情并核对(GET /sessions/:id)')
      const detail = await data.getSession(session.id)
      const loadedSet = detail.workoutExercises[0] && detail.workoutExercises[0].sets[0]
      if (!loadedSet || loadedSet.reps !== 10) throw new Error('读取到的小程序 CRUD 数据不正确')
      this.log('✅ 服务端读回数据与写入一致')

      this.log('7/8 修改训练(PATCH /sessions/:id)')
      const patched = await data.patchSession(session.id, { notes: '小程序修改成功', updatedAt: Date.now() })
      if (patched.notes !== '小程序修改成功') throw new Error('修改未生效')
      this.log(`✅ notes=${patched.notes}`)

      this.log('8/8 删除自检数据(DELETE /sessions/:id)')
      await data.deleteSession(session.id)
      let gone = false
      try {
        await data.getSession(session.id)
      } catch (e) {
        gone = e.code === 'NOT_FOUND'
      }
      if (!gone) throw new Error('删除后记录仍然存在')
      this.log('✅ 删除成功,复查返回 NOT_FOUND')
      this.log('CRUD 链路 PASS:创建 → 读回 → 修改 → 删除 全部成功')
      this.setData({ passed: true })
    } catch (e) {
      this.log(`✗ 链路中断:${e.message || e}`)
      this.log('只创建了本次自检会话;若中断在删除前,可回到首页在最近力量记录中手动删除。')
      wx.showModal({
        title: '自检未通过',
        content: e.message || '请查看下方日志',
        showCancel: false
      })
    } finally {
      this.setData({ running: false })
    }
  }
})
