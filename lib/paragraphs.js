/**
 * 版面块 → 段落重建。
 * 目的：OCR/PDF 常把一整段拆成多块（跨页、跨栏、按行），解析稿和建链都会看到断点。
 * 这里只在读取时合并，不改 blocks.json、不改证据 id，避免破坏已有 q-id / b-id 引用。
 */
import { normalizeForMatch } from './evidence.js'

const STANDALONE = new Set(['heading1', 'heading2', 'heading3', 'title', 'caption'])
const BODY = new Set(['paragraph', 'abstract', 'body', 'text', 'list', 'quote', 'table', 'formula'])
const PAGE_NUMBER = /^\d{1,4}$/
const END_PUNCT = /[。！？!?；;：:…]$/
const BREAK_BEFORE = /^(关键词|关键字|中图分类号|DOI|Abstract|摘要|参考文献|References|作者简介|基金项目|收稿日期)[：:\s]/i
const LIST_START = /^([•·▪◦]|[-–—]\s|\d+[.、)]\s?|[一二三四五六七八九十]+[、.])/
const MAX_PARAGRAPH = 1800

function isBody(block) {
  return BODY.has(block.role) && String(block.text || '').trim()
}

function joinText(left, right) {
  const a = String(left || '').trimEnd()
  const b = String(right || '').trim()
  if (!a) return b
  if (!b) return a
  if (/[A-Za-z]-$/.test(a)) return a.slice(0, -1) + b
  const cjk = /[\u4e00-\u9fff]$/.test(a) || /^[\u4e00-\u9fff]/.test(b)
  return a + (cjk ? '' : ' ') + b
}

function shouldMerge(prev, next) {
  if (!isBody(next)) return false
  if (STANDALONE.has(next.role)) return false
  const text = prev.text.trim()
  if (!text) return false
  if (prev.text.length + next.text.length > MAX_PARAGRAPH) return false
  if (END_PUNCT.test(text)) return false
  if (LIST_START.test(next.text.trim())) return false
  if (BREAK_BEFORE.test(next.text.trim())) return false
  // 页眉页脚/页码不参与
  if (next.role === 'header' || next.role === 'footer' || PAGE_NUMBER.test(next.text.trim())) return false
  return true
}

function flush(state, out) {
  if (!state) return
  const text = state.text.trim()
  if (!text) return
  out.push({
    page: state.page,
    pageEnd: state.pageEnd,
    role: state.role,
    section: state.section || '',
    text,
    blockIds: state.blockIds,
    firstBlockId: state.blockIds[0],
  })
}

/**
 * 返回按阅读顺序的段落/标题序列。
 * 标题、图注独立成段；正文跨块、跨页续句合并。
 */
export function documentParagraphs(doc) {
  const out = []
  let current = null
  for (const page of doc?.pages || []) {
    for (const block of page.blocks || []) {
      if (block.role === 'header' || block.role === 'footer') continue
      const text = String(block.text || '').trim()
      if (!text) continue
      const pageNumber = block.page || page.page
      if (PAGE_NUMBER.test(text)) continue
      if (STANDALONE.has(block.role) || !isBody(block)) {
        flush(current, out)
        current = null
        if (STANDALONE.has(block.role)) {
          out.push({
            page: pageNumber, pageEnd: pageNumber, role: block.role,
            section: block.section || '', text,
            blockIds: [block.id], firstBlockId: block.id,
          })
        }
        continue
      }
      if (!current) {
        current = {
          page: pageNumber, pageEnd: pageNumber, role: block.role,
          section: block.section || '', text, blockIds: [block.id],
        }
        continue
      }
      if (shouldMerge(current, block)) {
        current.text = joinText(current.text, text)
        current.pageEnd = pageNumber
        current.blockIds.push(block.id)
      } else {
        flush(current, out)
        current = {
          page: pageNumber, pageEnd: pageNumber, role: block.role,
          section: block.section || '', text, blockIds: [block.id],
        }
      }
    }
  }
  flush(current, out)
  return out
}

/** 段落索引：列表 + blockId → 段落。 */
export function paragraphIndex(doc) {
  const list = documentParagraphs(doc)
  const byBlock = new Map()
  for (const paragraph of list) {
    for (const id of paragraph.blockIds) byBlock.set(id, paragraph)
  }
  return { list, byBlock }
}

/** 按引文找它所在的段落（用已建好的索引，避免重复重建）。 */
export function paragraphForQuoteInIndex(index, quote, page) {
  const needle = normalizeForMatch(quote)
  if (!needle) return null
  const list = index?.list || []
  const scoped = page ? list.filter((paragraph) => paragraph.page === page || paragraph.pageEnd === page) : list
  let best = null
  for (const paragraph of scoped) {
    const hay = normalizeForMatch(paragraph.text)
    if (!hay) continue
    if (hay.includes(needle) || needle.includes(hay)) {
      if (!best || paragraph.text.length < best.text.length) best = paragraph
    }
  }
  return best
}

/** 按引文找段落（内部建索引，单次调用用）。 */
export function paragraphForQuote(doc, quote, page) {
  return paragraphForQuoteInIndex(paragraphIndex(doc), quote, page)
}
