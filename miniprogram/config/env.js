'use strict'

/**
 * 小程序运行环境配置。
 * 规则:
 * - 真机 develop/trial/release:固定使用 Railway 生产 API。
 * - 仅微信开发者工具允许 storage 手动覆盖，便于受控联调。
 * 后端 URL 不含 /api;API client 统一拼接。
 *
 * 真机包始终连接已配置 request 合法域名的 Railway 服务。
 */

const API_BASE_STORAGE_KEY = 'mygym.apiBase'
/** 云端生产后端：小程序正式数据源 */
const CLOUD_API_BASE = 'https://mygym-os-production.up.railway.app'
/** 开发者工具默认也走云端 */
const DEV_API_BASE = CLOUD_API_BASE
/** 正式发布后端地址 */
const PROD_API_BASE = CLOUD_API_BASE

function normalizeBase(base) {
  const trimmed = String(base || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/api$/.test(trimmed) ? trimmed.slice(0, -4) : trimmed
}

function getApiBase() {
  const version = currentEnvVersion()
  if (version === 'release' || !isDevToolsRuntime()) {
    return normalizeBase(PROD_API_BASE)
  }
  let override = ''
  try {
    override = wx.getStorageSync(API_BASE_STORAGE_KEY) || ''
  } catch (e) {
    override = ''
  }
  return normalizeBase(override || DEV_API_BASE)
}

function isDevToolsRuntime() {
  try {
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    return info && info.platform === 'devtools'
  } catch (e) {
    return false
  }
}

function setApiBase(url) {
  if (!isDevToolsRuntime()) return
  wx.setStorageSync(API_BASE_STORAGE_KEY, String(url || '').trim())
}

function currentEnvVersion() {
  try {
    const info = wx.getAccountInfoSync()
    return info && info.miniProgram ? info.miniProgram.envVersion || '' : ''
  } catch (e) {
    return ''
  }
}

module.exports = {
  API_BASE_STORAGE_KEY,
  DEV_API_BASE,
  PROD_API_BASE,
  CLOUD_API_BASE,
  getApiBase,
  setApiBase,
  normalizeBase,
  isDevToolsRuntime,
  currentEnvVersion
}
