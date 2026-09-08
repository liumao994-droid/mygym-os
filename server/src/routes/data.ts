import { Router } from 'express'
import type { AppConfig } from '../config.js'
import type { Store } from '../db/sqlite.js'
import { requireAuth, authOf, HttpError } from '../auth.js'
import { createOwned, deleteOwned, getModel, listOwned, ownRow, patchOwned, replaceOwned } from './helpers.js'

/**
 * 细粒度数据 API(微信小程序 / 未来云端模式共用):
 * 全部经过 requireAuth,所有读写以 token 中的 userId 为准。
 * 创建时接受客户端 id(幂等重试),归属由服务端强制绑定。
 */
export function dataRoutes(store: Store, _cfg: AppConfig): Router {
  const r = Router()
  r.use(requireAuth(store, _cfg))

  const dateRange = (q: Record<string, unknown>): { from?: string; to?: string } => {
    const from = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : undefined
    const to = typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : undefined
    return { from, to }
  }

  /* ---------------- 力量训练会话 ---------------- */

  r.get('/sessions', (req, res) => {
    const { userId } = authOf(req)
    const q = req.query as Record<string, string | undefined>
    const conds: string[] = []
    const params: (string | number)[] = []
    if (q.status === 'active' || q.status === 'completed') {
      conds.push('status = ?')
      params.push(q.status)
    }
    const rows = listOwned(store, 'sessions', userId, {
      ...dateRange(q),
      where: conds,
      params,
      order: 'date DESC, started_at DESC',
      limit: q.limit ? Math.min(Number(q.limit) || 100, 500) : undefined,
    })
    res.json({ sessions: rows })
  })

  r.post('/sessions', (req, res) => {
    const { userId } = authOf(req)
    const model = createOwned(store, 'sessions', req.body, userId)
    res.status(201).json({ session: model })
  })

  r.get('/sessions/:id', (req, res) => {
    const { userId } = authOf(req)
    const session = getModel(store, 'sessions', req.params.id, userId)
    const workoutExercises = listOwned(store, 'workoutExercises', userId, {
      where: ['session_id = ?'],
      params: [req.params.id],
      order: 'sort_order ASC',
    })
    for (const we of workoutExercises) {
      we.sets = listOwned(store, 'sets', userId, {
        where: ['workout_exercise_id = ?'],
        params: [we.id as string],
        order: 'set_number ASC',
      })
    }
    res.json({ session, workoutExercises })
  })

  r.patch('/sessions/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ session: patchOwned(store, 'sessions', req.params.id, req.body, userId) })
  })

  r.put('/sessions/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ session: replaceOwned(store, 'sessions', req.params.id, req.body, userId) })
  })

  r.delete('/sessions/:id', (req, res) => {
    const { userId } = authOf(req)
    store.transaction(() => {
      deleteOwned(store, 'sessions', req.params.id, userId)
      store.run('DELETE FROM workout_exercises WHERE session_id = ? AND user_id = ?', req.params.id, userId)
      store.run('DELETE FROM sets WHERE session_id = ? AND user_id = ?', req.params.id, userId)
    })
    res.json({ ok: true })
  })

  /* ---------------- 训练内动作与组 ---------------- */

  r.post('/sessions/:id/exercises', (req, res) => {
    const { userId } = authOf(req)
    ownRow(store, 'sessions', req.params.id, userId) // 会话必须属于当前用户
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    body.sessionId = req.params.id
    // 未指定顺序时追加到末尾(与前端行为一致)
    if (typeof body.order !== 'number') {
      const row = store.get(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM workout_exercises WHERE session_id = ? AND user_id = ?',
        req.params.id,
        userId,
      )
      body.order = Number(row?.next_order ?? 0)
    }
    const model = createOwned(store, 'workoutExercises', body, userId)
    res.status(201).json({ workoutExercise: model })
  })

  r.delete('/workout-exercises/:id', (req, res) => {
    const { userId } = authOf(req)
    store.transaction(() => {
      deleteOwned(store, 'workoutExercises', req.params.id, userId)
      store.run('DELETE FROM sets WHERE workout_exercise_id = ? AND user_id = ?', req.params.id, userId)
    })
    res.json({ ok: true })
  })

  r.post('/sessions/:id/sets', (req, res) => {
    const { userId } = authOf(req)
    const session = ownRow(store, 'sessions', req.params.id, userId)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const weId = typeof body.workoutExerciseId === 'string' ? body.workoutExerciseId : ''
    const we = store.get('SELECT id, exercise_id, sort_order FROM workout_exercises WHERE id = ? AND session_id = ? AND user_id = ?', weId, req.params.id, userId)
    if (!we) throw new HttpError(404, 'NOT_FOUND', '训练动作不存在')
    body.sessionId = req.params.id
    body.exerciseId = we.exercise_id
    body.date = session.date
    // 未指定组号时追加到该动作末尾(与前端行为一致)
    if (typeof body.setNumber !== 'number') {
      const row = store.get(
        'SELECT COALESCE(MAX(set_number), 0) + 1 AS next_number FROM sets WHERE workout_exercise_id = ? AND user_id = ?',
        weId,
        userId,
      )
      body.setNumber = Number(row?.next_number ?? 1)
    }
    const model = createOwned(store, 'sets', body, userId)
    res.status(201).json({ set: model })
  })

  r.patch('/sets/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ set: patchOwned(store, 'sets', req.params.id, req.body, userId) })
  })

  r.delete('/sets/:id', (req, res) => {
    const { userId } = authOf(req)
    store.transaction(() => {
      const current = ownRow(store, 'sets', req.params.id, userId)
      const workoutExerciseId = String(current.workout_exercise_id)
      deleteOwned(store, 'sets', req.params.id, userId)
      const siblings = store.all(
        'SELECT id, set_number FROM sets WHERE workout_exercise_id = ? AND user_id = ? ORDER BY set_number ASC',
        workoutExerciseId,
        userId,
      )
      for (let i = 0; i < siblings.length; i++) {
        const expected = i + 1
        const currentNumber = Number(siblings[i].set_number)
        if (currentNumber !== expected) {
          store.run('UPDATE sets SET set_number = ? WHERE id = ? AND user_id = ?', expected, siblings[i].id, userId)
        }
      }
    })
    res.json({ ok: true })
  })

  /* ---------------- 非力量运动(羽毛球/游泳/网球…) ---------------- */

  r.get('/activities', (req, res) => {
    const { userId } = authOf(req)
    const q = req.query as Record<string, string | undefined>
    const conds: string[] = []
    const params: (string | number)[] = []
    if (q.sport) {
      conds.push('sport = ?')
      params.push(q.sport)
    }
    const rows = listOwned(store, 'activitySessions', userId, {
      ...dateRange(q),
      where: conds,
      params,
      order: 'date DESC, created_at DESC',
      limit: q.limit ? Math.min(Number(q.limit) || 200, 1000) : undefined,
    })
    res.json({ activities: rows })
  })

  r.get('/activities/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ activity: getModel(store, 'activitySessions', req.params.id, userId) })
  })

  r.post('/activities', (req, res) => {
    const { userId } = authOf(req)
    res.status(201).json({ activity: createOwned(store, 'activitySessions', req.body, userId) })
  })

  r.patch('/activities/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ activity: patchOwned(store, 'activitySessions', req.params.id, req.body, userId) })
  })

  r.delete('/activities/:id', (req, res) => {
    const { userId } = authOf(req)
    deleteOwned(store, 'activitySessions', req.params.id, userId)
    res.json({ ok: true })
  })

  /* ---------------- 动作库 ---------------- */

  r.get('/exercises', (req, res) => {
    const { userId } = authOf(req)
    const includeDeleted = (req.query as Record<string, string>).includeDeleted === '1'
    const conds = includeDeleted ? [] : ['deleted_at IS NULL']
    const rows = listOwned(store, 'exercises', userId, {
      where: conds,
      order: 'created_at ASC',
      limit: 1000,
    })
    res.json({ exercises: rows })
  })

  r.post('/exercises', (req, res) => {
    const { userId } = authOf(req)
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    // equipment 缺省时按重量形式推断(与前端 guessEquipment 一致)
    if (typeof body.equipment !== 'string' || !body.equipment) {
      const t = body.defaultWeightType
      body.equipment = t === 'bodyweight' ? 'bodyweight' : t === 'assisted' ? 'assisted' : t === 'dumbbell' ? 'dumbbell' : 'machine'
    }
    if (typeof body.defaultWeightType !== 'string' || !body.defaultWeightType) body.defaultWeightType = 'weight'
    if (body.isCustom === undefined) body.isCustom = 1
    const model = createOwned(store, 'exercises', body, userId)
    res.status(201).json({ exercise: model })
  })

  r.patch('/exercises/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ exercise: patchOwned(store, 'exercises', req.params.id, req.body, userId) })
  })

  /** 动作删除为软删除(与前端语义一致) */
  r.delete('/exercises/:id', (req, res) => {
    const { userId } = authOf(req)
    ownRow(store, 'exercises', req.params.id, userId)
    store.run('UPDATE exercises SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', Date.now(), Date.now(), req.params.id, userId)
    res.json({ ok: true })
  })

  /* ---------------- 模板 ---------------- */

  r.get('/templates', (req, res) => {
    const { userId } = authOf(req)
    res.json({ templates: listOwned(store, 'templates', userId, { order: 'updated_at DESC', limit: 500 }) })
  })

  r.post('/templates', (req, res) => {
    const { userId } = authOf(req)
    res.status(201).json({ template: createOwned(store, 'templates', req.body, userId) })
  })

  r.patch('/templates/:id', (req, res) => {
    const { userId } = authOf(req)
    res.json({ template: patchOwned(store, 'templates', req.params.id, req.body, userId) })
  })

  r.delete('/templates/:id', (req, res) => {
    const { userId } = authOf(req)
    deleteOwned(store, 'templates', req.params.id, userId)
    res.json({ ok: true })
  })

  /* ---------------- 日状态(休息日) ---------------- */

  r.get('/daily-statuses', (req, res) => {
    const { userId } = authOf(req)
    const rows = listOwned(store, 'dailyStatuses', userId, { ...dateRange(req.query as Record<string, string>), order: 'date DESC' })
    res.json({ dailyStatuses: rows })
  })

  r.put('/daily-statuses/:date', (req, res) => {
    const { userId } = authOf(req)
    const model = replaceOwned(store, 'dailyStatuses', req.params.date, { date: req.params.date, ...(req.body as object) }, userId)
    res.json({ dailyStatus: model })
  })

  r.delete('/daily-statuses/:date', (req, res) => {
    const { userId } = authOf(req)
    deleteOwned(store, 'dailyStatuses', req.params.date, userId)
    res.json({ ok: true })
  })

  return r
}
