/**
 * 划词追问（P3）：选中文本 + 本文材料 → 模型 → 页码白名单校验。
 *
 * 不编造：模型只能看到带 `[p.N]` 的材料；回答里的页码不在材料内就标红，
 * 没有有效引用就显式警告；材料不足时必须写「原文没有足够依据」。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callModel, resolveRoute } from './cardgen.js'
import { normalizeForMatch } from './evidence.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ASK_PROMPT_VERSION = 'ask-page-cited.v1'
const MAX_CONTEXT = 24000

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function loadAskPrompt() {
  return readFileSync(join(HERE, '..', 'prompts', `${ASK_PROMPT_VERSION}.md`), 'utf8')
}

function pushSnippet(snippets, page, text) {
  if (!page) return
  const value = clip(text, 180)
  if (!value) return
  const list = snippets.get(page) || []
  if (list.length >= 2 || list.includes(value)) return
  list.push(value)
  snippets.set(page, list)
}

/**
 * 组装追问材料：选中段 + 同页上下文 + 七段卡 + 证据 +（可选）对比论文。
 * 返回的 pages 是**唯一**允许出现在回答里的页码集合。
 */
export function buildAskContext({ record, card, blocks, question, selection, page, blockId, records = [] }) {
  const pages = new Set()
  const snippets = new Map()
  const parts = []

  if (page) pages.add(Number(page))
  const selected = clip(selection, 1200)
  if (selected) {
    const tag = page ? `[p.${page}] ` : ''
    parts.push(`【选中】${tag}${selected}`)
    pushSnippet(snippets, Number(page), selected)
  }

  // 解析稿：选中块 + 同页/相邻页的上下文
  const blockPages = Array.isArray(blocks?.pages) ? blocks.pages : []
  if (blockPages.length) {
    const pageIndex = new Map(blockPages.map((p) => [Number(p.page), p]))
    const current = Number(page) || (blockId ? findPageOfBlock(blockPages, blockId) : 0)
    const contextLines = []
    for (const p of [current - 1, current, current + 1]) {
      const pageDoc = pageIndex.get(p)
      if (!pageDoc) continue
      const list = Array.isArray(pageDoc.blocks) ? pageDoc.blocks : []
      let picked = list
      if (p === current && blockId) {
        const at = list.findIndex((b) => b.id === blockId)
        if (at >= 0) picked = list.slice(Math.max(0, at - 3), at + 4)
        else picked = list.slice(0, 8)
      } else {
        picked = p < current ? list.slice(-3) : list.slice(0, 3)
      }
      for (const block of picked) {
        const text = clip(block.text, 320)
        if (!text) continue
        contextLines.push(`[p.${p}] ${text}`)
        pages.add(p)
        pushSnippet(snippets, p, text)
      }
    }
    if (contextLines.length) parts.push(`【原文上下文】\n${contextLines.join('\n')}`)
  }

  // 七段卡：每段第一处证据的页码作为段前缀
  const evidence = new Map((card?.evidence || []).map((ev) => [ev.id, ev]))
  const sectionLines = []
  for (const section of card?.sections || []) {
    const evPages = (section.evidence || []).map((id) => evidence.get(id)?.page).filter(Boolean)
    const tag = evPages.length ? `[p.${evPages[0]}] ` : ''
    const text = clip(section.text, 700)
    if (!text) continue
    sectionLines.push(`【${section.title}】${tag}${text}`)
    for (const p of evPages) pages.add(p)
  }
  if (sectionLines.length) parts.push(`【七段卡】\n${sectionLines.join('\n')}`)

  const evidenceLines = []
  for (const ev of card?.evidence || []) {
    const text = clip(ev.quote, 240)
    if (!text) continue
    evidenceLines.push(`[p.${ev.page}] (${ev.id}) ${text}`)
    pages.add(Number(ev.page))
    pushSnippet(snippets, Number(ev.page), text)
  }
  if (evidenceLines.length) parts.push(`【证据】\n${evidenceLines.join('\n')}`)

  // 对比材料：问题点名了库内另一篇，才把它加进来（最多 2 篇）
  const others = []
  for (const other of records) {
    if (!other || other.id === record.id) continue
    if (mentionsPaper(question, other)) others.push(other)
    if (others.length >= 2) break
  }
  for (const other of others) {
    const otherCard = other.card
    if (!otherCard) continue
    const lines = []
    const otherEvidence = new Map((otherCard.evidence || []).map((ev) => [ev.id, ev]))
    for (const section of otherCard.sections || []) {
      const evPages = (section.evidence || []).map((id) => otherEvidence.get(id)?.page).filter(Boolean)
      const tag = evPages.length ? `[p.${evPages[0]}] ` : ''
      lines.push(`${section.title}：${tag}${clip(section.text, 380)}`)
      for (const p of evPages) pages.add(p)
    }
    if (lines.length) {
      parts.push(`【对比材料：${other.title || other.id}（${other.id}）】\n${lines.join('\n')}`)
    }
  }

  let text = parts.join('\n\n')
  if (text.length > MAX_CONTEXT) text = text.slice(0, MAX_CONTEXT)
  return {
    text,
    pages,
    snippets,
    referenced: others.map((p) => ({ id: p.id, title: p.title })),
    selected: Boolean(selected),
  }
}

function findPageOfBlock(pages, blockId) {
  for (const page of pages) {
    if ((page.blocks || []).some((b) => b.id === blockId)) return Number(page.page)
  }
  return 0
}

/** 问题里是否点名了某篇（标题片段 ≥5 字，或 citekey / paper_id）。 */
export function mentionsPaper(question, record) {
  const q = normalizeForMatch(question)
  if (!q) return false
  if (record.id && q.includes(normalizeForMatch(record.id))) return true
  if (record.citekey && record.citekey !== record.id && q.includes(normalizeForMatch(record.citekey))) return true
  const title = String(record.title || '')
  if (!title) return false
  const phrases = title.split(/[\s,，。；;：:、（）()\[\]【】“”"'’‘—–\-/]+/).filter(Boolean)
  if (phrases.some((phrase) => phrase.length >= 5 && q.includes(normalizeForMatch(phrase)))) return true
  return normalizeForMatch(title).length >= 8 && q.includes(normalizeForMatch(title))
}

/** 页码白名单校验；越界页码不进 citations，前端标红。 */
export function validateAnswer({ text, pages, snippets }) {
  const answer = String(text || '').trim()
  const allowed = new Set([...pages].map(Number))
  const cited = []
  const invalid = []
  const regex = /\[p\.\s*(\d+)\s*\]/gi
  let match = regex.exec(answer)
  while (match) {
    const page = Number(match[1])
    if (allowed.has(page)) {
      if (!cited.includes(page)) cited.push(page)
    } else if (!invalid.includes(page)) {
      invalid.push(page)
    }
    match = regex.exec(answer)
  }

  const citations = cited.map((page) => ({
    page,
    snippets: snippets?.get(page) || [],
  }))
  const warnings = []
  if (invalid.length) {
    warnings.push(`回答里有 ${invalid.length} 个页码不在本次材料内：p.${invalid.join('、p.')}，请核对`)
  }
  if (!cited.length && !/没有足够依据|没有.*依据|无法回答/.test(answer)) {
    warnings.push('回答未标注页码')
  }
  return {
    answer,
    citations,
    invalidCitations: invalid,
    warnings,
    citedPages: cited,
  }
}

export async function askPaper({ ctx, record, card, blocks, question, selection, page, blockId, records = [] }) {
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const context = buildAskContext({ record, card, blocks, question, selection, page, blockId, records })
  if (!context.text.trim()) throw fail('no_context', '没有可用的原文材料，无法追问')
  const user = [
    `【当前论文】${record.title || record.id}（${record.year || '年份未知'}，${record.id}）`,
    `【问题】${question}`,
    '',
    '【材料】',
    context.text,
  ].join('\n')
  const result = await callModel(ctx, route, loadAskPrompt(), user, null, {
    maxTokens: 6144,
    reasoningEffort: 'off',
  })
  const checked = validateAnswer({ text: result.text, pages: context.pages, snippets: context.snippets })
  return {
    ...checked,
    model: `${route.provider}/${route.model}`,
    promptVersion: ASK_PROMPT_VERSION,
    pagesUsed: [...context.pages].sort((a, b) => a - b),
    referenced: context.referenced,
    usage: result.usage || null,
    at: new Date().toISOString(),
  }
}
