'use strict'

const auth = require('../../services/auth.js')

Page({
  data: {
    mode: 'login',
    account: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    busy: false
  },

  onLoad() {
    if (auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/home/home' })
      return
    }
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value })
  },

  onMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode })
  },

  async onAccountSubmit() {
    if (this.data.busy) return
    const account = String(this.data.account || '').trim()
    const password = String(this.data.password || '')
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    if (this.data.mode === 'register') {
      const nickname = String(this.data.nickname || '').trim()
      if (!nickname) {
        wx.showToast({ title: '请输入昵称', icon: 'none' })
        return
      }
      if (password.length < 6) {
        wx.showToast({ title: '密码至少 6 位', icon: 'none' })
        return
      }
      if (password !== this.data.confirmPassword) {
        wx.showToast({ title: '两次密码输入不一致', icon: 'none' })
        return
      }
    }
    this.setData({ busy: true })
    try {
      if (this.data.mode === 'register') await auth.register(account, password, String(this.data.nickname || '').trim())
      else await auth.accountLogin(account, password)
      wx.reLaunch({ url: '/pages/home/home' })
    } catch (e) {
      wx.showModal({ title: this.data.mode === 'register' ? '注册失败' : '登录失败', content: e.message || '操作失败，请稍后重试', showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
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
          ? '微信登录暂不可用，请使用账号密码登录'
          : e.code === 'WECHAT_CODE_INVALID'
            ? '登录凭证已失效，请重试'
            : e.message || '微信登录失败，请稍后重试'
      wx.showModal({ title: '登录失败', content: message, showCancel: false })
    } finally {
      this.setData({ busy: false })
    }
  },

  onOpenLegal(e) {
    wx.navigateTo({ url: `/pages/legal/legal?type=${e.currentTarget.dataset.type}` })
  }
})
