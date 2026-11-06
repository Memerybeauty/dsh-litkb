/**
 * 版面块存储（P2.2）：`blocks/<id>.json` 是真源，Markdown 是导出格式。
 * 与卡片的关系：卡片里的 `^q-xxxx` 引文块可以挂到 `b-xxxx` 版面块上，
 * 点证据就能高亮原文那句话所在的矩形。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, upsert } from './library.js'
import { extractBlocks } from './layout.js'
import { parsePdfWithPaddle } from './paddle.js'
import { paddleCredentials } from './settings.js'
import { normalizeForMatch } from './evidence.js'

export function blocksPath(id) {
  return join(PATHS.blocks, `${id}.json`)
}

export function readBlocks(id) {
  const file = blocksPath(id)
  if (!existsSync(file)) return null
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    return doc && Array.isArray(doc.pages) ? doc : null
  } catch {
    return null
  }
}

export function blocksSummary(doc) {
  if (!doc) return null
  return {
    parser: doc.parser,
    pages: doc.numPages,
    blocks: doc.stats?.blocks ?? 0,
    quality: doc.quality?.layout ?? 0,
    builtAt: doc.builtAt,
  }
}

/** 构建（或强制重建）一篇的版面块，并写回索引摘要。 */
export async function ensureBlocks(record, { force = false, backend = 'auto', onProgress } = {}) {
  if (!force) {
    const cached = readBlocks(record.id)
    if (cached) return cached
  }
  const pdf = join(PATHS.papers, record.file)
  if (!existsSync(pdf)) {
    const error = new Error('PDF 文件缺失，无法解析版面')
    error.code = 'pdf_missing'
    throw error
  }
  const buffer = readFileSync(pdf)
  const credentials = paddleCredentials()
  const preferPaddle = backend !== 'pdfjs' && credentials.enabled && credentials.token
  let doc
  if (preferPaddle) {
    try {
      doc = await parsePdfWithPaddle(buffer, { onProgress, filename: record.file })
    } catch (error) {
      if (backend === 'paddle') throw error
      doc = await extractBlocks(buffer)
      doc.fallback = {
        from: `paddleocr/${credentials.model}`,
        code: error?.code || 'error',
        message: String(error?.message || error),
      }
    }
  } else {
    doc = await extractBlocks(buffer)
  }
  if (!existsSync(PATHS.blocks)) mkdirSync(PATHS.blocks, { recursive: true })
  writeFileSync(blocksPath(record.id), JSON.stringify(doc), 'utf8')
  doc.paperId = record.id
  upsert({ ...record, blocks: blocksSummary(doc) })
  return doc
}

/** 在某一页找到包含该引文的版面块（用于给旧卡片补 block 指针）。 */
/** 给卡片证据补/修 block ID；返回是否有改动。 */
export function repairEvidenceBlocks(card, doc) {
  if (!card || !doc) return false
  const known = new Set()
  for (const page of doc.pages || []) for (const block of page.blocks || []) known.add(block.id)
  let changed = false
  for (const ev of card.evidence || []) {
    if (!ev.block && ev.page) {
      const block = findBlockForQuote(doc, ev.page, ev.quote)
      if (block) { ev.block = block.id; changed = true }
    }
    if (ev.block && !known.has(ev.block)) {
      const repaired = findBlockForQuote(doc, ev.page, ev.quote)
      if (repaired) { ev.block = repaired.id; ev.blockRepaired = true; changed = true }
      else { ev.blockMissing = true; changed = true }
    } else if (ev.blockMissing) {
      ev.blockMissing = false
      changed = true
    }
  }
  return changed
}

export function findBlockForQuote(doc, page, quote) {
  if (!doc || !page || !quote) return null
  const needle = normalizeForMatch(quote)
  if (needle.length < 8) return null
  const pageDoc = (doc.pages || []).find((p) => p.page === Number(page))
  if (!pageDoc) return null
  // 跨块引文（例如正文 + 下一节标题）整段匹配不上；退到足够长的前缀，
  // 至少把高亮落到引文开始的那个块。
  const needles = [needle]
  for (const length of [80, 60, 40, 24]) {
    if (needle.length > length) needles.push(needle.slice(0, length))
  }
  let best = null
  for (const block of pageDoc.blocks || []) {
    // 表格块常带 <td>/<tr> 标签；去掉标签再归一，避免 "w/o SAAG</td><td>69.88" 匹配不上。
    const plain = String(block.text || '').replace(/<[^>]+>/g, ' ')
    const hay = normalizeForMatch(plain)
    const at = needles.findIndex((candidate) => hay.includes(candidate))
    if (at < 0) continue
    const score = at === 0 ? 1000 : needles[0].length - needles[at].length
    if (!best || score > best.score || (score === best.score && plain.length < best.plain.length)) {
      best = { block, plain, score }
    }
  }
  return best ? best.block : null
  return best
}

/** 解析稿 Markdown：块锚点 + 页码，Obsidian 可读。 */
export function renderParsedMarkdown(doc, record) {
  const lines = [
    '---',
    `paper_id: ${JSON.stringify(record.id)}`,
    `title: ${JSON.stringify(record.title || '')}`,
    `pages: ${doc.numPages}`,
    `parser: ${JSON.stringify(doc.parser)}`,
    `layout_quality: ${doc.quality?.layout ?? 0}`,
    `built_at: ${JSON.stringify(doc.builtAt || '')}`,
    '---',
    '',
    `# ${record.title || '解析稿'}`,
    '',
  ]
  for (const page of doc.pages || []) {
    const blocks = (page.blocks || []).filter((b) => b.role !== 'header' && b.role !== 'footer')
    if (!blocks.length) continue
    lines.push(`## p.${page.page}`, '')
    for (const block of blocks) {
      lines.push(`<!-- b:${block.id} p:${page.page} -->`)
      if (block.role === 'heading1') lines.push(`### ${block.text}`)
      else if (block.role === 'caption') lines.push(`> ${block.text}`)
      else lines.push(block.text)
      lines.push('')
    }
  }
  return lines.join('\n')
}
