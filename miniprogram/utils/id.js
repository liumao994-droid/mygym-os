'use strict'

/** 幂等重试用的客户端 id(服务端拒绝同名已存在记录,避免重复创建)。 */
function newClientId(prefix) {
  const rand = Math.random().toString(36).slice(2, 12)
  return `${prefix || 'mp'}-${Date.now().toString(36)}-${rand}`
}

module.exports = { newClientId }
