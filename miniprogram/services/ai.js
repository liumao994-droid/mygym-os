'use strict'

const http = require('../utils/http.js')

/**
 * AI:只调用 MyGym 后端代理,绝不直接连 AI Provider。
 * API Key/额度全部在服务端。
 */

async function quota() {
  const body = await http.request({ path: '/ai/quota' })
  return body
}

async function trainingSummary(payload) {
  const body = await http.request({
    path: '/ai/training-summary',
    method: 'POST',
    data: payload,
    timeout: 65000,
    loading: true,
    loadingText: 'AI 分析中'
  })
  return body
}

module.exports = {
  quota,
  trainingSummary
}
