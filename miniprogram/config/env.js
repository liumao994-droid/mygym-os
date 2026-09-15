'use strict'

/**
 * 小程序运行环境配置。
 * 规则:
 * - develop/trial(开发版/体验版):storage 手动覆盖 > DEV_API_BASE
 * - release(正式版):只允许 PROD_API_BASE,忽略手动覆盖,防止正式包连回本机。
 * 后端 URL 不含 /api;API client 统一拼接。
 *
 * 默认连接 Railway 云端(与网页版同一个后端、同一个 SQLite):
 * 这样真机开发版/体验版开箱即与网页版数据互通。
 * 本机联调时在登录页「开发联调 → API 地址」填 http://127.0.0.1:8787 覆盖
 * (需在微信开发者工具勾选「不校验合法域名」)。
 */

const API_BASE_STORAGE_KEY = 'mygym.apiBase'
/** 本机联调地址(仅作为最终兜底,正常应手动覆盖或使用云端地址) */
const LOCAL_API_BASE = 'http://127.0.0.1:8787'
/** 云端生产后端:网页版与小程序共用的 Source of Truth */
const CLOUD_API_BASE = 'https://mygym-os-production.up.railway.app'
/** 开发版/体验版默认走云端;真机 127.0.0.1 不可达 */
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
  if (version === 'release') {
    return normalizeBase(PROD_API_BASE)
  }
  let override = ''
  try {
    override = wx.getStorageSync(API_BASE_STORAGE_KEY) || ''
  } catch (e) {
    override = ''
  }
  // 旧开发包可能保存过 127.0.0.1；真机上的回环地址只会指向手机自身，必须回退云端。
  if (!isDevToolsRuntime() && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(?:\/|$)/i.test(override)) override = ''
  const resolved = normalizeBase(override || DEV_API_BASE)
  return resolved || LOCAL_API_BASE
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
  wx.setStorageSync(API_BASE_STORAGE_KEY, String(url || '').trim())
}

function isDevToolsSession() {
  return currentEnvVersion() !== 'release'
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
  LOCAL_API_BASE,
  getApiBase,
  setApiBase,
  normalizeBase,
  isDevToolsRuntime,
  isDevToolsSession
}
