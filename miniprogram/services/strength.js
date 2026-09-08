'use strict'

/**
 * 力量训练领域服务:只编排 REST 调用,不包含 wx / 页面逻辑。
 * 训练归属始终由后端 JWT 决定。
 */

const data = require('./data.js')
const { BODY_PART_LABELS, todayStr } = require('../models/contracts.js')
const { newClientId } = require('../utils/id.js')

function bodyPartTitle(bodyParts) {
  const parts = Array.isArray(bodyParts) ? bodyParts : []
  const title = parts
    .map((p) => BODY_PART_LABELS[p] || p)
    .join(' + ')
  return title || '力量训练'
}

async function startSession(bodyParts) {
  const now = Date.now()
  const date = todayStr()
  return data.createSession({
    id: newClientId('session'),
    date,
    status: 'active',
    bodyParts,
    title: bodyPartTitle(bodyParts),
    startedAt: now,
    createdAt: now,
    updatedAt: now
  })
}

async function getActiveSession() {
  const sessions = await data.listSessions({ status: 'active', limit: 1 })
  return sessions && sessions.length ? sessions[0] : null
}

async function getRecentSessions(limit) {
  return data.listSessions({ status: 'completed', limit: limit || 20 })
}

async function getLatestCompletedSession() {
  const sessions = await data.listSessions({ status: 'completed', limit: 1 })
  return sessions && sessions.length ? sessions[0] : null
}

async function getWorkout(id) {
  const detail = await data.getSession(id)
  return detail
}

async function addExerciseToSession(sessionId, exercise) {
  const now = Date.now()
  const we = await data.addWorkoutExercise(sessionId, {
    id: newClientId('we'),
    exerciseId: exercise.id,
    createdAt: now
  })
  return we
}

async function removeExercise(workoutExerciseId) {
  await data.deleteWorkoutExercise(workoutExerciseId)
}

/** 一次批量添加 count 组。weightType=bodyweight 时忽略重量;assisted 转服务端负值语义。 */
async function addSetGroup(sessionId, workoutExerciseId, input) {
  const { weightType, reps, count, date, baseSetNumber } = input
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const r = Math.floor(Number(reps) || 0)
  if (r <= 0) throw new Error('次数必须大于 0')
  const now = Date.now()
  for (let i = 0; i < n; i++) {
    let weight = 0
    if (weightType !== 'bodyweight') {
      const w = Number(input.weight)
      if (!Number.isFinite(w) || w <= 0) throw new Error('重量必须大于 0')
      weight = weightType === 'assisted' ? -w : w
    }
    await data.addSet(sessionId, {
      workoutExerciseId,
      weight,
      reps: r,
      weightType,
      date,
      setNumber: Number(baseSetNumber || 0) + i + 1,
      createdAt: now
    })
  }
}

async function updateSet(setId, patch) {
  return data.patchSet(setId, patch)
}

async function removeSet(setId) {
  await data.deleteSet(setId)
}

async function completeWorkout(id, patch) {
  return data.patchSession(id, {
    status: 'completed',
    completedAt: Date.now(),
    updatedAt: Date.now(),
    ...(patch || {})
  })
}

async function discardWorkout(id) {
  await data.deleteSession(id)
}

/** 复制最近一次已完成训练为新的 active 会话。 */
async function copyLastCompletedSession() {
  const last = await getLatestCompletedSession()
  if (!last) return null
  const detail = await getWorkout(last.id)
  const now = Date.now()
  const date = todayStr()
  let created = null
  try {
    created = await data.createSession({
      id: newClientId('copy'),
      date,
      status: 'active',
      bodyParts: last.bodyParts || [],
      title: last.title || bodyPartTitle(last.bodyParts || []),
      startedAt: now,
      copiedFromSessionId: last.id,
      createdAt: now,
      updatedAt: now
    })
    const exerciseMap = new Map(
      (Array.isArray(detail.workoutExercises) ? detail.workoutExercises : []).map((we) => [we.id, we])
    )
    for (const we of detail.workoutExercises || []) {
      const newWe = await addExerciseToSession(created.id, { id: we.exerciseId })
      const origin = exerciseMap.get(we.id)
      const sets = (origin && origin.sets) || []
      for (const s of sets) {
        await data.addSet(created.id, {
          workoutExerciseId: newWe.id,
          exerciseId: we.exerciseId,
          weight: s.weight || 0,
          reps: s.reps,
          weightType: s.weightType || 'weight',
          rpe: s.rpe,
          date,
          createdAt: now
        })
      }
    }
    return created
  } catch (e) {
    if (created && created.id) {
      try {
        await data.deleteSession(created.id)
      } catch (cleanupErr) {
        // 清理失败不覆盖原始错误
      }
    }
    throw e
  }
}

/** 按云端模板创建训练，逐项写入以保持服务端归属与校验。 */
async function startFromTemplate(template) {
  if (!template || !Array.isArray(template.items) || !template.items.length) throw new Error('模板没有动作')
  const session = await startSession(template.bodyParts || [])
  try {
    for (const item of template.items) {
      const we = await addExerciseToSession(session.id, { id: item.exerciseId })
      for (const group of item.sets || []) {
        await addSetGroup(session.id, we.id, {
          weightType: group.weightType || 'weight',
          weight: Math.abs(Number(group.weight) || 0),
          reps: group.reps,
          count: group.count,
          date: session.date
        })
      }
    }
    await data.patchSession(session.id, { templateId: template.id, title: template.name, updatedAt: Date.now() })
    return session
  } catch (e) {
    try { await data.deleteSession(session.id) } catch (cleanupErr) {}
    throw e
  }
}

module.exports = {
  bodyPartTitle,
  startSession,
  getActiveSession,
  getRecentSessions,
  getLatestCompletedSession,
  getWorkout,
  addExerciseToSession,
  removeExercise,
  addSetGroup,
  updateSet,
  removeSet,
  completeWorkout,
  discardWorkout,
  copyLastCompletedSession,
  startFromTemplate
}
