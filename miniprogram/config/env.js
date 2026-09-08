'use strict'

/**
 * 小程序运行环境配置。
 * 规则:storage 手动覆盖 > 构建时默认地址。
 * 后端 URL 不含 /api;API client 统一拼接。
 *
 * 开发默认连接本机 MyGym API(需在微信开发者工具勾选「不校验合法域名」)。
 * 正式发布前把 DEFAULT_API_BASE 改成你部署的 HTTPS 域名,并在微信公众平台配置 request 合法域名。
 */

const API_BASE_STORAGE_KEY = 'mygym.apiBase'
const DEFAULT_API_BASE = 'http://127.0.0.1:8787'

function normalizeBase(base) {
  const trimmed = String(base || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/api$/.test(trimmed) ? trimmed.slice(0, -4) : trimmed
}

function getApiBase() {
  let override = ''
  try {
    override = wx.getStorageSync(API_BASE_STORAGE_KEY) || ''
  } catch (e) {
    override = ''
  }
  const resolved = normalizeBase(override || DEFAULT_API_BASE)
  return resolved || DEFAULT_API_BASE
}

function setApiBase(url) {
  wx.setStorageSync(API_BASE_STORAGE_KEY, String(url || '').trim())
}

function isDevToolsSession() {
  try {
    const info = wx.getAccountInfoSync()
    return !info || !info.miniProgram || info.miniProgram.envVersion !== 'release'
  } catch (e) {
    return false
  }
}

module.exports = {
  API_BASE_STORAGE_KEY,
  DEFAULT_API_BASE,
  getApiBase,
  setApiBase,
  normalizeBase,
  isDevToolsSession
}
