'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { todayStr } = require('../../models/contracts.js')

const SPORT_META = {
  badminton: { label: '羽毛球', icon: '🏸', kicker: 'BADMINTON', tone: 'coral' },
  swimming: { label: '游泳', icon: '🏊', kicker: 'SWIMMING', tone: 'cyan' },
  tennis: { label: '网球', icon: '🎾', kicker: 'TENNIS', tone: 'yellow' }
}

const STROKES = [
  { value: 'freestyle', label: '自由泳' },
  { value: 'breaststroke', label: '蛙泳' },
  { value: 'backstroke', label: '仰泳' },
  { value: 'butterfly', label: '蝶泳' },
  { value: 'medley', label: '混合泳' },
  { value: 'other', label: '其他' }
]

const SURFACES = [
  { value: 'hard', label: '硬地' },
  { value: 'clay', label: '红土' },
  { value: 'grass', label: '草地' },
  { value: 'other', label: '其他' }
]

function emptyForm(sport) {
  return {
    sport,
    date: todayStr(),
    durationMin: '',
    venue: '',
    notes: '',
    rpe: '',
    playType: 'singles',
    partners: '',
    isMatch: false,
    gamesWon: '',
    gamesLost: '',
    scoreText: '',
    distanceM: '',
    stroke: '',
    poolLengthM: '',
    laps: '',
    calories: '',
    indoor: '',
    surface: '',
    nature: ''
  }
}

function numberOrUndefined(value) {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function summary(item, sport) {
  if (sport === 'swimming') {
    const bits = []
    if (item.distanceM) bits.push(`${item.distanceM} 米`)
    if (item.durationMin) bits.push(`${item.durationMin} 分钟`)
    return bits.join(' · ') || item.venue || '游泳记录'
  }
  const score = item.score || {}
  if (score.gamesWon !== undefined || score.gamesLost !== undefined) {
    return `${score.gamesWon || 0} 胜 · ${score.gamesLost || 0} 负`
  }
  return item.durationMin ? `${item.durationMin} 分钟` : item.venue || SPORT_META[sport].label
}

Page({
  data: {
    sport: 'badminton',
    meta: SPORT_META.badminton,
    records: [],
    formOpen: false,
    editingId: '',
    form: emptyForm('badminton'),
    strokes: STROKES,
    strokeIndex: 0,
    surfaces: SURFACES,
    surfaceIndex: 0,
    loading: false,
    busy: false
  },

  onLoad(options) {
    const sport = SPORT_META[options.sport] ? options.sport : 'badminton'
    this.setData({ sport, meta: SPORT_META[sport], form: emptyForm(sport) })
    wx.setNavigationBarTitle({ title: SPORT_META[sport].label })
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
      const rows = await data.listActivities({ sport: this.data.sport, limit: 100 })
      this.setData({
        records: rows.map((item) => Object.assign({}, item, { summary: summary(item, this.data.sport) }))
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onCreate() {
    this.setData({ formOpen: true, editingId: '', form: emptyForm(this.data.sport), strokeIndex: 0, surfaceIndex: 0 })
  },

  onCloseForm() {
    if (!this.data.busy) this.setData({ formOpen: false, editingId: '' })
  },

  onField(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },

  onSelect(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.currentTarget.dataset.value })
  },

  onMatchChange(e) {
    this.setData({ 'form.isMatch': e.detail.value })
  },

  onStrokeChange(e) {
    const index = Number(e.detail.value)
    this.setData({ strokeIndex: index, 'form.stroke': STROKES[index].value })
  },

  onSurfaceChange(e) {
    const index = Number(e.detail.value)
    this.setData({ surfaceIndex: index, 'form.surface': SURFACES[index].value })
  },

  async onEdit(e) {
    try {
      const item = await data.getActivity(e.currentTarget.dataset.id)
      const score = item.score || {}
      const strokeIndex = Math.max(0, STROKES.findIndex((x) => x.value === item.stroke))
      const surfaceIndex = Math.max(0, SURFACES.findIndex((x) => x.value === item.surface))
      this.setData({
        formOpen: true,
        editingId: item.id,
        strokeIndex,
        surfaceIndex,
        form: Object.assign(emptyForm(this.data.sport), item, {
          durationMin: item.durationMin ?? '',
          venue: item.venue || '',
          notes: item.notes || '',
          rpe: item.rpe ?? '',
          partners: item.partners || '',
          isMatch: !!item.isMatch,
          gamesWon: score.gamesWon ?? '',
          gamesLost: score.gamesLost ?? '',
          scoreText: item.scoreText || '',
          distanceM: item.distanceM ?? '',
          poolLengthM: item.poolLengthM ?? '',
          laps: item.laps ?? '',
          calories: item.calories ?? ''
        })
      })
    } catch (err) {
      wx.showToast({ title: err.message || '读取失败', icon: 'none' })
    }
  },

  payload() {
    const f = this.data.form
    const payload = {
      sport: this.data.sport,
      date: f.date,
      durationMin: numberOrUndefined(f.durationMin),
      venue: f.venue.trim() || undefined,
      notes: f.notes.trim() || undefined,
      rpe: numberOrUndefined(f.rpe)
    }
    if (this.data.sport === 'swimming') {
      Object.assign(payload, {
        distanceM: numberOrUndefined(f.distanceM),
        distanceUnit: 'm',
        stroke: f.stroke || undefined,
        poolLengthM: numberOrUndefined(f.poolLengthM),
        laps: numberOrUndefined(f.laps),
        calories: numberOrUndefined(f.calories)
      })
    } else {
      const won = numberOrUndefined(f.gamesWon)
      const lost = numberOrUndefined(f.gamesLost)
      Object.assign(payload, {
        playType: f.playType,
        partners: f.partners.trim() || undefined,
        isMatch: f.isMatch ? 1 : undefined,
        score: {
          gamesWon: won,
          gamesLost: lost,
          gamesTotal: won === undefined && lost === undefined ? undefined : (won || 0) + (lost || 0)
        }
      })
      if (this.data.sport === 'tennis') {
        Object.assign(payload, {
          scoreText: f.scoreText.trim() || undefined,
          indoor: f.indoor || undefined,
          surface: f.surface || undefined,
          nature: f.nature || undefined
        })
      }
    }
    return payload
  },

  async onSave() {
    if (this.data.busy) return
    if (!this.data.form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const payload = this.payload()
      const wasEditing = !!this.data.editingId
      if (wasEditing) await data.patchActivity(this.data.editingId, payload)
      else await data.createActivity(payload)
      this.setData({ formOpen: false, editingId: '' })
      wx.showToast({ title: wasEditing ? '已更新' : '已记录', icon: 'success' })
      await this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onDelete(e) {
    const result = await wx.showModal({ title: '删除这条记录？', content: '删除后无法恢复。', confirmText: '删除', confirmColor: '#b44747' })
    if (!result.confirm) return
    try {
      await data.deleteActivity(e.currentTarget.dataset.id)
      wx.showToast({ title: '已删除', icon: 'success' })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  },

  noop() {}
})
