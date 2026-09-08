import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 轻量 .env 加载器:仅在启动入口调用。
 * 已有环境变量优先,文件里已有的密钥不会被覆盖。
 * 支持 `KEY=value`、`export KEY=value`、单双引号与 # 注释。
 */
export function loadEnvFile(file = resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined && process.env[key] !== '') continue
    let value = rawValue.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
