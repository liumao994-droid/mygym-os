'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { freshWx } = require('./fakeWx.js')
const env = require('../config/env.js')

test('开发版默认连接本机后端,允许手动覆盖 API 地址', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } })
  assert.equal(env.getApiBase(), 'http://127.0.0.1:8787')

  env.setApiBase('https://dev.example.com/')
  assert.equal(env.getApiBase(), 'https://dev.example.com')
})

test('正式版忽略手动覆盖,只使用 PROD_API_BASE', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'release' } })
  env.setApiBase('http://127.0.0.1:9999')
  assert.equal(env.getApiBase(), 'https://api.mygymos.cn')
})

test('体验版按开发版规则处理,便于真机体验联调', () => {
  const wx = freshWx()
  wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'trial' } })
  env.setApiBase('https://trial.example.com')
  assert.equal(env.getApiBase(), 'https://trial.example.com')
})
