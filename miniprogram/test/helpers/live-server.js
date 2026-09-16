'use strict'

/**
 * Phase 2B 专用:在隔离端口 + 临时数据库上启动真实 MyGym API(src/index.ts)。
 * - 绝不触碰 server-data/mygym.db(用户真实本地数据);
 * - 仅供自动化测试使用,不改变任何部署/域名/云端配置。
 */

const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..')
const SERVER_DIR = path.join(WORKSPACE_ROOT, 'server')
const TSX_CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', () => resolve(findFreePort(preferred + 1)))
    srv.listen(preferred, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

async function probeHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch (e) {
    return false
  }
}

/**
 * 启动隔离服务器。返回 { ok, reason?, port, req, stop, tmpDir }。
 * req(method, path, { token, body, query }) → { status, body, bytes }
 */
async function startIsolatedServer() {
  if (!fs.existsSync(TSX_CLI)) {
    return { ok: false, reason: `缺少 tsx:${TSX_CLI}` }
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygym-phase2b-'))
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await findFreePort(8791)
    const child = spawn(
      process.execPath,
      [TSX_CLI, 'src/index.ts'],
      {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          DB_FILE: path.join(tmpDir, 'phase2b.db'),
          DEV_AUTH_ENABLED: 'true'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    let exited = null
    child.once('exit', (code) => { exited = code })

    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      if (exited !== null) break
      if (await probeHealth(port)) break
      await sleep(250)
    }
    if (exited === null && (await probeHealth(port))) {
      return { ok: true, port, tmpDir, child, stderr: () => stderr }
    }
    try { child.kill('SIGKILL') } catch (e) { /* 已退出 */ }
    if (/EADDRINUSE/i.test(stderr)) continue
    return { ok: false, reason: `服务启动失败(exit=${exited}): ${stderr.slice(-500)}`, tmpDir }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
  return { ok: false, reason: '连续 3 次未能取得可用端口' }
}

function makeRequester(port) {
  return async function req(method, apiPath, { token, body, query } = {}) {
    const url = new URL(`http://127.0.0.1:${port}/api${apiPath}`)
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    })
    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch (e) { parsed = text }
    return { status: res.status, body: parsed, bytes: Buffer.byteLength(text) }
  }
}

async function stopServer(handle) {
  if (!handle) return
  if (handle.child) {
    const child = handle.child
    const waitForExit = (timeoutMs) => Promise.race([
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve()
        else child.once('exit', resolve)
      }),
      sleep(timeoutMs)
    ])
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM') } catch (e) { /* 已退出 */ }
      await waitForExit(3000)
    }
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch (e) { /* 已退出 */ }
      await waitForExit(1000)
    }
    if (child.stdout) child.stdout.destroy()
    if (child.stderr) child.stderr.destroy()
  }
  if (handle.tmpDir) {
    try { fs.rmSync(handle.tmpDir, { recursive: true, force: true }) } catch (e) { /* 尽力清理 */ }
  }
}

module.exports = { startIsolatedServer, makeRequester, stopServer, sleep }
