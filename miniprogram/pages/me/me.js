'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const ai = require('../../services/ai.js')

const SETTINGS_KEY = 'mygym.mini.settings.v1'

function readSettings() {
  try { return Object.assign({ unit: 'kg', reminders: true }, wx.getStorageSync(SETTINGS_KEY) || {}) } catch (e) { return { unit: 'kg', reminders: true } }
}

function writeTextFile(path, text) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: text, encoding: 'utf8', success: resolve, fail: reject }))
}

function readTextFile(path) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'utf8', success: (r) => resolve(r.data), fail: reject }))
}

function chooseJsonFile() {
  return new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: (r) => resolve(r.tempFiles[0]), fail: reject }))
}

function shareFile(path, fileName) {
  if (typeof wx.shareFileMessage !== 'function') throw new Error('当前微信版本不支持转发文件，请升级微信')
  return new Promise((resolve, reject) => wx.shareFileMessage({ filePath: path, fileName, success: resolve, fail: reject }))
}

function csvCell(value) {
  const text = String(value === undefined || value === null ? '' : value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

Page({
  data: {
    user: null,
    avatarChar: 'M',
    stats: { sessions: 0, sets: 0, exercises: 0, volume: 0, activities: 0 },
    quota: null,
    unit: 'kg',
    reminders: true,
    loading: false,
    busy: false
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const settings = readSettings()
    this.setData(settings)
    this.load()
  },

  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh() },

  async load() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const [user, backup, quota] = await Promise.all([auth.getMe(), data.exportBackup(), ai.quota().catch(() => null)])
      const d = backup.data || {}
      const completed = (d.sessions || []).filter((s) => s.status === 'completed')
      const volume = (d.sets || []).reduce((sum, s) => s.weight > 0 && s.reps > 0 ? sum + s.weight * s.reps : sum, 0)
      this.setData({
        user,
        avatarChar: (user.nickname || 'M').slice(0, 1),
        quota,
        stats: {
          sessions: completed.length,
          sets: (d.sets || []).length,
          exercises: (d.exercises || []).filter((e) => !e.deletedAt).length,
          volume: Math.round(volume),
          activities: (d.activitySessions || []).length
        }
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  onUnit(e) {
    const unit = e.currentTarget.dataset.unit
    const next = Object.assign(readSettings(), { unit })
    wx.setStorageSync(SETTINGS_KEY, next)
    this.setData({ unit })
  },

  onReminder(e) {
    const reminders = !!e.detail.value
    wx.setStorageSync(SETTINGS_KEY, Object.assign(readSettings(), { reminders }))
    this.setData({ reminders })
  },

  onOpen(e) {
    const target = e.currentTarget.dataset.target
    const urls = { exercises: '/pages/exercises/exercises', templates: '/pages/templates/templates', reports: '/pages/reports/reports', sandbox: '/pages/sandbox/sandbox' }
    if (urls[target]) wx.navigateTo({ url: urls[target] })
  },

  async onExport() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const backup = await data.exportBackup()
      const date = new Date().toISOString().slice(0, 10)
      const fileName = `MyGymOS-backup-${date}.json`
      const path = `${wx.env.USER_DATA_PATH}/${fileName}`
      await writeTextFile(path, JSON.stringify(backup, null, 2))
      await shareFile(path, fileName)
    } catch (e) {
      if (!String(e.errMsg || '').includes('cancel')) wx.showToast({ title: e.message || '导出失败', icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  async onExportCsv() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const backup = await data.exportBackup()
      const d = backup.data || {}
      const exercises = new Map((d.exercises || []).map((e) => [e.id, e.name]))
      const sessions = new Map((d.sessions || []).map((s) => [s.id, s]))
      const rows = [['日期', '训练', '动作', '组号', '重量kg', '次数', '重量形式', 'RPE']]
      ;(d.sets || []).sort((a, b) => a.date.localeCompare(b.date)).forEach((s) => {
        const sessionRow = sessions.get(s.sessionId) || {}
        rows.push([s.date, sessionRow.title || '力量训练', exercises.get(s.exerciseId) || '已删除动作', s.setNumber, s.weight, s.reps, s.weightType, s.rpe])
      })
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
      const date = new Date().toISOString().slice(0, 10)
      const fileName = `MyGymOS-sets-${date}.csv`
      const path = `${wx.env.USER_DATA_PATH}/${fileName}`
      await writeTextFile(path, csv)
      await shareFile(path, fileName)
    } catch (e) {
      if (!String(e.errMsg || '').includes('cancel')) wx.showToast({ title: e.message || '导出失败', icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  async onImport() {
    if (this.data.busy) return
    const confirm = await wx.showModal({ title: '导入 JSON 备份', content: '导入采用合并模式，不会删除当前云端数据；同 ID 数据会安全更新。', confirmText: '选择文件' })
    if (!confirm.confirm) return
    this.setData({ busy: true })
    try {
      const file = await chooseJsonFile()
      const raw = await readTextFile(file.path)
      let backup
      try { backup = JSON.parse(raw) } catch (e) { throw new Error('文件不是有效的 JSON') }
      const result = await data.importBackup(backup)
      const imported = Object.values(result.imported || {}).reduce((n, v) => n + Number(v || 0), 0)
      wx.showModal({ title: '导入完成', content: `已合并 ${imported} 条数据，冲突 ${result.conflicts || 0} 条。`, showCancel: false })
      await this.load()
    } catch (e) {
      if (!String(e.errMsg || '').includes('cancel')) wx.showToast({ title: e.message || '导入失败', icon: 'none' })
    } finally { this.setData({ busy: false }) }
  },

  async onLogout() {
    const res = await wx.showModal({ title: '退出登录？', content: '云端训练数据不会被删除。' })
    if (!res.confirm) return
    await auth.logout()
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
