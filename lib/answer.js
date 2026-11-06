/**
 * P4.11 链优先问答：先检索链/证据，再生成可追溯答案。
 * 没有模型时退化为抽取式答案；任何答案都必须带库内 q-id 引用。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callModel, resolveRoute } from './cardgen.js'
import { searchLibrary } from './search.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROMPT = 'chain-answer.v1'
const CITATION = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|([^\]]*))?\]\]/g
const HAS_CITATION = /\[\[p-[a-zA-Z0-9_-]+#\^q-[0-9a-f]{8}(?:\|[^\]]*)?\]\]/

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function loadAnswerPrompt() {
  return readFileSync(join(HERE, '..', 'prompts', `${PROMPT}.md`), 'utf8')
}

function labelOf(item) {
  const author = String(item.authors || '').split(/[,，;；、]/)[0].trim() || 'Anon'
  const year = item.year || ''
  return `${author} ${year}, p.${item.page}`.replace(/\s+/g, ' ').trim()
}

function citationKey(paperId, evidenceId) {
  return `${paperId}#${evidenceId}`
}

function collectAllowed(search) {
  const map = new Map()
  for (const chain of search.chains || []) {
    for (const citation of chain.citations || []) {
      if (!citation.evidenceId) continue
      map.set(citationKey(citation.paperId, citation.evidenceId), { ...citation, chainId: chain.id })
    }
  }
  for (const item of search.evidence || []) {
    if (!item.evidenceId) continue
    const key = citationKey(item.paperId, item.evidenceId)
    if (!map.has(key)) map.set(key, { ...item, chainId: item.chainIds?.[0] || '' })
  }
  return map
}

function keysInText(text) {
  const keys = []
  const seen = new Set()
  const regex = new RegExp(CITATION.source, 'g')
  let match = regex.exec(String(text || ''))
  while (match) {
    const key = citationKey(match[1], match[2])
    if (!seen.has(key)) { seen.add(key); keys.push(key) }
    match = regex.exec(String(text || ''))
  }
  return keys
}

function extractiveAnswer(search) {
  const parts = []
  if (search.chains.length) {
    for (const chain of search.chains.slice(0, 3)) {
      const rows = []
      for (const citation of chain.citations.filter((item) => !item.stale).slice(0, 3)) {
        rows.push(`「${clip(citation.quote, 160)}」[[${citation.paperId}#^${citation.evidenceId}|${labelOf(citation)}]]`)
      }
      if (!rows.length) continue
      parts.push(`**${chain.claim || chain.title}**\n\n${rows.join('\n\n')}`)
    }
  }
  if (!parts.length && search.evidence.length) {
    for (const item of search.evidence.slice(0, 5)) {
      parts.push(`「${clip(item.quote, 180)}」[[${item.paperId}#^${item.evidenceId}|${labelOf(item)}]]`)
    }
  }
  if (!parts.length) {
    return { answer: '库内证据不足以回答这个问题。可以换关键词、补建链，或先给相关论文生成七段卡/精读。', citations: [], warnings: ['没有检索到相关证据'] }
  }
  const answer = parts.join('\n\n')
  return { answer, citations: keysInText(answer), warnings: ['没有可用模型，已返回证据摘录（未做综合）'] }
}

function buildContext(search) {
  const lines = []
  for (const chain of search.chains.slice(0, 5)) {
    lines.push(`【链 ${chain.id}】${chain.title}`)
    lines.push(`论点：${chain.claim || '（未写）'}`)
    for (const citation of chain.citations.filter((item) => !item.stale).slice(0, 6)) {
      lines.push(`- ${citation.evidenceId} | ${citation.title} | p.${citation.page} | ${clip(citation.quote, 420)}`)
    }
    lines.push('')
  }
  if (!search.chains.length) {
    lines.push('【没有命中的链，下面是候选证据】')
    for (const item of search.evidence.slice(0, 8)) {
      lines.push(`- ${item.evidenceId} | ${item.title} | p.${item.page} | ${clip(item.quote, 420)}`)
    }
  }
  return lines.join('\n').slice(0, 24000)
}

function validateModelAnswer(text, allowed) {
  const warnings = []
  const invalid = []
  const valid = []
  const seen = new Set()
  let match = CITATION.exec(text)
  while (match) {
    const key = citationKey(match[1], match[2])
    if (!allowed.has(key)) {
      if (!invalid.includes(key)) invalid.push(key)
    } else if (!seen.has(key)) {
      seen.add(key)
      valid.push(key)
    }
    match = CITATION.exec(text)
  }
  if (invalid.length) warnings.push(`回答引用了 ${invalid.length} 个不在本次证据内的 q-id，已标记，请核对`)
  const plain = text.replace(CITATION, (full) => {
    const key = citationKey(full.match(/^\[\[(p-[^#]+)#\^(q-[0-9a-f]{8})/)?.[1] || '', full.match(/\^(q-[0-9a-f]{8})/)?.[1] || '')
    return allowed.has(key) ? full : ''
  })
  if (!valid.length) warnings.push('回答没有有效 q-id 引用')
  const uncited = String(text || '')
    .split(/(?<=[。！？.!?])\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12 && !/^#/.test(sentence) && !HAS_CITATION.test(sentence))
  if (uncited.length) warnings.push(`有 ${uncited.length} 句没有引用，请核对`)
  return { text: plain, valid, invalid, warnings, uncited: uncited.length }
}

function citationList(keys, allowed) {
  return keys.map((key) => allowed.get(key)).filter(Boolean).map((item) => ({
    paperId: item.paperId, title: item.title, authors: item.authors, year: item.year,
    page: item.page, block: item.block, evidenceId: item.evidenceId, quote: item.quote,
    chainId: item.chainId || '',
  }))
}

/**
 * 主入口：检索 → 模型/抽取 → 引用校验。
 */
export async function answerQuestion({ ctx, question, filters = {}, limit = 10 } = {}) {
  const q = clip(question, 400)
  if (!q) throw fail('empty_question', '请先输入问题')
  const search = searchLibrary(q, { ...filters, limit })
  const allowed = collectAllowed(search)
  const chains = search.chains.map((chain) => ({
    id: chain.id, title: chain.title, claim: chain.claim, status: chain.status,
    origin: chain.origin, confidence: chain.confidence, score: chain.score,
    paperIds: chain.paperIds, citations: chain.citations.filter((item) => !item.stale),
  }))
  const trace = [
    ...search.chains.map((chain) => ({ chainId: chain.id, score: chain.score, matched: chain.matched, evidence: chain.citations.map((item) => item.evidenceId) })),
    ...search.evidence.slice(0, 12).map((item) => ({ chainId: item.chainIds?.[0] || '', evidenceId: item.evidenceId, score: item.score, matched: item.matched })),
  ]
  const route = resolveRoute(ctx)
  if (!route) {
    const fallback = extractiveAnswer({ ...search, chains })
    return {
      question: q, mode: 'extractive', answer: fallback.answer,
      citations: citationList(fallback.citations || [], allowed),
      chains, evidence: search.evidence.slice(0, 12), trace,
      warnings: fallback.warnings, model: null, took: search.took,
    }
  }
  const context = buildContext({ ...search, chains })
  const user = [`【问题】${q}`, '', '【证据链与证据】', context || '（无）'].join('\n')
  try {
    const result = await callModel(ctx, route, loadAnswerPrompt(), user, null, { maxTokens: 1600, reasoningEffort: 'off' })
    const checked = validateModelAnswer(result.text || '', allowed)
    if (!checked.valid.length) {
      const fallback = extractiveAnswer({ ...search, chains })
      return {
        question: q, mode: 'extractive', answer: fallback.answer,
        citations: citationList(fallback.citations || [], allowed),
        chains, evidence: search.evidence.slice(0, 12), trace,
        warnings: [...checked.warnings, ...fallback.warnings, '模型回答没有有效引用，已改用证据摘录'],
        model: `${route.provider}/${route.model}`, took: search.took,
      }
    }
    return {
      question: q, mode: 'chain-answer', answer: checked.text,
      citations: citationList(checked.valid, allowed),
      chains, evidence: search.evidence.slice(0, 12), trace,
      warnings: checked.warnings,
      model: `${route.provider}/${route.model}`, took: search.took,
      promptVersion: PROMPT,
    }
  } catch (error) {
    const fallback = extractiveAnswer({ ...search, chains })
    return {
      question: q, mode: 'extractive', answer: fallback.answer,
      citations: citationList(fallback.citations || [], allowed),
      chains, evidence: search.evidence.slice(0, 12), trace,
      warnings: [...fallback.warnings, `模型调用失败：${String(error?.message || error)}`],
      model: `${route.provider}/${route.model}`, took: search.took,
    }
  }
}
