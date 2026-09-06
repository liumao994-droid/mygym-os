# MyGym OS 部署指南

MyGym OS 是纯前端静态应用(Vite + React + IndexedDB 本地存储),
构建产物为 `dist/` 目录,可部署到任何静态网站托管平台,无需服务器和数据库。

## 核心特性

- **本地优先**:每位用户的数据存储在自己设备的浏览器(IndexedDB)中,
  不同用户、不同设备的数据天然彼此独立,服务器不接触任何训练数据。
- **零账号**:无需注册登录,打开即用。
- **离线可用**:内置 Service Worker(PWA),首次访问后可离线打开、可安装到主屏幕。
- **HashRouter**:路由使用 `#/` 前缀,静态托管无需任何 SPA rewrite 规则也能直接使用。

## 本地构建

```bash
npm install
npm run build     # 产物输出到 dist/
npm run preview   # 本地预览生产构建(http://localhost:4173)
```

## 一键部署

### Netlify(推荐,已内置 netlify.toml)

1. 将仓库推送到 GitHub/GitLab。
2. Netlify → Add new site → Import an existing project → 选择仓库。
3. 构建命令与发布目录会自动读取 `netlify.toml`(`npm run build` / `dist`)。
4. Deploy。

### Vercel(已内置 vercel.json)

1. Vercel → Add New → Project → 导入仓库,框架预设选 **Vite**(或 Other)。
2. 其余保持默认,`vercel.json` 已声明构建命令与输出目录。
3. Deploy。

### Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- 其余默认即可。

### GitHub Pages(子路径部署)

GitHub Pages 默认部署在 `https://<user>.github.io/<repo>/` 子路径下,
需要在 `vite.config.ts` 中设置 base:

```ts
export default defineConfig({
  base: '/<repo>/',
  // ...
})
```

然后以 GitHub Actions 或 `gh-pages` 分支方式发布 `dist/`。
注意:PWA 的 Service Worker 作用域同样受子路径影响,`base` 必须正确设置。

### 任意静态服务器 / 对象存储

把 `dist/` 目录整体上传到任意静态托管(Nginx、OSS、COS、S3 等)即可。
应用使用 HashRouter,无需配置 404 回退;若托管平台支持,建议将
`/index.html` 设为默认首页、`sw.js` 不缓存。

## 数据与隐私

- 所有训练数据仅存在于用户浏览器本地,应用不上传任何数据到服务器。
- 用户可通过「我的 → 数据」自助导出 JSON 完整备份 / CSV 明细,或在新设备导入恢复。
- 可选的「AI 深度分析」功能默认关闭;启用后仅在用户主动点击分析时,
  将当期统计摘要发送到用户自行配置的 AI 接口,与部署方无关。

## 常见问题

**Q: 部署后打开是空白页?**
确认访问的是根路径(或 `/#/`);若部署在子路径,必须设置 `base`(见上)。

**Q: 更新版本后页面还是旧的?**
Service Worker 默认 `autoUpdate`,刷新一次即会拉取新版本;
如需立即生效可在浏览器 DevTools → Application → Service Workers 中 Unregister。

**Q: 换设备数据会同步吗?**
不会。数据按设备隔离是产品设计;迁移请使用「我的 → 数据 → 导出 JSON / 导入 JSON」。
