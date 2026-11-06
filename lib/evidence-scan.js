/**
 * 证据收尾（P2.6）：反链扫描与导出。
 * 反链只扫 `cards/*.md` 与 `exports/*.md`，按文件 mtime/size 缓存行内容。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PATHS } from './library.js'

const cache = new Map()

function linesOf(file) {
  const info = statSync(file)
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.lines
  const lines = readFileSync(file, 'utf8').split('\n')
  cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, lines })
  return lines
}

/**
 * 找某条证据被哪些 Markdown 引用。
 * @param {string} quoteId 形如 q-1a2b3c4d
 * @param {{ excludeCard?: string }} options 排除证据自己的卡片
 */
export function findBacklinks(quoteId, { excludeCard } = {}) {
  const marker = `^${quoteId}`
  const links = []
  for (const dir of [PATHS.cards, PATHS.drafts, PATHS.exports]) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const file = join(dir, name)
      if (excludeCard && file === excludeCard) continue
      let lines
      try { lines = linesOf(file) } catch { continue }
      lines.forEach((line, index) => {
        if (!line.includes(marker)) return
        links.push({
          file: relative(PATHS.root, file),
          line: index + 1,
          text: line.trim().slice(0, 240),
        })
      })
    }
  }
  return links
}

/** 卡片证据 → 导出行。 */
export function evidenceRows(record, card) {
  return (card?.evidence || []).map((ev) => ({
    paper_id: record.id,
    title: record.title || '',
    page: ev.page ?? '',
    block: ev.block || '',
    quote: ev.quote || '',
    before: ev.before || '',
    after: ev.after || '',
    section: ev.section || '',
  }))
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** CSV（带 UTF-8 BOM，Excel 打开中文不乱码）。 */
export function evidenceCsv(rows) {
  const header = ['paper_id', 'title', 'page', 'block', 'quote', 'before', 'after', 'section']
  const body = rows.map((row) => header.map((key) => csvCell(row[key])).join(','))
  return `\uFEFF${[header.join(','), ...body].join('\n')}\n`
}
