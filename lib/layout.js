/**
 * 版面块解析（P2.2 · pdf.js 兜底实现）。
 *
 * 目标：把一页 PDF 拆成「块」（标题/段落/图注/表注/页眉页脚/参考文献），
 * 每块带页码与归一化 bbox，供解析稿 ↔ 原文双向定位。
 *
 * 版面顺序（踩过的坑）：
 *   1. 整页按 y 聚行会把双栏左右两栏并成一条长行（已复现，见 docs/assets/p2.2-line-bbox-spike.png）；
 *   2. 按「整宽行」把页面切成横向区段：整宽行（标题/摘要/图注）单独成区，窄行区段再找栏缝；
 *   3. 行先按大空隙切成段（run），再整行归栏，避免整宽行被逐字拆碎；
 *   4. 双栏区段内：左栏整列先出，再出右栏。
 *
 * 解析器可替换：PaddleOCR 适配器接入后，用同一份 schema 输出即可，下游不用改。
 */
import { createHash } from 'node:crypto'
import { tidyLine } from './pdftext.js'
import { normalizeForMatch } from './evidence.js'
import { detectBoundary } from './sections.js'

const MAX_PAGES = 120
const HEADER_ZONE = 0.082
const FOOTER_ZONE = 0.93
const FULL_WIDTH_RATIO = 0.6

let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function weightedMedian(pairs) {
  if (!pairs.length) return 10
  const sorted = [...pairs].sort((a, b) => a.size - b.size)
  const total = sorted.reduce((n, p) => n + p.weight, 0)
  let acc = 0
  for (const pair of sorted) {
    acc += pair.weight
    if (acc >= total / 2) return pair.size
  }
  return sorted[sorted.length - 1].size
}

/** 整页成行：同一行内按大空隙切段，避免整宽行在栏缝处被拆碎。 */
export function buildPageLines(items) {
  const rows = []
  for (const item of items) {
    const tolerance = Math.max(2, item.h * 0.45)
    let row = null
    for (const candidate of rows) {
      if (Math.abs(candidate.anchorY - item.y) <= tolerance) { row = candidate; break }
    }
    if (!row) { row = { anchorY: item.y, items: [] }; rows.push(row) }
    row.items.push(item)
  }
  const lines = []
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.x - b.x)
    const font = median(sorted.map((i) => i.h)) || 10
    const gapLimit = Math.max(font * 1.2, 6)
    let run = []
    const flush = () => {
      if (!run.length) return
      lines.push({
        x0: Math.min(...run.map((i) => i.x)),
        x1: Math.max(...run.map((i) => i.x + i.w)),
        y0: Math.min(...run.map((i) => i.y)),
        y1: Math.max(...run.map((i) => i.y + i.h)),
        text: tidyLine(run.map((i) => i.str).join(' ')),
        font,
      })
      run = []
    }
    for (const item of sorted) {
      if (run.length) {
        const prev = run[run.length - 1]
        if (item.x - (prev.x + prev.w) > gapLimit) flush()
      }
      run.push(item)
    }
    flush()
  }
  return lines
    .filter((line) => line.text)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}

/** 在「窄行区段」里找栏缝；找不到返回 null。 */
export function detectGutterLines(lines, width) {
  // 只看真正的文本行：表格单元格、公式碎片很短，会把栏缝误判出来
  const textLines = lines.filter((line) => line.text.length >= 8)
  if (textLines.length < 6) return null
  const covered = new Uint8Array(Math.ceil(width) + 2)
  for (const line of textLines) {
    const a = Math.max(0, Math.floor(line.x0))
    const b = Math.min(covered.length - 1, Math.ceil(line.x1))
    for (let x = a; x < b; x += 1) covered[x] = 1
  }
  const from = Math.floor(width * 0.15)
  const to = Math.floor(width * 0.85)
  let best = null
  let start = -1
  for (let x = from; x < to; x += 1) {
    if (!covered[x]) {
      if (start < 0) start = x
    } else if (start >= 0) {
      const len = x - start
      if (!best || len > best.len) best = { start, end: x, len }
      start = -1
    }
  }
  if (start >= 0) {
    const len = to - start
    if (!best || len > best.len) best = { start, end: to, len }
  }
  if (!best || best.len < Math.max(width * 0.015, 10)) return null
  const gutter = (best.start + best.end) / 2
  const leftLines = textLines.filter((line) => line.x1 <= gutter + 1)
  const rightLines = textLines.filter((line) => line.x0 >= gutter - 1)
  const distinctY = (list) => new Set(list.map((line) => Math.round(line.y0 / 3))).size
  const chars = (list) => list.reduce((n, line) => n + line.text.length, 0)
  if (leftLines.length < 3 || rightLines.length < 3) return null
  if (distinctY(leftLines) < 3 || distinctY(rightLines) < 3) return null
  if (chars(leftLines) < 80 || chars(rightLines) < 80) return null
  return gutter
}

const HEADING_NUMBER = /^(?:\d{1,2}(?:\.\d{1,2})*|[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十\d]+[章节])\s+/

function isHeadingLine(line, bodyFont) {
  const text = line.text
  if (!text || text.length > 60) return false
  if (/[。；;，,、]$/.test(text)) return false
  if (/[，,、]/.test(text)) return false
  if (detectBoundary(text)) return true
  if (line.font >= bodyFont * 1.25 && text.length <= 45) return true
  if (HEADING_NUMBER.test(text) && text.length <= 45) return true
  return false
}

function isCaption(text) {
  return /^(图|表|figure|table)\s*\d+/i.test(String(text || '').trim())
}

function joinLines(parts) {
  let out = ''
  for (const part of parts) {
    if (!out) { out = part; continue }
    const prev = out[out.length - 1]
    const next = part[0]
    const bothCjk = /[\u4e00-\u9fff]/.test(prev) && /[\u4e00-\u9fff]/.test(next)
    out += bothCjk ? part : ` ${part}`
  }
  return out
}

/** 由行拼块：行距、缩进、标题/图注会截断段落；页眉页脚各自独立。 */
export function linesToBlocks(lines, bodyFont, pageHeight = 0) {
  const blocks = []
  let current = null
  const flush = () => { if (current) { blocks.push(current); current = null } }
  const makeBlock = (line, heading, caption, zone) => ({
    lines: [line], text: line.text, x0: line.x0, x1: line.x1, y0: line.y0, y1: line.y1,
    font: line.font, heading, caption, zone,
  })
  for (const line of lines) {
    const center = (line.y0 + line.y1) / 2
    const zone = pageHeight && center < pageHeight * HEADER_ZONE
      ? 'header'
      : pageHeight && center > pageHeight * FOOTER_ZONE ? 'footer' : 'body'
    if (zone !== 'body') {
      flush()
      blocks.push(makeBlock(line, false, false, zone))
      continue
    }
    const heading = isHeadingLine(line, bodyFont)
    const caption = isCaption(line.text)
    if (!current) {
      current = makeBlock(line, heading, caption, 'body')
      continue
    }
    const gap = line.y0 - current.y1
    // 段落首行缩进：续行只会更靠左（顶格）；更靠右、或明显左移（如居中单位行→左对齐摘要）才断段
    const indent = line.x0 - current.x0
    const canMerge = !heading && !caption && !current.heading && !current.caption
      && gap <= bodyFont * 2.2
      && indent <= Math.max(bodyFont * 1.2, 6)
      && indent >= -bodyFont * 3
      && current.text.length < 900
    if (canMerge) {
      current.lines.push(line)
      current.text = joinLines(current.lines.map((l) => l.text))
      current.x0 = Math.min(current.x0, line.x0)
      current.x1 = Math.max(current.x1, line.x1)
      current.y1 = Math.max(current.y1, line.y1)
      current.font = Math.max(current.font, line.font)
    } else {
      flush()
      current = makeBlock(line, heading, caption, 'body')
    }
  }
  flush()
  return blocks
}

export function makeBlockId(page, bbox, text) {
  const key = bbox.map((v) => Number(v).toFixed(3)).join(',')
  const digest = createHash('sha1')
    .update(`${page}|${key}|${normalizeForMatch(text).slice(0, 80)}`)
    .digest('hex')
  return `b-${digest.slice(0, 8)}`
}

function blockId(block, page) {
  return makeBlockId(page, [block.x0, block.y0, block.x1, block.y1], block.text)
}

/**
 * 单页 → 块。导出供单测使用。
 * @param {{page:number,width:number,height:number,rotation:number,items:Array}} page
 * @param {number} bodyFont 正文字号（全文加权中位数）
 * @param {boolean} isFirst
 * @param {string|null} initialSection 上一页结尾的章节
 */
export function blockifyPage(page, bodyFont, isFirst = false, initialSection = null, previousGutter = null) {
  const { width: W, height: H, items } = page
  const lines = buildPageLines(items)

  // 按整宽行切横向区段
  const segments = []
  for (const line of lines) {
    const type = line.x1 - line.x0 > W * FULL_WIDTH_RATIO ? 'full' : 'col'
    const last = segments[segments.length - 1]
    if (last && last.type === type) last.lines.push(line)
    else segments.push({ type, lines: [line] })
  }

  const ordered = []
  let columns = 1
  let usedGutter = null
  for (const segment of segments) {
    if (segment.type === 'full') {
      ordered.push(...linesToBlocks(segment.lines, bodyFont, H))
      continue
    }
    let gutter = detectGutterLines(segment.lines, W)
    if (!gutter && previousGutter) {
      // 同一篇论文的版式通常连续：本段没找到栏缝时，沿用上一页的栏缝
      const leftCount = segment.lines.filter((l) => l.x1 <= previousGutter + 1).length
      const rightCount = segment.lines.filter((l) => l.x0 >= previousGutter - 1).length
      if (leftCount >= 3 && rightCount >= 3) gutter = previousGutter
    }
    if (!gutter) {
      ordered.push(...linesToBlocks(segment.lines, bodyFont, H))
      continue
    }
    columns = 2
    usedGutter = gutter
    // 用原始 items 按栏缝重新成行：整行文本铺满栏宽时，行间空隙可能小于阈值，
    // 只靠 run 切分会把左右栏最后一行并起来。
    const y0 = Math.min(...segment.lines.map((l) => l.y0))
    const y1 = Math.max(...segment.lines.map((l) => l.y1))
    const inSegment = items.filter((it) => it.y + it.h > y0 && it.y < y1)
    const leftItems = []
    const rightItems = []
    for (const item of inSegment) {
      if (item.x + item.w / 2 < gutter) leftItems.push(item)
      else rightItems.push(item)
    }
    ordered.push(...linesToBlocks(buildPageLines(leftItems), bodyFont, H))
    ordered.push(...linesToBlocks(buildPageLines(rightItems), bodyFont, H))
  }

  const maxFont = Math.max(0, ...ordered.map((b) => b.font))
  const blocks = []
  let section = initialSection
  for (const block of ordered) {
    const text = block.text
    if (block.heading) {
      const boundary = detectBoundary(text)
      if (boundary && boundary.key !== 'other') section = boundary.key
    }
    if (/^(参考文献|references)\b/i.test(text)) section = 'references'

    let role = 'paragraph'
    const centerY = (block.y0 + block.y1) / 2
    const runningHeader = centerY < H * 0.12 && text.length < 90
      && /^(第\s*\d+\s*[卷期]|Vol\.|No\.|20\d{2}\s*年|\d{1,3}\s*$)/.test(text)
    if (block.zone === 'header' || runningHeader) role = 'header'
    else if (block.zone === 'footer') role = 'footer'
    else if (isFirst && block.font >= maxFont * 0.85 && block.y0 < H * 0.45 && text.length >= 6) role = 'title'
    else if (isFirst && block.font > bodyFont * 1.05 && block.y0 > H * 0.15 && block.y0 < H * 0.32 && text.length <= 40) role = 'authors'
    else if (/^(摘\s*要|abstract)/i.test(text)) role = 'abstract'
    else if (/^(关\s*键\s*词|keywords?)/i.test(text)) role = 'keywords'
    else if (block.caption) role = 'caption'
    else if (block.heading) role = 'heading1'
    else if (section === 'references') role = 'reference'

    blocks.push({
      id: blockId(block, page.page),
      role,
      section: section || (role === 'abstract' ? 'abstract' : 'other'),
      text,
      bbox: [block.x0 / W, block.y0 / H, block.x1 / W, block.y1 / H].map((v) => Number(v.toFixed(4))),
      font: Number(block.font.toFixed(1)),
      lines: block.lines.length,
    })
  }

  const seen = new Map()
  for (const block of blocks) {
    const count = seen.get(block.id) || 0
    seen.set(block.id, count + 1)
    if (count > 0) block.id = `${block.id}-${count + 1}`
  }

  const chars = blocks.reduce((n, b) => n + b.text.length, 0)
  const rawChars = items.reduce((n, it) => n + it.str.length, 0)
  const coverage = rawChars ? Math.min(1, chars / rawChars) : 0
  const quality = Number(Math.min(1, 0.5 + 0.5 * coverage).toFixed(2))

  return {
    page: page.page,
    lastSection: section,
    gutter: usedGutter,
    width: Number(W.toFixed(1)),
    height: Number(H.toFixed(1)),
    rotation: page.rotation || 0,
    columns,
    quality,
    blocks: blocks.map((b, i) => ({ ...b, order: i })),
  }
}

/** 整份 PDF → 块文档（未落盘）。 */
export async function extractBlocks(buffer) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise

  const total = Math.min(doc.numPages, MAX_PAGES)
  const rawPages = []
  const sizes = []
  for (let p = 1; p <= total; p += 1) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = []
    for (const item of content.items) {
      const str = typeof item?.str === 'string' ? item.str : ''
      if (!str.trim()) continue
      const tx = pdfjs.Util.transform(viewport.transform, item.transform)
      const h = item.height || Math.abs(item.transform?.[3]) || 10
      items.push({
        str,
        x: Number(tx[4]) || 0,
        y: (Number(tx[5]) || 0) - h,
        w: Number(item.width) || str.length * h * 0.6,
        h,
      })
      sizes.push({ size: h, weight: Math.max(1, str.trim().length) })
    }
    rawPages.push({ page: p, width: viewport.width, height: viewport.height, rotation: viewport.rotation, items })
    page.cleanup()
  }
  const numPages = doc.numPages
  await doc.destroy()

  const bodyFont = weightedMedian(sizes)
  let section = null
  let gutter = null
  const pages = rawPages.map((page) => {
    const parsed = blockifyPage(page, bodyFont, page.page === 1, section, gutter)
    section = parsed.lastSection
    gutter = parsed.gutter ?? gutter
    return parsed
  })
  const blockCount = pages.reduce((n, p) => n + p.blocks.length, 0)
  const quality = pages.length
    ? Number((pages.reduce((n, p) => n + p.quality, 0) / pages.length).toFixed(2))
    : 0
  const emptyPages = pages.filter((p) => p.blocks.length === 0).map((p) => p.page)

  return {
    schema: 1,
    parser: 'pdfjs-text@1',
    numPages,
    truncated: numPages > total,
    quality: { layout: quality, columns: pages.filter((p) => p.columns === 2).length, emptyPages },
    builtAt: new Date().toISOString(),
    pages,
    stats: { pages: pages.length, blocks: blockCount, bodyFont: Number(bodyFont.toFixed(1)) },
  }
}
