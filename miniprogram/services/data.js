'use strict'

const http = require('../utils/http.js')

/**
 * 数据访问层:全部走后端 /api(requireAuth)。
 * 服务端只信任 JWT 里的 userId;任何请求体 userId 都会被忽略/覆盖。
 */

function get(path, params, extra) {
  return http.request(Object.assign({ path, method: 'GET', data: params || {} }, extra))
}

function write(method, path, body, extra) {
  return http.request(Object.assign({ path, method, data: body || {}, loading: true }, extra))
}

/* ---------------- 力量训练 ---------------- */

async function listSessions(params) {
  const body = await get('/sessions', params)
  return body.sessions
}

async function getSession(id) {
  const body = await get(`/sessions/${encodeURIComponent(id)}`)
  return body
}

async function createSession(payload) {
  const body = await write('POST', '/sessions', payload)
  return body.session
}

async function patchSession(id, patch) {
  const body = await write('PATCH', `/sessions/${encodeURIComponent(id)}`, patch)
  return body.session
}

async function deleteSession(id) {
  await write('DELETE', `/sessions/${encodeURIComponent(id)}`, undefined)
  return true
}

async function addWorkoutExercise(sessionId, payload) {
  const body = await write('POST', `/sessions/${encodeURIComponent(sessionId)}/exercises`, payload)
  return body.workoutExercise
}

async function addSet(sessionId, payload) {
  const body = await write('POST', `/sessions/${encodeURIComponent(sessionId)}/sets`, payload)
  return body.set
}

/* ---------------- 动作库 / 模板 / 日状态 ---------------- */

async function listExercises() {
  const body = await get('/exercises')
  return body.exercises
}

async function listTemplates() {
  const body = await get('/templates')
  return body.templates
}

async function listDailyStatuses(params) {
  const body = await get('/daily-statuses', params)
  return body.dailyStatuses
}

/* ---------------- 羽毛球 / 游泳 / 网球 ---------------- */

async function listActivities(params) {
  const body = await get('/activities', params)
  return body.activities
}

async function getActivity(id) {
  const body = await get(`/activities/${encodeURIComponent(id)}`)
  return body.activity
}

async function createActivity(payload) {
  const body = await write('POST', '/activities', payload)
  return body.activity
}

async function patchActivity(id, patch) {
  const body = await write('PATCH', `/activities/${encodeURIComponent(id)}`, patch)
  return body.activity
}

async function deleteActivity(id) {
  await write('DELETE', `/activities/${encodeURIComponent(id)}`, undefined)
  return true
}

/* ---------------- 云端全量备份(与 Web JSON 同构) ---------------- */

async function exportBackup() {
  return http.request({ path: '/data/export', timeout: 60000, loading: true, loadingText: '导出中' })
}

async function importBackup(backup) {
  return http.request({
    path: '/data/import',
    method: 'POST',
    data: backup,
    timeout: 120000,
    loading: true,
    loadingText: '导入中'
  })
}

module.exports = {
  listSessions,
  getSession,
  createSession,
  patchSession,
  deleteSession,
  addWorkoutExercise,
  addSet,
  listExercises,
  listTemplates,
  listDailyStatuses,
  listActivities,
  getActivity,
  createActivity,
  patchActivity,
  deleteActivity,
  exportBackup,
  importBackup
}
