'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const ai = require('../../services/ai.js')
const env = require('../../config/env.js')

const SPORT_DEFS = [
  { id: 'strength', label: '力量训练', emoji: '🏋️' },
  { id: 'badminton', label: '羽毛球', emoji: '🏸' },
  { id: 'swimming', label: '游泳', emoji: '🏊' },
  { id: 'tennis', label: '网球', emoji: '🎾' }
]

Page({
  data: {
    user: null,
    apiBase: '',
    loading: false,
    error: '',
    ai: null,
    sports: SPORT_DEFS.map((s) => Object.assign({}, s, { recent: [] }))
  },

  applyUser(user) {
    this.setData({
      user,
      avatarChar: (user.nickname || 'M').slice(0, 1),
      isWechat: user.authProvider === 'wechat'
    })
  },

  onLoad() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ apiBase: env.getApiBase() })
    this.refresh()
  },

  onShow() {
    if (!auth.isLoggedIn()) return
    const user = auth.currentUser()
    if (user) this.applyUser(user)
  },

  async onPullDownRefresh() {
    await this.refresh()
    wx.stopPullDownRefresh()
  },

  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const user = await auth.getMe()
      const [sessions, badminton, swimming, tennis, quotaBody] = await Promise.all([
        data.listSessions({ limit: 5 }),
        data.listActivities({ sport: 'badminton', limit: 5 }),
        data.listActivities({ sport: 'swimming', limit: 5 }),
        data.listActivities({ sport: 'tennis', limit: 5 }),
        ai.quota()
      ])
      const bySport = { strength: sessions, badminton, swimming, tennis }
      const sports = SPORT_DEFS.map((s) =>
        Object.assign({}, s, {
          recent: (bySport[s.id] || []).map((r) => ({
            id: r.id,
            date: r.date,
            summary: s.id === 'strength' ? r.title || (r.bodyParts || []).join(' + ') : (r.venue || r.notes || s.label)
          }))
        })
      )
      this.applyUser(user)
      this.setData({ sports, ai: quotaBody })
    } catch (e) {
      this.setData({ error: e.message || '加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onOpenSandbox() {
    wx.navigateTo({ url: '/pages/sandbox/sandbox' })
  },

  async onLogout() {
    await auth.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
