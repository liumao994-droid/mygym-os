'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { todayStr } = require('../../models/contracts.js')

const SPORT_META = {
  badminton: { label: '羽毛球', icon: '🏸', kicker: 'BADMINTON', tone: 'coral' },
  swimming: { label: '游泳', icon: '🏊', kicker: 'SWIMMING', tone: 'cyan' },
  tennis: { label: '网球', icon: '🎾', kicker: 'TENNIS', tone: 'yellow' },
  volleyball: { label: '排球', icon: '🏐', kicker: 'VOLLEYBALL', tone: 'clay' }
}

const VB_SESSION_TYPES = [
  { value: 'training', label: '日常训练' },
  { value: 'casual', label: '自由打球' },
  { value: 'scrimmage', label: '对抗赛' },
  { value: 'official', label: '正式比赛' }
]

const VB_POSITIONS = [
  { value: '', label: '不限' },
  { value: 'oh', label: '主攻 OH' },
  { value: 'mb', label: '副攻 MB' },
  { value: 'opp', label: '接应 OPP' },
  { value: 'setter', label: '二传 S' },
  { value: 'libero', label: '自由人 L' },
  { value: 'none', label: '无固定位置' },
  { value: 'other', label: '其他' }
]

const VB_STAT_GROUPS = [
  { key: 'serve', label: '发球', fields: [{ key: 'attempts', label: '发球次数' }, { key: 'aces', label: 'ACE' }, { key: 'errors', label: '发球失误' }] },
  { key: 'attack', label: '进攻', fields: [{ key: 'attempts', label: '进攻次数' }, { key: 'points', label: '进攻得分' }, { key: 'errors', label: '进攻失误' }, { key: 'blocked', label: '被拦' }] },
  { key: 'block', label: '拦网', fields: [{ key: 'points', label: '拦网得分' }, { key: 'effective', label: '有效拦网' }] },
  { key: 'reception', label: '一传', fields: [{ key: 'attempts', label: '一传次数' }, { key: 'perfect', label: '一传到位' }, { key: 'errors', label: '一传失误' }] },
  { key: 'dig', label: '防守', fields: [{ key: 'attempts', label: '防守次数' }, { key: 'successful', label: '有效防守' }] },
  { key: 'set', label: '二传', fields: [{ key: 'attempts', label: '二传次数' }, { key: 'successful', label: '有效二传' }] }
]

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

function blankVolleyballStats() {
  return { serve: {}, attack: {}, block: {}, reception: {}, dig: {}, set: {} }
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
    ,vbSessionType: 'training'
    ,vbPosition: ''
    ,vbSets: []
    ,vbStats: blankVolleyballStats()
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
  if (sport === 'volleyball') {
    const sets = Array.isArray(item.volleyballSets) ? item.volleyballSets : []
    const won = sets.filter((s) => Number(s.ourScore) > Number(s.opponentScore)).length
    const lost = sets.filter((s) => Number(s.ourScore) < Number(s.opponentScore)).length
    if (sets.length) return `${won} 胜 · ${lost} 负局`
    if (item.durationMin) return `${item.durationMin} 分钟`
    return item.venue || SPORT_META[sport].label
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

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function numberError(value, label, options) {
  if (value === '' || value === null || value === undefined) return ''
  const number = Number(value)
  const opts = options || {}
  if (!Number.isFinite(number)) return `${label}必须是数字`
  if (opts.integer && !Number.isInteger(number)) return `${label}必须是整数`
  if (number < (opts.min === undefined ? 0 : opts.min) || number > (opts.max || 10000000)) return `${label}超出允许范围`
  return ''
}

function validateForm(form, sport) {
  if (!validCalendarDate(form.date)) return '请选择有效日期'
  let error = numberError(form.durationMin, '时长', { min: Number.EPSILON, max: 10080 })
  if (error) return error
  if (sport === 'swimming') {
    const rules = [
      [form.distanceM, '距离', { min: Number.EPSILON }],
      [form.poolLengthM, '泳池长度', { min: Number.EPSILON, max: 10000 }],
      [form.laps, '趟数', { min: 1, max: 1000000, integer: true }],
      [form.calories, '卡路里', { min: Number.EPSILON }]
    ]
    for (const rule of rules) { error = numberError(...rule); if (error) return error }
  } else {
    for (const [value, label] of [[form.gamesWon, '胜场'], [form.gamesLost, '负场'], [form.gamesTotal, '总场数'], [form.pointsTotal, '总得分']]) {
      error = numberError(value, label, { min: 0, max: 1000000, integer: true })
      if (error) return error
    }
  }
  if (sport === 'tennis') {
    for (const set of form.sets) {
      for (const value of [set.a, set.b]) {
        error = numberError(value, '逐盘比分', { min: 0, max: 99, integer: true })
        if (error) return error
      }
    }
    for (const value of Object.values(form.technique || {})) {
      error = numberError(value, '技术统计', { min: 0, max: 10000000, integer: true })
      if (error) return error
    }
    const fitnessRules = [
      [form.fitness.runMinutes, '跑动时间', { min: Number.EPSILON, max: 10080 }],
      [form.fitness.runDistanceM, '跑动距离', { min: Number.EPSILON }],
      [form.fitness.avgHr, '平均心率', { min: 1, max: 300, integer: true }],
      [form.fitness.maxHr, '最大心率', { min: 1, max: 300, integer: true }]
    ]
    for (const rule of fitnessRules) { error = numberError(...rule); if (error) return error }
  }
  if (sport === 'volleyball') {
    for (const set of form.vbSets) {
      for (const value of [set.our, set.their]) {
        error = numberError(value, '逐局比分', { min: 0, max: 999, integer: true })
        if (error) return error
      }
    }
    for (const group of Object.values(form.vbStats || {})) {
      for (const value of Object.values(group)) {
        error = numberError(value, '技术统计', { min: 0, max: 1000000, integer: true })
        if (error) return error
      }
    }
  }
  return ''
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
    vbSessionTypes: VB_SESSION_TYPES,
    vbSessionTypeIndex: 0,
    vbPositions: VB_POSITIONS,
    vbPositionIndex: 0,
    vbStatGroups: VB_STAT_GROUPS,
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
    const value = e.detail.value
    const patch = { [`form.${field}`]: value }
    const nextForm = Object.assign({}, this.data.form, { [field]: value })
    if (field === 'distanceM' || field === 'durationMin') patch.paceLabel = paceLabel(nextForm)
    if (this.data.sport === 'badminton' && (field === 'gamesWon' || field === 'gamesLost')) {
      const won = Number(nextForm.gamesWon)
      const lost = Number(nextForm.gamesLost)
      if (Number.isFinite(won) && Number.isFinite(lost)) patch['form.gamesTotal'] = String(won + lost)
    }
    this.setData(patch)
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
  onDistanceUnit(e) {
    const distanceUnit = e.currentTarget.dataset.value
    this.setData({ 'form.distanceUnit': distanceUnit, paceLabel: paceLabel(Object.assign({}, this.data.form, { distanceUnit })) })
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

  onVbSessionType(e) {
    const index = Number(e.detail.value)
    this.setData({ vbSessionTypeIndex: index, 'form.vbSessionType': VB_SESSION_TYPES[index].value })
  },

  onVbPosition(e) {
    const index = Number(e.detail.value)
    this.setData({ vbPositionIndex: index, 'form.vbPosition': VB_POSITIONS[index].value })
  },

  onAddVbSet() {
    this.setData({ 'form.vbSets': this.data.form.vbSets.concat([{ our: '', their: '' }]) })
  },

  onRemoveVbSet(e) {
    const sets = this.data.form.vbSets.slice()
    sets.splice(Number(e.currentTarget.dataset.index), 1)
    this.setData({ 'form.vbSets': sets })
  },

  onVbSetField(e) {
    const index = Number(e.currentTarget.dataset.index)
    const side = e.currentTarget.dataset.side
    const sets = this.data.form.vbSets.map((set, i) => i === index ? Object.assign({}, set, { [side]: e.detail.value }) : set)
    this.setData({ 'form.vbSets': sets })
  },

  onVbStatField(e) {
    const group = e.currentTarget.dataset.group
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.vbStats.${group}.${field}`]: e.detail.value })
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
        fitness: Object.assign(blankFitness(), item.fitness || {}),
        vbSessionType: item.volleyballSessionType || 'training',
        vbPosition: item.volleyballPosition || '',
        vbSets: (item.volleyballSets || []).map((s) => ({ our: s.ourScore ?? '', their: s.opponentScore ?? '' })),
        vbStats: Object.assign(blankVolleyballStats(), item.volleyballStats || {})
      })
      this.setData({
        formOpen: true,
        editingId: item.id,
        strokeIndex,
        surfaceIndex,
        natureIndex,
        vbSessionTypeIndex: Math.max(0, VB_SESSION_TYPES.findIndex((x) => x.value === (item.volleyballSessionType || 'training'))),
        vbPositionIndex: Math.max(0, VB_POSITIONS.findIndex((x) => x.value === (item.volleyballPosition || ''))),
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
    } else if (this.data.sport === 'volleyball') {
      const stats = {}
      Object.keys(f.vbStats || {}).forEach((group) => {
        const cleaned = cleanNumberObject(f.vbStats[group])
        if (cleaned) stats[group] = cleaned
      })
      Object.assign(payload, {
        volleyballSessionType: f.vbSessionType || undefined,
        volleyballPosition: f.vbPosition || undefined,
        volleyballSets: f.vbSets
          .map((s) => ({ ourScore: numberOrUndefined(s.our), opponentScore: numberOrUndefined(s.their) }))
          .filter((s) => s.ourScore !== undefined || s.opponentScore !== undefined),
        volleyballStats: Object.keys(stats).length ? stats : undefined
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
    const formError = validateForm(this.data.form, this.data.sport)
    if (formError) {
      wx.showToast({ title: formError, icon: 'none' })
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
