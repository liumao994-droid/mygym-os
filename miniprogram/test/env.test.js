'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { freshWx } = require('./fakeWx.js')
const env = require('../config/env.js')

test('开发者工具默认连接 Railway,允许手动覆盖 API 地址', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } })
  wx.getDeviceInfo = () => ({ platform: 'devtools' })
  assert.equal(env.getApiBase(), 'https://mygym-os-production.up.railway.app')

  env.setApiBase('https://dev.example.com/')
  assert.equal(env.getApiBase(), 'https://dev.example.com')
})

test('正式版忽略手动覆盖,只使用 PROD_API_BASE', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
  wx.getDeviceInfo = () => ({ platform: 'devtools' })
  env.setApiBase('http://127.0.0.1:9999')
  assert.equal(env.getApiBase(), 'https://mygym-os-production.up.railway.app')
})

test('真机体验版固定连接 Railway,忽略手动覆盖', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'trial' } })
  env.setApiBase('https://trial.example.com')
  assert.equal(env.getApiBase(), 'https://mygym-os-production.up.railway.app')
})

test('真机忽略任意旧覆盖,开发者工具仍可受控覆盖', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'trial' } })
  wx.storage.set(env.API_BASE_STORAGE_KEY, 'https://old.example.com')
  assert.equal(env.getApiBase(), 'https://mygym-os-production.up.railway.app')
  wx.getDeviceInfo = () => ({ platform: 'devtools' })
  assert.equal(env.getApiBase(), 'https://old.example.com')
})
