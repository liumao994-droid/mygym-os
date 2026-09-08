'use strict'

/**
 * 小程序运行环境配置。
 * 规则:
 * - develop/trial(开发版/体验版):storage 手动覆盖 > DEV_API_BASE
 * - release(正式版):只允许 PROD_API_BASE,忽略手动覆盖,防止正式包连回本机。
 * 后端 URL 不含 /api;API client 统一拼接。
 *
 * 开发默认连接本机 MyGym API(需在微信开发者工具勾选「不校验合法域名」)。
 * 正式发布前把 PROD_API_BASE 改成部署的 HTTPS 域名,并在微信公众平台配置 request 合法域名。
 */

const API_BASE_STORAGE_KEY = 'mygym.apiBase'
/** 本机联调地址(开发版/体验版默认) */
const DEV_API_BASE = 'http://127.0.0.1:8787'
/** 正式后端地址。部署完成后填入 https:// 域名,例如 'https://api.example.com' */
const PROD_API_BASE = 'https://api.mygymos.cn'

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
  const resolved = normalizeBase(override || DEV_API_BASE)
  return resolved || DEV_API_BASE
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
  getApiBase,
  setApiBase,
  normalizeBase,
  isDevToolsSession
}
