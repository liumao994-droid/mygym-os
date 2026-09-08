'use strict'

/**
 * MyGym OS API 契约(小程序侧只读镜像)。
 *
 * 权威定义仍在:
 * - 前端模型/字段:src/db/models.ts
 * - 服务端表与校验:server/src/db/tables.ts
 * 小程序只通过 REST JSON 拿到与 Web 相同的模型,不做本地持久化模型。
 */

const SPORTS = ['strength', 'badminton', 'swimming', 'tennis']

const SPORT_LABELS = {
  strength: '力量训练',
  badminton: '羽毛球',
  swimming: '游泳',
  tennis: '网球'
}

const SESSION_STATUSES = ['active', 'completed']

const STROKES = ['freestyle', 'breaststroke', 'backstroke', 'butterfly', 'medley', 'other']

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 服务器本地日期 YYYY-MM-DD;小程序端尽量不直接造 id/日期,接口允许服务端补默认值 */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

module.exports = {
  SPORTS,
  SPORT_LABELS,
  SESSION_STATUSES,
  STROKES,
  todayStr
}
