/**
 * PDF → 按页、按行文本（P2 起）。
 *
 * 与 pdf.js 的区别：这里用 `transform` 的 y 坐标把文字块还原成行，
 * 这样章节标题、参考文献、表格题注都能按行识别；行内按 x 排序。
 * 结果缓存到 `text/<id>.pages.json`，与 PDF 哈希绑定（PDF 不换就不重解析）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from './library.js'

const MAX_PAGES = 80
let pdfjsPromise = null

function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

const CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]'
const CJK_SPACE = new RegExp(`(${CJK})\\s+(?=${CJK})`, 'g')

/** 中文 PDF 常被逐字切片，这里把「字 与 字」之间的空隙合回去，标点两侧同理。 */
export function tidyLine(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim()
  s = s.replace(CJK_SPACE, '$1')
  s = s.replace(/\s+([，。；：、！？）】”’》〉…·])/g, '$1')
  s = s.replace(/([（【“‘《〈])\s+/g, '$1')
  s = s.replace(/([，。；：、！？）】”’》〉…·])\s+/g, '$1')
  return s
}

/** 把一页的文字块按 y 聚成行，行内按 x 排序。 */
export function groupLines(items) {
  const rows = []
  for (const item of items || []) {
    const str = typeof item?.str === 'string' ? item.str : ''
    if (!str.trim()) continue
    const t = item.transform || []
    const x = Number(t[4]) || 0
    const y = Number(t[5]) || 0
    const height = Math.abs(Number(t[3])) || item.height || 10
    const tolerance = Math.max(2, height * 0.45)
    let row = null
    for (const candidate of rows) {
      if (Math.abs(candidate.y - y) <= tolerance) { row = candidate; break }
    }
    if (!row) { row = { y, parts: [] }; rows.push(row) }
    row.parts.push({ x, text: str })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((row) => tidyLine(row.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ')))
    .filter(Boolean)
}

/**
 * 从 PDF 抽分页文本。
 * @returns {Promise<{numPages:number, pages:Array<{page:number,text:string}>, info:object}>}
 */
export async function extractPdfPages(buffer) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise

  const pages = []
  const total = Math.min(doc.numPages, MAX_PAGES)
  for (let p = 1; p <= total; p += 1) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const lines = groupLines(content.items)
    const text = lines.join('\n').replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
    pages.push({ page: p, text })
    page.cleanup()
  }

  let info = {}
  try {
    const meta = await doc.getMetadata()
    info = meta?.info || {}
  } catch { /* 元数据可选 */ }

  const numPages = doc.numPages
  await doc.destroy()
  return { numPages, pages, info, truncated: numPages > total }
}

function pagesPath(id) {
  return join(PATHS.text, `${id}.pages.json`)
}

/** 读缓存；没有就回源 PDF 解析并落盘（兼容 P1 时期只有 .txt 的旧论文）。 */
export async function loadPaperPages(record) {
  const cache = pagesPath(record.id)
  if (existsSync(cache)) {
    try {
      const data = JSON.parse(readFileSync(cache, 'utf8'))
      if (Array.isArray(data.pages) && data.pages.length) return data
    } catch { /* 缓存损坏则重建 */ }
  }
  const pdf = join(PATHS.papers, record.file)
  if (!existsSync(pdf)) {
    const err = new Error('PDF 文件缺失')
    err.code = 'pdf_missing'
    throw err
  }
  const extracted = await extractPdfPages(readFileSync(pdf))
  const data = {
    numPages: extracted.numPages,
    truncated: extracted.truncated,
    pages: extracted.pages,
    extractedAt: new Date().toISOString(),
  }
  writeFileSync(cache, JSON.stringify(data), 'utf8')
  return data
}
