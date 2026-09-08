'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const ai = require('../../services/ai.js')
const env = require('../../config/env.js')

const SPORT_DEFS = [
  { id: 'strength', label: '力量训练', emoji: '🏋️', short: '力量', tone: 'lime' },
  { id: 'badminton', label: '羽毛球', emoji: '🏸', short: '羽球', tone: 'coral' },
  { id: 'swimming', label: '游泳', emoji: '🏊', short: '游泳', tone: 'cyan' },
  { id: 'tennis', label: '网球', emoji: '🎾', short: '网球', tone: 'yellow' }
]

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pageMeta() {
  const now = new Date()
  const hour = now.getHours()
  return {
    greeting: hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好',
    dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`,
    monthPrefix: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
}

Page({
  data: {
    user: null,
    apiBase: '',
    loading: false,
    error: '',
    ai: null,
    greeting: '',
    dateLabel: '',
    monthRecords: 0,
    totalRecords: 0,
    latestDate: '--',
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
    const meta = pageMeta()
    this.setData({ apiBase: env.getApiBase(), greeting: meta.greeting, dateLabel: meta.dateLabel })
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
        data.listSessions({ limit: 100 }),
        data.listActivities({ sport: 'badminton', limit: 100 }),
        data.listActivities({ sport: 'swimming', limit: 100 }),
        data.listActivities({ sport: 'tennis', limit: 100 }),
        ai.quota()
      ])
      const bySport = { strength: sessions, badminton, swimming, tennis }
      const sports = SPORT_DEFS.map((s) =>
        Object.assign({}, s, {
          count: (bySport[s.id] || []).length,
          recent: (bySport[s.id] || []).slice(0, 2).map((r) => ({
            id: r.id,
            date: r.date,
            summary: s.id === 'strength' ? r.title || (r.bodyParts || []).join(' + ') : (r.venue || r.notes || s.label)
          }))
        })
      )
      const allRecords = [].concat(sessions, badminton, swimming, tennis)
      const meta = pageMeta()
      const latest = allRecords.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
      this.applyUser(user)
      this.setData({
        sports,
        ai: quotaBody,
        greeting: meta.greeting,
        dateLabel: meta.dateLabel,
        totalRecords: allRecords.length,
        monthRecords: allRecords.filter((r) => String(r.date || '').startsWith(meta.monthPrefix)).length,
        latestDate: latest ? latest.date.slice(5).replace('-', '.') : '--'
      })
    } catch (e) {
      this.setData({ error: e.message || '加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onOpenSandbox() {
    wx.navigateTo({ url: '/pages/sandbox/sandbox' })
  },

  onOpenStrength() {
    wx.navigateTo({ url: '/pages/strength/strength' })
  },

  onSportTap(e) {
    const sport = e.currentTarget.dataset.sport
    if (sport === 'strength') {
      this.onOpenStrength()
      return
    }
    if (SPORT_DEFS.some((item) => item.id === sport)) {
      wx.navigateTo({ url: `/pages/activity/activity?sport=${sport}` })
    }
  },

  async onLogout() {
    await auth.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
