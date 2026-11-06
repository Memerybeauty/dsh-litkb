/**
 * 证据块（P2）：把模型给出的引文回贴到原文，生成稳定的块 ID。
 *
 * 三条硬规则：
 * 1. 引文必须能在分页原文里找到，找不到就丢弃并记警告（不猜、不编）；
 * 2. 页码以原文定位结果为准，模型给的页码只当提示；
 * 3. 块 ID 由引文内容哈希得到，重跑不变（FR-702）。
 */
import { createHash } from 'node:crypto'

/** 匹配时忽略空白与标点；中文 PDF 逐字空格、英文换行都不再是问题。 */
const STRIP_CHAR = /[\s\u00a0\u3000，。；：、！？“”‘’（）《》〈〉【】—…·,.;:!?"'()\[\]{}<>/\\|~`@#$%^&*+=_-]/

/** 归一化：去空白与标点、转小写。用于搜索与块 ID。 */
export function normalizeForMatch(text) {
  let out = ''
  const source = String(text || '')
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (STRIP_CHAR.test(ch)) continue
    out += ch.toLowerCase()
  }
  return out
}

/** 归一化文本 + 每个字符在原文中的下标（用于把命中位置还原成原文切片）。 */
export function buildNormalized(text) {
  const chars = []
  const map = []
  const source = String(text || '')
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (STRIP_CHAR.test(ch)) continue
    chars.push(ch.toLowerCase())
    map.push(i)
  }
  return { norm: chars.join(''), map }
}

/** 预建整篇的分页索引，一次生成里复用。 */
export function buildPageIndex(pages) {
  return (pages || []).map((page) => {
    const { norm, map } = buildNormalized(page.text)
    return { page: page.page, text: page.text, norm, map }
  })
}

function sliceByNorm(entry, index, length) {
  const start = entry.map[index]
  const last = Math.min(index + length - 1, entry.map.length - 1)
  const end = entry.map[last] + 1
  return { page: entry.page, start, end, quote: entry.text.slice(start, end) }
}

/**
 * 在原文里定位一段引文。先精确匹配整段，失败再退到「前缀匹配」，
 * 仍失败返回 null（调用方据此丢弃证据）。
 * @param {string} quote
 * @param {ReturnType<typeof buildPageIndex>} index
 * @param {number} [hintPage] 模型给的页码，优先在那一页找
 */
export function locateQuote(quote, index, hintPage) {
  const needle = normalizeForMatch(quote)
  if (needle.length < 10) return null

  const ordered = []
  if (hintPage) ordered.push(...index.filter((p) => p.page === hintPage))
  ordered.push(...index.filter((p) => p.page !== hintPage))

  for (const entry of ordered) {
    const at = entry.norm.indexOf(needle)
    if (at >= 0) return { ...sliceByNorm(entry, at, needle.length), match: 'exact' }
  }

  // 模型偶尔会截断或改写尾部；用足够长的前缀找回位置，再按原文长度截取。
  const lengths = [Math.floor(needle.length * 0.8), 40, 28, 18]
  for (const len of lengths) {
    if (len < 16 || len >= needle.length) continue
    const prefix = needle.slice(0, len)
    for (const entry of ordered) {
      const at = entry.norm.indexOf(prefix)
      if (at >= 0) {
        return { ...sliceByNorm(entry, at, Math.min(needle.length, entry.norm.length - at)), match: 'prefix' }
      }
    }
  }
  return null
}

/** 引文前后的上下文，用于「防止断章取义」（FR-704）。 */
export function contextAround(pageText, start, end, radius = 90) {
  const text = String(pageText || '')
  return {
    before: text.slice(Math.max(0, start - radius), start).trim(),
    after: text.slice(end, Math.min(text.length, end + radius)).trim(),
  }
}

/** 块 ID：`q-` + 归一化引文的 8 位哈希，同一引文重跑不变。 */
export function quoteId(quote) {
  const digest = createHash('sha1').update(normalizeForMatch(quote)).digest('hex')
  return `q-${digest.slice(0, 8)}`
}

/** 生成一条证据记录（含页码、上下文、块 ID）。 */
export function makeEvidence(pageEntry, located) {
  const { page, text } = pageEntry
  const { before, after } = contextAround(text, located.start, located.end)
  return {
    id: quoteId(located.quote),
    page,
    quote: located.quote,
    before,
    after,
    kind: 'author_claim',
  }
}
