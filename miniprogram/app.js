const session = require('./utils/session.js')

App({
  globalData: {
    user: null
  },

  onLaunch() {
    const stored = session.getStoredAuth()
    this.globalData.user = stored ? stored.user : null
  }
})
