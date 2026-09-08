'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const strength = require('../../services/strength.js')
const { BODY_PARTS, BODY_PART_LABELS, FEEL_OPTIONS } = require('../../models/contracts.js')

function fmtElapsed(startedAt) {
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return (h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`)
}

function displayWeight(set) {
  if (set.weightType === 'bodyweight') return '自重'
  if (set.weightType === 'assisted') return `-${Math.abs(set.weight)}kg`
  const suffix = set.weightType === 'dumbbell' ? 'kg/只' : 'kg'
  return `${set.weight}${suffix}`
}

function setVolume(set) {
  if ((set.weightType !== 'weight' && set.weightType !== 'dumbbell') || set.weight <= 0 || set.reps <= 0) return 0
  return Math.round(set.weight * set.reps * 100) / 100
}

Page({
  data: {
    session: null,
    items: [],
    readOnly: false,
    loading: true,
    busy: false,
    error: '',
    totalSets: 0,
    totalVolume: 0,
    elapsed: '00:00',
    feelLabel: '',
    pickerOpen: false,
    pickerSearch: '',
    pickerBodyPart: '',
    exercises: [],
    pickableExercises: [],
    pickerBodyParts: BODY_PARTS.map((id) => ({ id, label: BODY_PART_LABELS[id] })),
    bodyPartLabels: BODY_PART_LABELS,
    finishOpen: false,
    notes: '',
    feel: 0,
    feelOptions: FEEL_OPTIONS,
    editingSet: { weId: '', setId: '' },
    editWeight: '',
    editReps: ''
  },

  onLoad(options) {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.sessionId = options && options.id ? options.id : ''
    if (!this.sessionId) {
      this.setData({ error: '缺少训练 ID' })
      return
    }
    this.load()
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  },

  noop() {},

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const [detail, exercises] = await Promise.all([
        strength.getWorkout(this.sessionId),
        data.listExercises()
      ])
      if (!detail || !detail.session) throw new Error('训练不存在')
      const session = detail.session
      const decorated = exercises.map((e) =>
        Object.assign({}, e, { bodyPartLabel: BODY_PART_LABELS[e.bodyPart] || e.bodyPart })
      )
      const exMap = new Map(decorated.map((e) => [e.id, e]))
      const items = (detail.workoutExercises || []).map((we) => {
        const exercise = exMap.get(we.exerciseId) || {
          id: we.exerciseId,
          name: '已删除动作',
          bodyPart: 'chest',
          defaultWeightType: 'weight',
          equipment: 'other'
        }
        const weightType = exercise.defaultWeightType || 'weight'
        const sets = (we.sets || []).map((s) =>
          Object.assign({}, s, { displayWeight: displayWeight(s) })
        )
        return {
          id: we.id,
          exerciseId: we.exerciseId,
          name: exercise.name,
          bodyPartLabel: BODY_PART_LABELS[exercise.bodyPart] || exercise.bodyPart,
          weightType,
          weightLabel: weightType === 'bodyweight' ? '' : weightType === 'assisted' ? '辅助kg' : weightType === 'dumbbell' ? 'kg/只' : 'kg',
          sets,
          draftWeight: weightType === 'bodyweight' ? '' : '20',
          draftReps: '10',
          draftCount: '1'
        }
      })
      const totalSets = items.reduce((n, it) => n + it.sets.length, 0)
      const totalVolume = items.reduce((n, it) => n + it.sets.reduce((a, s) => a + setVolume(s), 0), 0)
      const feelLabel = (FEEL_OPTIONS.find((f) => f.value === session.feel) || {}).label || ''
      this.setData({
        session,
        items,
        readOnly: session.status === 'completed',
        totalSets,
        totalVolume: Math.round(totalVolume),
        feelLabel,
        loading: false
      })
      if (session.status === 'active') {
        this.elapsed = fmtElapsed(session.startedAt)
        this.setData({ elapsed: this.elapsed })
        if (this.timer) clearInterval(this.timer)
        this.timer = setInterval(() => {
          this.setData({ elapsed: fmtElapsed(session.startedAt) })
        }, 1000)
      }
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败' })
    }
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/strength/strength' })
  },

  /* ---------------- 动作选择 ---------------- */

  async onOpenPicker() {
    if (this.data.busy) return
    this.setData({ busy: true, pickerOpen: true })
    try {
      const exercises = await data.listExercises()
      const decorated = exercises.map((e) =>
        Object.assign({}, e, { bodyPartLabel: BODY_PART_LABELS[e.bodyPart] || e.bodyPart })
      )
      this.setData({ exercises: decorated, pickerBodyPart: '', pickerSearch: '', pickableExercises: decorated })
    } catch (e) {
      wx.showToast({ title: e.message || '加载动作失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  onClosePicker() {
    this.setData({ pickerOpen: false })
  },

  onPickerSearch(e) {
    this.setData({ pickerSearch: e.detail.value })
    this.refreshPickerList()
  },

  onPickerBodyPart(e) {
    const value = e.currentTarget.dataset.value
    this.setData({ pickerBodyPart: this.data.pickerBodyPart === value ? '' : value })
    this.refreshPickerList()
  },

  refreshPickerList() {
    const q = this.data.pickerSearch.trim().toLowerCase()
    const part = this.data.pickerBodyPart
    const list = this.data.exercises.filter((e) => {
      if (part && e.bodyPart !== part) return false
      if (q && !e.name.toLowerCase().includes(q)) return false
      return true
    })
    this.setData({ pickableExercises: list })
  },

  async onPickExercise(e) {
    const exerciseId = e.currentTarget.dataset.id
    const exercise = this.data.exercises.find((x) => x.id === exerciseId)
    if (!exercise || this.data.busy) return
    this.setData({ busy: true })
    try {
      await strength.addExerciseToSession(this.sessionId, exercise)
      this.setData({ pickerOpen: false })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onRemoveExercise(e) {
    const weId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该动作'
    const res = await wx.showModal({ title: `移除「${name}」?`, content: '该动作下的组数据会一并删除。' })
    if (!res.confirm) return
    try {
      await strength.removeExercise(weId)
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '移除失败', icon: 'none' })
    }
  },

  /* ---------------- 加组 ---------------- */

  onDraftInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`items[${index}].draft${field[0].toUpperCase()}${field.slice(1)}`]: e.detail.value })
  },

  async onAddSetGroup(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item || this.data.busy) return
    this.setData({ busy: true })
    try {
      await strength.addSetGroup(this.sessionId, item.id, {
        weightType: item.weightType,
        weight: item.draftWeight,
        reps: item.draftReps,
        count: item.draftCount,
        date: this.data.session.date,
        baseSetNumber: item.sets.length
      })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  /* ---------------- 编辑 / 删除组 ---------------- */

  onStartEditSet(e) {
    const { weId, setId, weight, reps, weightType } = e.currentTarget.dataset
    const display = weightType === 'assisted' ? String(Math.abs(Number(weight) || 0)) : String(weight === undefined || weight === '' ? '' : weight)
    this.setData({
      editingSet: { weId, setId },
      editWeight: weightType === 'bodyweight' ? '' : display,
      editReps: String(reps || '')
    })
  },

  onEditInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onCancelEditSet() {
    this.setData({ editingSet: { weId: '', setId: '' } })
  },

  async onSaveEditSet(e) {
    const setId = e.currentTarget.dataset.setId
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item || this.data.busy) return
    const patch = { reps: Number(this.data.editReps) }
    if (!Number.isInteger(patch.reps) || patch.reps <= 0) {
      wx.showToast({ title: '次数必须为大于 0 的整数', icon: 'none' })
      return
    }
    if (item.weightType !== 'bodyweight') {
      const w = Number(this.data.editWeight)
      if (!Number.isFinite(w) || w <= 0) {
        wx.showToast({ title: '重量必须大于 0', icon: 'none' })
        return
      }
      patch.weight = item.weightType === 'assisted' ? -w : w
    }
    this.setData({ busy: true })
    try {
      await strength.updateSet(setId, patch)
      this.setData({ editingSet: { weId: '', setId: '' } })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onDeleteSet(e) {
    const setId = e.currentTarget.dataset.setId
    const res = await wx.showModal({ title: '删除这一组?', content: '删除后不可恢复。' })
    if (!res.confirm) return
    try {
      await strength.removeSet(setId)
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  },

  /* ---------------- 完成 / 放弃 ---------------- */

  onOpenFinish() {
    if (this.data.totalSets === 0) {
      wx.showToast({ title: '至少完成一组才能结束', icon: 'none' })
      return
    }
    this.setData({
      finishOpen: true,
      notes: this.data.session.notes || '',
      feel: this.data.session.feel || 0
    })
  },

  onCloseFinish() {
    this.setData({ finishOpen: false })
  },

  onNotesInput(e) {
    this.setData({ notes: e.detail.value })
  },

  onFeelTap(e) {
    this.setData({ feel: Number(e.currentTarget.dataset.value) })
  },

  async onConfirmFinish() {
    if (this.data.busy || !this.data.session) return
    this.setData({ busy: true })
    try {
      await strength.completeWorkout(this.sessionId, {
        notes: this.data.notes.trim() || undefined,
        feel: this.data.feel || undefined,
        durationSec: Math.max(1, Math.floor((Date.now() - this.data.session.startedAt) / 1000))
      })
      this.setData({ finishOpen: false })
      wx.showToast({ title: '训练完成 🎉', icon: 'success' })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message || '完成失败', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onDiscardWorkout() {
    const res = await wx.showModal({
      title: '放弃本次训练?',
      content: '已输入的组数据会一并删除。',
      confirmText: '放弃'
    })
    if (!res.confirm) return
    try {
      await strength.discardWorkout(this.sessionId)
      this.goBack()
    } catch (err) {
      wx.showToast({ title: err.message || '放弃失败', icon: 'none' })
    }
  }
})
