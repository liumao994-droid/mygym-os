'use strict'

const env = require('../../config/env.js')
const auth = require('../../services/auth.js')

Page({
  data: {
    apiBase: '',
    nickname: '小程序联调用户',
    canDevLogin: false,
    devOpen: false,
    busy: false
  },

  onLoad() {
    if (auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
    this.setData({
      apiBase: env.getApiBase(),
      canDevLogin: auth.canUseDevLogin()
    })
  },

  onBaseInput(e) {
    this.setData({ apiBase: e.detail.value })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onToggleDev() {
    this.setData({ devOpen: !this.data.devOpen })
  },

  onSaveBase() {
    env.setApiBase(this.data.apiBase)
    this.setData({ apiBase: env.getApiBase() })
    wx.showToast({ title: 'API 地址已保存', icon: 'success' })
  },

  async onWechatLogin() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      await auth.wechatLogin()
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      const message =
        e.code === 'WECHAT_NOT_CONFIGURED'
          ? '后端尚未配置 WECHAT_APP_ID / WECHAT_APP_SECRET'
          : e.code === 'WECHAT_CODE_INVALID'
            ? '登录凭证已失效,请重试'
            : e.message || '微信登录失败'
      wx.showModal({ title: '登录失败', content: message, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  async onDevLogin() {
    if (this.data.busy || !this.data.canDevLogin) return
    this.setData({ busy: true })
    try {
      await auth.devLogin(this.data.nickname)
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      wx.showModal({ title: '联调登录失败', content: e.message || '请确认后端开发登录已开启', showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  }
})
