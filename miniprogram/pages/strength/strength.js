'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const strength = require('../../services/strength.js')
const { BODY_PARTS, BODY_PART_LABELS, todayStr } = require('../../models/contracts.js')

Page({
  data: {
    active: null,
    recent: [],
    templates: [],
    bodyParts: BODY_PARTS.map((id) => ({
      id,
      name: BODY_PART_LABELS[id],
      selected: false
    })),
    loading: false,
    busy: false,
    dateLabel: ''
  },

  onLoad() {
    const now = new Date()
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    this.setData({ dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}` })
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.load()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const [active, recent, templates] = await Promise.all([
        strength.getActiveSession(),
        strength.getRecentSessions(20),
        data.listTemplates()
      ])
      this.setData({
        active,
        templates: templates.slice(0, 3),
        recent: recent.map((r) => Object.assign({}, r, {
          durationLabel: r.durationSec ? `${r.durationSec} 秒` : ''
        }))
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onTogglePart(e) {
    const id = e.currentTarget.dataset.id
    const key = `bodyParts[${this.data.bodyParts.findIndex((p) => p.id === id)}].selected`
    const next = !this.data.bodyParts.find((p) => p.id === id).selected
    this.setData({ [key]: next })
  },

  selectedParts() {
    return this.data.bodyParts.filter((p) => p.selected).map((p) => p.id)
  },

  async onStart() {
    const parts = this.selectedParts()
    if (!parts.length) {
      wx.showToast({ title: '先选择训练部位', icon: 'none' })
      return
    }
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const session = await strength.startSession(parts)
      wx.navigateTo({ url: `/pages/workout/workout?id=${session.id}` })
    } catch (e) {
      wx.showToast({ title: e.message || '开始失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  onContinue() {
    if (this.data.active) {
      wx.navigateTo({ url: `/pages/workout/workout?id=${this.data.active.id}` })
    }
  },

  async onCopyLast() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const copy = await strength.copyLastCompletedSession()
      if (!copy) {
        wx.showToast({ title: '还没有已完成训练', icon: 'none' })
        return
      }
      wx.navigateTo({ url: `/pages/workout/workout?id=${copy.id}` })
    } catch (e) {
      wx.showToast({ title: e.message || '复制失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onMarkRest() {
    const date = todayStr()
    const res = await wx.showModal({
      title: '记录今天休息',
      content: '休息也是训练计划的一部分。',
      confirmText: '记录'
    })
    if (!res.confirm) return
    try {
      await data.putDailyStatus(date, { status: 'rest' })
      wx.showToast({ title: '已记录休息 🌙', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  onOpenWorkout(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/workout/workout?id=${id}` })
  },

  onOpenTemplates() {
    wx.navigateTo({ url: '/pages/templates/templates' })
  },

  onSport(e) {
    wx.navigateTo({ url: `/pages/activity/activity?sport=${e.currentTarget.dataset.sport}` })
  },

  async onTemplate(e) {
    const template = this.data.templates.find((t) => t.id === e.currentTarget.dataset.id)
    if (!template || this.data.busy) return
    this.setData({ busy: true })
    try {
      const session = await strength.startFromTemplate(template)
      wx.navigateTo({ url: `/pages/workout/workout?id=${session.id}` })
    } catch (err) {
      wx.showToast({ title: err.message || '开始失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  }
})
