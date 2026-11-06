/**
 * P4.11 检索：本地 BM25，不依赖向量库。
 *
 * 索引两类文档：
 * 1. 证据（q-id）——回答的最小引用单位；
 * 2. 链（claim + 节点引文）——检索的聚合单位。
 * 中文用 Intl.Segmenter + 二元组兜底；英文/数字按词。
 */
import { readIndex } from './library.js'
import { readCard } from './cards.js'
import { listChains, readChain } from './chains.js'

const K1 = 1.2
const B = 0.75
const MAX_EVIDENCE = 80
const MAX_CHAINS = 30
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were',
  'this', 'that', 'these', 'those', 'we', 'our', 'it', 'as', 'by', 'from', 'at', 'be', 'can',
  '的', '了', '在', '是', '和', '与', '及', '或', '对', '中', '上', '下', '也', '都', '而', '被',
])

let segmenter = null
try {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
} catch { segmenter = null }

const CJK = /[\u3400-\u9fff]/
const CJK_RUN = /[\u3400-\u9fff]+/g

export function tokenize(text) {
  const value = String(text || '').toLowerCase()
  const out = []
  const latin = value.match(/[a-z0-9][a-z0-9._+-]*/g) || []
  for (const token of latin) if (token.length >= 2 && !STOP.has(token)) out.push(token)
  const runs = value.match(CJK_RUN) || []
  for (const run of runs) {
    if (segmenter) {
      try {
        for (const part of segmenter.segment(run)) {
          const word = String(part.segment || '').trim()
          if (word.length >= 2 && !STOP.has(word) && CJK.test(word)) out.push(word)
        }
      } catch { /* fall back to bigrams */ }
    }
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (!STOP.has(gram)) out.push(gram)
    }
  }
  return out
}

function fieldTokens(target, text, weight) {
  const tokens = tokenize(text)
  for (let i = 0; i < weight; i += 1) target.push(...tokens)
}

function yearOf(record) {
  const value = Number(String(record?.year || '').slice(0, 4))
  return Number.isFinite(value) ? value : 0
}

function inFilter(record, filters) {
  if (!record) return false
  if (filters.paperId && record.id !== filters.paperId) return false
  if (filters.tag && !(record.topics || []).includes(filters.tag)) return false
  const year = yearOf(record)
  if (filters.yearFrom && year && year < Number(filters.yearFrom)) return false
  if (filters.yearTo && year && year > Number(filters.yearTo)) return false
  return true
}

function buildCorpus(filters = {}) {
  const records = readIndex().filter((record) => inFilter(record, filters))
  const byId = new Map(records.map((record) => [record.id, record]))
  const evidenceDocs = []
  const evidenceChains = new Map()
  for (const record of records) {
    const card = readCard(record.id)
    if (!card) continue
    for (const evidence of card.evidence || []) {
      const tokens = []
      fieldTokens(tokens, evidence.quote, 3)
      fieldTokens(tokens, record.title, 2)
      fieldTokens(tokens, `${record.authors || ''} ${record.year || ''} ${record.venue || ''}`, 1)
      fieldTokens(tokens, (record.topics || []).join(' '), 1)
      evidenceDocs.push({
        kind: 'evidence', paperId: record.id, evidenceId: evidence.id, page: evidence.page,
        block: evidence.block || '', quote: evidence.quote || '', title: record.title || record.id,
        authors: record.authors || '', year: record.year || '', tags: record.topics || [],
        tokens,
      })
    }
  }
  const chainDocs = []
  for (const summary of listChains()) {
    const chain = readChain(summary.id)
    if (!chain) continue
    if (!filters.includeDrafts && chain.status === 'draft') continue
    const paperIds = [...new Set((chain.nodes || []).map((node) => node.paperId).filter(Boolean))]
    if (filters.paperId && !paperIds.includes(filters.paperId)) continue
    const tokens = []
    fieldTokens(tokens, chain.claim?.text || '', 3)
    fieldTokens(tokens, chain.title || '', 2)
    for (const node of chain.nodes || []) {
      fieldTokens(tokens, node.quote || '', 1)
      fieldTokens(tokens, node.note || '', 1)
      if (!evidenceChains.has(node.evidenceId)) evidenceChains.set(node.evidenceId, new Set())
      evidenceChains.get(node.evidenceId).add(chain.id)
    }
    const years = paperIds.map((id) => yearOf(byId.get(id))).filter(Boolean)
    chainDocs.push({
      kind: 'chain', chainId: chain.id, title: chain.title || '', claim: chain.claim?.text || '',
      nodes: chain.nodes || [], paperIds, years, status: chain.status || 'confirmed',
      origin: chain.origin || 'claim', confidence: Number(chain.confidence) || 1,
      updatedAt: chain.updatedAt || '', tokens,
    })
  }
  return { records, evidenceDocs, chainDocs, evidenceChains }
}

function bm25(queryTokens, docs) {
  const terms = [...new Set(queryTokens)]
  if (!terms.length || !docs.length) return new Map()
  const df = new Map()
  for (const doc of docs) {
    const seen = new Set(doc.tokens)
    for (const term of terms) if (seen.has(term)) df.set(term, (df.get(term) || 0) + 1)
  }
  const avgdl = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1
  const scores = new Map()
  for (const doc of docs) {
    if (!doc.tokens.length) continue
    const tf = new Map()
    for (const token of doc.tokens) tf.set(token, (tf.get(token) || 0) + 1)
    let score = 0
    const matched = []
    for (const term of terms) {
      const freq = tf.get(term) || 0
      if (!freq) continue
      const n = df.get(term) || 0
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      score += idf * (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (doc.tokens.length / avgdl)))
      matched.push(term)
    }
    if (score > 0) scores.set(doc, { score, matched })
  }
  return scores
}

function chainCitationNodes(chain, records) {
  return (chain.nodes || []).map((node) => ({
    paperId: node.paperId,
    title: records.get(node.paperId)?.title || node.title || node.paperId,
    authors: records.get(node.paperId)?.authors || node.authors || '',
    year: records.get(node.paperId)?.year || node.year || '',
    page: node.page,
    block: node.block || '',
    evidenceId: node.evidenceId,
    quote: node.quote || '',
    relation: node.relation || 'supports',
    stale: Boolean(node.stale),
  }))
}

/**
 * 检索入口：返回证据命中 + 链命中（链按 claim/节点聚合）。
 */
export function searchLibrary(query, options = {}) {
  const started = Date.now()
  const q = String(query || '').trim()
  const filters = {
    paperId: options.paperId || '',
    tag: options.tag || '',
    yearFrom: options.yearFrom || '',
    yearTo: options.yearTo || '',
    includeDrafts: Boolean(options.includeDrafts),
  }
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 12))
  if (!q) return { q, evidence: [], chains: [], total: 0, took: 0 }
  const tokens = tokenize(q)
  const corpus = buildCorpus(filters)
  const evidenceScores = bm25(tokens, corpus.evidenceDocs)
  const chainScores = bm25(tokens, corpus.chainDocs)
  const records = new Map(corpus.records.map((record) => [record.id, record]))
  const evidence = [...evidenceScores.entries()]
    .map(([doc, hit]) => ({
      ...doc,
      tokens: undefined,
      score: Math.round(hit.score * 100) / 100,
      matched: hit.matched,
      chainIds: [...(corpus.evidenceChains.get(doc.evidenceId) || [])],
    }))
    .sort((a, b) => b.score - a.score || a.paperId.localeCompare(b.paperId))
    .slice(0, Math.min(MAX_EVIDENCE, limit * 3))
  const chains = [...chainScores.entries()]
    .map(([doc, hit]) => ({
      id: doc.chainId,
      title: doc.title,
      claim: doc.claim,
      status: doc.status,
      origin: doc.origin,
      confidence: doc.confidence,
      paperIds: doc.paperIds,
      updatedAt: doc.updatedAt,
      score: Math.round(hit.score * 100) / 100,
      matched: hit.matched,
      citations: chainCitationNodes(doc, records),
    }))
    .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, Math.min(MAX_CHAINS, limit))
  return {
    q, tokens: termsOf(tokens), evidence, chains,
    total: evidence.length + chains.length,
    took: Date.now() - started,
  }
}

function termsOf(tokens) {
  return [...new Set(tokens)].slice(0, 12)
}
