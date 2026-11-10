/**
 * 本地设置（不入库、不入仓库）：`<库>/settings.json`。
 * 目前只有 PaddleOCR 令牌与模型；写盘后 chmod 600。
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from './library.js'

export const DEFAULT_PADDLE_MODEL = 'PaddleOCR-VL-1.6'

export function settingsPath() {
  return join(PATHS.root, 'settings.json')
}

export function readSettings() {
  const file = settingsPath()
  if (!existsSync(file)) return {}
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function writeSettings(patch) {
  const current = readSettings()
  const next = { ...current, ...patch }
  if (patch.paddle) next.paddle = { ...(current.paddle || {}), ...patch.paddle }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  try { chmodSync(settingsPath(), 0o600) } catch { /* 非 POSIX 忽略 */ }
  return next
}

/** 给前端看的摘要：永远不回传 token 本身。 */
export function publicSettings() {
  const settings = readSettings()
  const envToken = process.env.PADDLEOCR_ACCESS_TOKEN
  const token = envToken || settings.paddle?.token || ''
  return {
    library: PATHS.root,
    autoIngest: settings.autoIngest !== false,
    paddle: {
      configured: Boolean(token),
      source: envToken ? 'env' : settings.paddle?.token ? 'settings' : '',
      model: settings.paddle?.model || process.env.PADDLEOCR_MODEL || DEFAULT_PADDLE_MODEL,
      enabled: settings.paddle?.enabled !== false,
    },
  }
}

/** 解析器实际使用的令牌与模型。 */
export function paddleCredentials() {
  const settings = readSettings()
  return {
    token: process.env.PADDLEOCR_ACCESS_TOKEN || settings.paddle?.token || '',
    model: settings.paddle?.model || process.env.PADDLEOCR_MODEL || DEFAULT_PADDLE_MODEL,
    enabled: settings.paddle?.enabled !== false,
  }
}
