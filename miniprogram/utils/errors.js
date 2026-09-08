'use strict'

/** 统一 API 错误:所有页面/服务只处理这一个形状。 */
function createApiError(status, code, message, type) {
  const err = new Error(message || '请求失败')
  err.status = status
  err.code = code || (status ? `HTTP_${status}` : 'NETWORK')
  err.type = type || 'HTTP'
  return err
}

function isApiError(e) {
  return Boolean(e && typeof e === 'object' && 'code' in e && 'type' in e)
}

module.exports = {
  createApiError,
  isApiError
}
