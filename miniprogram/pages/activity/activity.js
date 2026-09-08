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
  { value: '', label: '不限' },
  { value: 'freestyle', label: '自由泳' },
  { value: 'breaststroke', label: '蛙泳' },
  { value: 'backstroke', label: '仰泳' },
  { value: 'butterfly', label: '蝶泳' },
  { value: 'medley', label: '混合泳' },
  { value: 'other', label: '其他' }
]

const SURFACES = [
  { value: '', label: '不限' },
  { value: 'hard', label: '硬地' },
  { value: 'clay', label: '红土' },
  { value: 'grass', label: '草地' },
  { value: 'other', label: '其他' }
]

const NATURES = [
  { value: '', label: '不限' },
  { value: 'training', label: '训练' },
  { value: 'official', label: '正式比赛' },
  { value: 'friendly', label: '友谊赛' },
  { value: 'practice', label: '练习赛' },
  { value: 'serving', label: '发球训练' },
  { value: 'multiball', label: '多球训练' },
  { value: 'other', label: '其他' }
]

const TRAINING_TYPES = ['发球', '正手', '反手', '截击', '高压球', '接发', '底线', '多球', '移动', '综合训练']
const RPE_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

function blankTechnique() {
  return { firstServeIn: '', firstServePoints: '', doubleFaults: '', aces: '', serveGames: '', servePointsWon: '', returnPointsWon: '', breakPoints: '', breakConverted: '', netPointsWon: '', winners: '', unforcedErrors: '' }
}

function blankFitness() { return { runMinutes: '', runDistanceM: '', avgHr: '', maxHr: '' } }

function timeText(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function emptyForm(sport) {
  return {
    sport,
    date: todayStr(),
    startTimeText: '',
    durationMin: '',
    venue: '',
    notes: '',
    rpe: '',
    playType: 'singles',
    partners: '',
    isMatch: false,
    gamesWon: '',
    gamesLost: '',
    gamesTotal: '',
    pointsTotal: '',
    scoreText: '',
    distanceM: '',
    distanceUnit: 'm',
    stroke: '',
    poolLengthM: '',
    laps: '',
    calories: '',
    indoor: '',
    surface: '',
    nature: ''
    ,sets: []
    ,trainingTypes: []
    ,trainingFocus: ''
    ,technique: blankTechnique()
    ,fitness: blankFitness()
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

function cleanNumberObject(input) {
  const out = {}
  Object.keys(input || {}).forEach((key) => {
    const value = numberOrUndefined(input[key])
    if (value !== undefined) out[key] = value
  })
  return Object.keys(out).length ? out : undefined
}

function paceLabel(form) {
  const distance = Number(form.distanceM)
  const minutes = Number(form.durationMin)
  if (!(distance > 0) || !(minutes > 0)) return '填写时长与距离后自动算出'
  const meters = form.distanceUnit === 'mi' ? distance * 1609.344 : distance
  const secondsPer100 = minutes * 60 / meters * 100
  const min = Math.floor(secondsPer100 / 60)
  const sec = Math.round(secondsPer100 % 60)
  return `${min}:${String(sec).padStart(2, '0')} / 100m`
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
    natures: NATURES,
    natureIndex: 0,
    trainingTypeOptions: TRAINING_TYPES.map((label) => ({ label, selected: false })),
    rpeOptions: RPE_OPTIONS,
    paceLabel: '填写时长与距离后自动算出',
    loading: false,
    busy: false
  },

  onLoad(options) {
    const sport = SPORT_META[options.sport] ? options.sport : 'badminton'
    this.setData({ sport, meta: SPORT_META[sport], form: emptyForm(sport) })
    this.pendingId = options.id || ''
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
      if (this.pendingId) {
        const id = this.pendingId
        this.pendingId = ''
        await this.openEdit(id)
      }
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onCreate() {
    this.setData({ formOpen: true, editingId: '', form: emptyForm(this.data.sport), strokeIndex: 0, surfaceIndex: 0, natureIndex: 0, trainingTypeOptions: TRAINING_TYPES.map((label) => ({ label, selected: false })), paceLabel: '填写时长与距离后自动算出' })
  },

  onCloseForm() {
    if (!this.data.busy) this.setData({ formOpen: false, editingId: '' })
  },

  onField(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
    if (field === 'distanceM' || field === 'durationMin') this.setData({ paceLabel: paceLabel(this.data.form) })
    if (this.data.sport === 'badminton' && (field === 'gamesWon' || field === 'gamesLost')) {
      const won = Number(this.data.form.gamesWon)
      const lost = Number(this.data.form.gamesLost)
      if (Number.isFinite(won) && Number.isFinite(lost)) this.setData({ 'form.gamesTotal': String(won + lost) })
    }
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value })
  },

  onTimeChange(e) { this.setData({ 'form.startTimeText': e.detail.value }) },

  onSelect(e) {
    const field = e.currentTarget.dataset.field
    const value = field === 'isMatch' ? Boolean(e.currentTarget.dataset.value) : e.currentTarget.dataset.value
    this.setData({ [`form.${field}`]: value })
  },

  onRpe(e) { this.setData({ 'form.rpe': Number(e.currentTarget.dataset.value) }) },
  onDistanceUnit(e) { this.setData({ 'form.distanceUnit': e.currentTarget.dataset.value }); this.setData({ paceLabel: paceLabel(this.data.form) }) },

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

  onNatureChange(e) {
    const index = Number(e.detail.value)
    this.setData({ natureIndex: index, 'form.nature': NATURES[index].value })
  },

  onTrainingType(e) {
    const label = e.currentTarget.dataset.label
    const list = this.data.form.trainingTypes.slice()
    const index = list.indexOf(label)
    if (index >= 0) list.splice(index, 1)
    else list.push(label)
    this.setData({
      'form.trainingTypes': list,
      trainingTypeOptions: TRAINING_TYPES.map((x) => ({ label: x, selected: list.includes(x) }))
    })
  },

  onNestedField(e) {
    const group = e.currentTarget.dataset.group
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${group}.${field}`]: e.detail.value })
  },

  onAddTennisSet() {
    this.setData({ 'form.sets': this.data.form.sets.concat([{ a: '', b: '' }]) })
  },

  onRemoveTennisSet(e) {
    const sets = this.data.form.sets.slice()
    sets.splice(Number(e.currentTarget.dataset.index), 1)
    const complete = sets.filter((set) => set.a !== '' && set.b !== '')
    this.setData({
      'form.sets': sets,
      'form.gamesTotal': String(sets.filter((set) => set.a !== '' || set.b !== '').length),
      'form.gamesWon': String(complete.filter((set) => Number(set.a) > Number(set.b)).length),
      'form.gamesLost': String(complete.filter((set) => Number(set.a) < Number(set.b)).length),
      'form.scoreText': complete.map((set) => `${set.a}-${set.b}`).join(' ')
    })
  },

  onTennisSetField(e) {
    const index = Number(e.currentTarget.dataset.index)
    const side = e.currentTarget.dataset.side
    const sets = this.data.form.sets.map((set, i) => i === index ? Object.assign({}, set, { [side]: e.detail.value }) : set)
    const filled = sets.filter((set) => set.a !== '' || set.b !== '')
    const complete = filled.filter((set) => set.a !== '' && set.b !== '')
    const won = complete.filter((set) => Number(set.a) > Number(set.b)).length
    const lost = complete.filter((set) => Number(set.a) < Number(set.b)).length
    this.setData({
      'form.sets': sets,
      'form.gamesTotal': String(filled.length),
      'form.gamesWon': String(won),
      'form.gamesLost': String(lost),
      'form.scoreText': complete.map((set) => `${set.a}-${set.b}`).join(' ')
    })
  },

  async onEdit(e) {
    return this.openEdit(e.currentTarget.dataset.id)
  },

  async openEdit(id) {
    try {
      const item = await data.getActivity(id)
      const score = item.score || {}
      const strokeIndex = Math.max(0, STROKES.findIndex((x) => x.value === item.stroke))
      const surfaceIndex = Math.max(0, SURFACES.findIndex((x) => x.value === item.surface))
      const natureIndex = Math.max(0, NATURES.findIndex((x) => x.value === item.nature))
      const displayDistance = item.distanceUnit === 'mi' && item.distanceM ? Math.round(item.distanceM / 1609.344 * 100) / 100 : (item.distanceM ?? '')
      const form = Object.assign(emptyForm(this.data.sport), item, {
        startTimeText: timeText(item.startTime),
        durationMin: item.durationMin ?? '',
        venue: item.venue || '',
        notes: item.notes || '',
        rpe: item.rpe ?? '',
        partners: item.partners || '',
        isMatch: !!item.isMatch,
        gamesWon: score.gamesWon ?? '',
        gamesLost: score.gamesLost ?? '',
        gamesTotal: score.gamesTotal ?? '',
        pointsTotal: score.pointsTotal ?? '',
        scoreText: item.scoreText || '',
        distanceM: displayDistance,
        distanceUnit: item.distanceUnit || 'm',
        poolLengthM: item.poolLengthM ?? '',
        laps: item.laps ?? '',
        calories: item.calories ?? '',
        sets: (item.sets || []).map((s) => ({ a: s.a ?? '', b: s.b ?? '' })),
        trainingTypes: item.trainingTypes || [],
        trainingFocus: item.trainingFocus || '',
        technique: Object.assign(blankTechnique(), item.technique || {}),
        fitness: Object.assign(blankFitness(), item.fitness || {})
      })
      this.setData({
        formOpen: true,
        editingId: item.id,
        strokeIndex,
        surfaceIndex,
        natureIndex,
        form,
        paceLabel: paceLabel(form),
        trainingTypeOptions: TRAINING_TYPES.map((label) => ({ label, selected: form.trainingTypes.includes(label) }))
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
      startTime: f.startTimeText ? new Date(`${f.date.replace(/-/g, '/')} ${f.startTimeText}:00`).getTime() : undefined,
      durationMin: numberOrUndefined(f.durationMin),
      venue: f.venue.trim() || undefined,
      notes: f.notes.trim() || undefined,
      rpe: numberOrUndefined(f.rpe)
    }
    if (this.data.sport === 'swimming') {
      const distance = numberOrUndefined(f.distanceM)
      Object.assign(payload, {
        distanceM: distance === undefined ? undefined : (f.distanceUnit === 'mi' ? distance * 1609.344 : distance),
        distanceUnit: f.distanceUnit || 'm',
        stroke: f.stroke || undefined,
        poolLengthM: numberOrUndefined(f.poolLengthM),
        laps: numberOrUndefined(f.laps),
        calories: numberOrUndefined(f.calories)
      })
    } else {
      const won = numberOrUndefined(f.gamesWon)
      const lost = numberOrUndefined(f.gamesLost)
      const total = numberOrUndefined(f.gamesTotal)
      Object.assign(payload, {
        playType: f.playType,
        partners: f.partners.trim() || undefined,
        isMatch: f.isMatch ? 1 : undefined,
        score: {
          gamesWon: won,
          gamesLost: lost,
          gamesTotal: total === undefined ? (won === undefined && lost === undefined ? undefined : (won || 0) + (lost || 0)) : total,
          pointsTotal: numberOrUndefined(f.pointsTotal)
        }
      })
      if (this.data.sport === 'tennis') {
        Object.assign(payload, {
          scoreText: f.scoreText.trim() || undefined,
          indoor: f.indoor || undefined,
          surface: f.surface || undefined,
          nature: f.nature || undefined
          ,sets: f.sets.map((s) => ({ a: numberOrUndefined(s.a), b: numberOrUndefined(s.b) })).filter((s) => s.a !== undefined || s.b !== undefined)
          ,trainingTypes: f.trainingTypes.length ? f.trainingTypes : undefined
          ,trainingFocus: f.trainingFocus.trim() || undefined
          ,technique: cleanNumberObject(f.technique)
          ,fitness: cleanNumberObject(f.fitness)
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
    const rpe = numberOrUndefined(this.data.form.rpe)
    if (rpe !== undefined && (rpe < 1 || rpe > 10)) {
      wx.showToast({ title: '主观强度必须是 1-10', icon: 'none' })
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
