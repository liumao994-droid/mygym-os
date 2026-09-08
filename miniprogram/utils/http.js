'use strict'

const session = require('./session.js')
const { createApiError } = require('./errors.js')
const env = require('../config/env.js')

let loadingCount = 0

function beginLoading(text) {
  loadingCount += 1
  if (loadingCount === 1) {
    wx.showLoading({ title: text || '请求中', mask: true })
  }
}

function endLoading() {
  loadingCount = Math.max(0, loadingCount - 1)
  if (loadingCount === 0) {
    wx.hideLoading()
  }
}

function toError(status, body, type) {
  const info = body && typeof body === 'object' ? body : {}
  return createApiError(status, info.error, info.message, type)
}

/**
 * 统一请求封装。所有服务层都经此函数,页面不直接写 wx.request。
 *
 * options:
 * - path: 以 / 开头的 API 路径(不含 /api 前缀)
 * - method/data/auth/loading/loadingText/timeout/skipAuthRedirect
 */
function request(options) {
  return new Promise((resolve, reject) => {
    const opts = options || {}
    const method = (opts.method || 'GET').toUpperCase()
    const withAuth = opts.auth !== false
    const base = env.getApiBase()
    if (!base) {
      reject(createApiError(0, 'API_NOT_CONFIGURED', '未配置 MyGym API 地址', 'CONFIG'))
      return
    }
    const url = `${base}/api${opts.path}`
    const header = { 'Content-Type': 'application/json' }
    if (withAuth) {
      const token = session.getToken()
      if (!token) {
        session.handleUnauthorized()
        reject(createApiError(401, 'UNAUTHORIZED', '未登录或登录已过期', 'HTTP'))
        return
      }
      header.Authorization = `Bearer ${token}`
    }
    if (opts.loading) beginLoading(opts.loadingText)

    const done = () => {
      if (opts.loading) endLoading()
    }

    wx.request({
      url,
      method,
      header,
      data: opts.data,
      timeout: opts.timeout || 15000,
      success(res) {
        const status = res && res.statusCode ? res.statusCode : 0
        const body = res && typeof res.data !== 'undefined' ? res.data : null
        if (status >= 200 && status < 300) {
          resolve(body)
          return
        }
        const err = toError(status, body, 'HTTP')
        if (status === 401 && withAuth && !opts.skipAuthRedirect) {
          session.handleUnauthorized()
        }
        reject(err)
      },
      fail(err) {
        const msg = err && err.errMsg ? String(err.errMsg) : ''
        const type = /timeout/i.test(msg) ? 'TIMEOUT' : 'NETWORK'
        reject(createApiError(0, type === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK', type === 'TIMEOUT' ? '请求超时,请稍后重试' : '无法连接服务器,请检查网络或 API 地址', type))
      },
      complete() {
        done()
      }
    })
  })
}

module.exports = {
  request
}
