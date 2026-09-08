# MyGym OS 微信小程序客户端

本目录是独立的原生微信小程序工程,与现有 Web 前端(root)和后端(`server/`)隔离。
当前仓库结构:

```text
mygym-os/
├── src/                 # 现有 Web(React)保持不变
├── server/              # 共用后端 REST API
├── miniprogram/         # 微信小程序客户端(本目录)
└── miniprogram/README.md
```

小程序不保存业务数据,也不直接连 AI Provider。它只调用后端 `/api`,与 Web 共用:

- 身份:微信 code → 后端 code2session → 统一 JWT(Bearer token)
- 数据:同一 REST 契约,服务端按 JWT 中的 userId 强制隔离
- AI:仅调用后端代理,API Key / 额度都在服务端

## 本地联调

1. 启动后端:

```bash
cd server
npm install
DEV_AUTH_ENABLED=true npm run dev
```

2. 用微信开发者工具导入本目录(`miniprogram/`),AppID 可先用测试号或 `touristappid`。
3. 在开发者工具「详情 → 本地设置」勾选「不校验合法域名…」,才能访问本机
   `http://127.0.0.1:8787`。
4. 登录页可先使用「开发联调登录」验证 Web/小程序共用后端;正式微信登录需要下面的平台配置。

运行小程序端单元测试(用假 wx 环境,不需要开发者工具):

```bash
cd miniprogram
npm test
```

## 后端微信登录

后端 `POST /api/auth/wechat` 接收 `wx.login()` 的临时 `code`,
使用环境变量中的 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 调微信 code2session,
再把 openid 映射到 MyGym 用户:

```text
小程序 wx.login → code
  → POST /api/auth/wechat
    → 后端用 AppSecret 换 openid(密钥不进小程序)
      → auth_identities 找/建用户
        → 签发统一 JWT → 小程序以 Bearer token 访问数据
```

服务端凭据只在 `server/.env.example` / 环境变量中配置:

```bash
WECHAT_APP_ID=wx...          # 微信公众平台的 AppID
WECHAT_APP_SECRET=...        # 微信公众平台的 AppSecret(只保存在后端)
DEV_AUTH_ENABLED=false       # 正式环境关闭联调登录
ALLOWED_ORIGINS=https://your-web-domain  # 浏览器来源白名单
```

## 正式上线需要人工完成的平台步骤

以下操作必须在微信公众平台/开发者账号完成,代码无法代办,也不要在这里贴密钥:

1. 到微信公众平台注册/认证小程序,取得真实 **AppID**(代码里 `touristappid` 只是游客占位)。
2. 在公众平台生成 **AppSecret**,只填入后端环境变量,不进入小程序代码或 Git。
3. 在公众平台配置 **request 合法域名**,加入部署后的 MyGym API HTTPS 域名。
4. 用真实 AppID 重新导入/预览本目录,完成开发者账号与设备授权。

完成后需要告知的信息(不需要密钥):

- 你的真实 AppID
- 后端线上 HTTPS API 域名
- 是否已把该域名加入 request 合法域名

## 小程序页面(第一阶段)

- `pages/login/login`:微信登录 + 本地联调登录 + API 地址设置
- `pages/home/home`:当前用户、四类运动最近记录、AI 额度入口
- `pages/sandbox/sandbox`:登录后运行完整 CRUD 自检(创建/读回/修改/删除)

后续页面迁移(力量训练、羽毛球、游泳、网球、历史、报告)都复用
`services/data.js` 与 `services/ai.js`,不重复编写请求逻辑。
