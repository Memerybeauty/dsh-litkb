/**
 * P4.11 检索历史：最近 50 条，至少保留 10 条；落盘在 <库>/cache/search-history.json。
 * 只存查询与少量 ID，不存整段引文，避免库膨胀。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from './library.js'

const LIMIT = 50
const FILE = () => join(PATHS.cache, 'search-history.json')

function readAll() {
  try {
    const file = FILE()
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items) {
  try {
    if (!existsSync(PATHS.cache)) mkdirSync(PATHS.cache, { recursive: true })
    const file = FILE()
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(items.slice(0, LIMIT), null, 2), 'utf8')
    renameSync(tmp, file)
  } catch { /* history is non-critical */ }
}

/** 记录一次检索；空查询不记。返回写入项。 */
export function recordSearch(entry = {}) {
  const q = String(entry.q || '').trim().slice(0, 300)
  if (!q) return null
  const item = {
    q,
    mode: String(entry.mode || 'search').slice(0, 30),
    filters: entry.filters && typeof entry.filters === 'object' ? {
      paperId: String(entry.filters.paperId || '').slice(0, 80),
      tag: String(entry.filters.tag || '').slice(0, 80),
      yearFrom: String(entry.filters.yearFrom || '').slice(0, 8),
      yearTo: String(entry.filters.yearTo || '').slice(0, 8),
    } : {},
    chainIds: (Array.isArray(entry.chainIds) ? entry.chainIds : []).slice(0, 12).map(String),
    evidenceIds: (Array.isArray(entry.evidenceIds) ? entry.evidenceIds : []).slice(0, 12).map(String),
    citations: Number(entry.citations) || 0,
    took: Number(entry.took) || 0,
    at: new Date().toISOString(),
  }
  const items = readAll()
  items.unshift(item)
  writeAll(items)
  return item
}

export function listSearchHistory(limit = 20) {
  const count = Math.max(1, Math.min(LIMIT, Number(limit) || 20))
  return readAll().slice(0, count)
}

export function clearSearchHistory() {
  writeAll([])
  return true
}

export const SEARCH_HISTORY_LIMIT = LIMIT
