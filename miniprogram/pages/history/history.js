'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'strength', label: '力量' },
  { id: 'badminton', label: '羽毛球' },
  { id: 'swimming', label: '游泳' },
  { id: 'tennis', label: '网球' }
]

const SPORT = {
  strength: { icon: '🏋️', name: '力量训练', tone: 'lime' },
  badminton: { icon: '🏸', name: '羽毛球', tone: 'coral' },
  swimming: { icon: '🏊', name: '游泳', tone: 'cyan' },
  tennis: { icon: '🎾', name: '网球', tone: 'yellow' },
  rest: { icon: '月', name: '休息', tone: 'rest' }
}

function pad2(n) { return String(n).padStart(2, '0') }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` }
function weekday(date) { return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T12:00:00`).getDay()] }
function displayDate(date) { const p = date.split('-'); return `${Number(p[1])}月${Number(p[2])}日` }

function describeActivity(a) {
  if (a.sport === 'swimming') {
    const bits = []
    if (a.distanceM) bits.push(`${Math.round(a.distanceM)} 米`)
    if (a.durationMin) bits.push(`${a.durationMin} 分钟`)
    return bits.join(' · ') || a.venue || '游泳记录'
  }
  const score = a.score || {}
  const unit = a.sport === 'tennis' ? '盘' : '局'
  if (score.gamesWon !== undefined || score.gamesLost !== undefined) return `${score.gamesWon || 0} 胜 · ${score.gamesLost || 0} 负${unit}`
  return a.durationMin ? `${a.durationMin} 分钟` : (a.venue || SPORT[a.sport].name)
}

function buildCalendar(month, rows, selectedDate) {
  const parts = month.split('-').map(Number)
  const year = parts[0]
  const monthIndex = parts[1] - 1
  const first = new Date(year, monthIndex, 1)
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const rowMap = new Map()
  rows.forEach((r) => {
    if (!rowMap.has(r.date)) rowMap.set(r.date, [])
    rowMap.get(r.date).push(r)
  })
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push({ key: `blank-${i}`, blank: true })
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${pad2(day)}`
    const dayRows = rowMap.get(date) || []
    cells.push({
      key: date,
      date,
      day,
      selected: date === selectedDate,
      strength: dayRows.some((r) => r.sport === 'strength'),
      activity: dayRows.some((r) => r.sport !== 'strength' && r.sport !== 'rest'),
      rest: dayRows.some((r) => r.sport === 'rest')
    })
  }
  return cells
}

Page({
  data: {
    mode: 'calendar',
    filter: 'all',
    filters: FILTERS,
    rows: [],
    visibleRows: [],
    calendar: [],
    month: monthKey(new Date()),
    monthLabel: '',
    selectedDate: '',
    loading: false,
    counts: { training: 0, rest: 0 }
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const [sessions, activities, statuses] = await Promise.all([
        data.listSessions({ limit: 500 }),
        data.listActivities({ limit: 1000 }),
        data.listDailyStatuses()
      ])
      const rows = []
      sessions.filter((s) => s.status === 'completed').forEach((s) => rows.push({
        id: s.id, date: s.date, sport: 'strength', icon: SPORT.strength.icon, tone: 'lime',
        title: s.title || '力量训练', detail: s.durationSec ? `${Math.max(1, Math.round(s.durationSec / 60))} 分钟` : '已完成',
        sortTs: s.completedAt || s.startedAt || 0
      }))
      activities.forEach((a) => rows.push({
        id: a.id, date: a.date, sport: a.sport, icon: SPORT[a.sport].icon, tone: SPORT[a.sport].tone,
        title: SPORT[a.sport].name, detail: describeActivity(a), sortTs: a.startTime || a.createdAt || 0
      }))
      statuses.filter((s) => s.status === 'rest').forEach((s) => rows.push({
        id: s.date, date: s.date, sport: 'rest', icon: SPORT.rest.icon, tone: 'rest', title: '休息日', detail: s.note || '恢复也是训练的一部分', sortTs: 0
      }))
      rows.sort((a, b) => a.date === b.date ? b.sortTs - a.sortTs : b.date.localeCompare(a.date))
      this.allRows = rows
      this.refreshView(rows)
    } catch (e) {
      wx.showToast({ title: e.message || '加载历史失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  refreshView(source) {
    const rows = source || this.allRows || []
    const filtered = this.data.filter === 'all' ? rows : rows.filter((r) => r.sport === this.data.filter)
    const monthRows = filtered.filter((r) => r.date.startsWith(this.data.month))
    const visibleRows = this.data.selectedDate ? filtered.filter((r) => r.date === this.data.selectedDate) : filtered
    const p = this.data.month.split('-')
    this.setData({
      rows: filtered,
      visibleRows,
      calendar: buildCalendar(this.data.month, monthRows, this.data.selectedDate),
      monthLabel: `${p[0]}年${Number(p[1])}月`,
      counts: {
        training: monthRows.filter((r) => r.sport !== 'rest').length,
        rest: monthRows.filter((r) => r.sport === 'rest').length
      }
    })
  },

  onMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }) },
  onFilter(e) { this.setData({ filter: e.currentTarget.dataset.id, selectedDate: '' }); this.refreshView() },
  onSelectDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    this.setData({ selectedDate: this.data.selectedDate === date ? '' : date })
    this.refreshView()
  },
  onClearDay() { this.setData({ selectedDate: '' }); this.refreshView() },
  onMonth(e) {
    const p = this.data.month.split('-').map(Number)
    const next = new Date(p[0], p[1] - 1 + Number(e.currentTarget.dataset.delta), 1)
    this.setData({ month: monthKey(next), selectedDate: '' })
    this.refreshView()
  },
  onOpen(e) {
    const row = (this.allRows || []).find((r) => r.id === e.currentTarget.dataset.id && r.sport === e.currentTarget.dataset.sport)
    if (!row || row.sport === 'rest') return
    if (row.sport === 'strength') wx.navigateTo({ url: `/pages/workout/workout?id=${row.id}` })
    else wx.navigateTo({ url: `/pages/activity/activity?sport=${row.sport}&id=${row.id}` })
  }
})
