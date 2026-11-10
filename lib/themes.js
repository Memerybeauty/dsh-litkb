/**
 * 研究工作台（P5.0）：研究（主题）、细分描述、匹配与主题链候选。
 * 只做数据与规则，不落库；保存链、跑任务由路由层控制。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { PATHS, readIndex } from './library.js'
import { readCard } from './cards.js'
import { readBlocks } from './blocks.js'
import { paragraphForQuoteInIndex, paragraphIndex } from './paragraphs.js'
import { readDeepRead } from './deepread.js'
import { cueRelation, extractClaims, listChains, nodeForEvidence, readChain } from './chains.js'
import { normalizeTerm, readConcepts, readEdges } from './concepts.js'
import { bm25, tokenize } from './search.js'

export const THEME_MATCHER = 'theme-match.v1'
export const MAX_FACETS = 12
const MAX_TITLE = 120
const MAX_FACET_TITLE = 80
const MAX_DESC = 500
const MAX_CLAIM = 240
export const DEFAULT_MATCH = {
  minScore: 1.5,
  relative: 0.4,
  perPaper: 2,
  maxHits: 8,
  maxPapers: 6,
  keywordMode: 'require',
  tagMode: 'boost',
  yearFrom: 0,
  yearTo: 0,
  expand: true,
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback))
}

export function normalizeMatch(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MATCH }
  return {
    minScore: clampNumber(raw.minScore, 0.5, 10, DEFAULT_MATCH.minScore),
    relative: clampNumber(raw.relative, 0.1, 0.9, DEFAULT_MATCH.relative),
    perPaper: clampInt(raw.perPaper, 1, 3, DEFAULT_MATCH.perPaper),
    maxHits: clampInt(raw.maxHits, 4, 12, DEFAULT_MATCH.maxHits),
    maxPapers: clampInt(raw.maxPapers, 3, 10, DEFAULT_MATCH.maxPapers),
    keywordMode: raw.keywordMode === 'off' ? 'off' : 'require',
    tagMode: raw.tagMode === 'require' ? 'require' : 'boost',
    yearFrom: clampInt(raw.yearFrom, 0, 2100, 0),
    yearTo: clampInt(raw.yearTo, 0, 2100, 0),
    expand: raw.expand !== false,
  }
}

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function ensureDir() {
  try { if (!existsSync(PATHS.themes)) mkdirSync(PATHS.themes, { recursive: true }) } catch { /* 读路径继续 */ }
}

function themePath(id) {
  return join(PATHS.themes, `${id}.json`)
}

function safeId(id) {
  return /^t-[a-z0-9]{6,16}$/.test(String(id || ''))
}

function isPaperId(id) {
  return /^p-[a-zA-Z0-9_-]+$/.test(String(id || ''))
}

function digest(text) {
  return createHash('sha1').update(String(text)).digest('hex')
}

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max) : value
}

function round(value) {
  return Math.round(Number(value) * 100) / 100
}

function normalizeKeywords(list) {
  return [...new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => clip(item, 30))
      .filter(Boolean),
  )].slice(0, 8)
}

function normalizeFacet(raw, index, used) {
  const title = clip(raw?.title ?? raw?.name, MAX_FACET_TITLE)
  if (!title) throw fail('facet_title_required', `第 ${index + 1} 条细分描述缺少标题`)
  let key = String(raw?.key || '')
  if (!/^f[a-z0-9]{1,6}$/.test(key) || used.has(key)) {
    let n = index + 1
    while (used.has(`f${n}`)) n += 1
    key = `f${n}`
  }
  used.add(key)
  return {
    key,
    title,
    description: clip(raw?.description, MAX_DESC),
    keywords: normalizeKeywords(raw?.keywords),
    mode: raw?.mode === 'verify' ? 'verify' : 'compare',
    enabled: raw?.enabled !== false,
  }
}

function normalizePapers(raw) {
  const last = raw?.lastMatch && typeof raw.lastMatch === 'object' ? raw.lastMatch : null
  return {
    include: [...new Set((raw?.include || []).filter(isPaperId))],
    exclude: [...new Set((raw?.exclude || []).filter(isPaperId))],
    lastMatch: last ? {
      at: String(last.at || ''),
      papers: (Array.isArray(last.papers) ? last.papers : [])
        .filter((item) => isPaperId(item?.paperId))
        .slice(0, 200)
        .map((item) => ({
          paperId: item.paperId,
          score: round(Number(item.score) || 0),
          facets: Array.isArray(item.facets) ? item.facets.map(String).slice(0, MAX_FACETS) : [],
          hits: Math.max(0, Number(item.hits) || 0),
        })),
    } : null,
  }
}

function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return null
  const used = new Set()
  const facets = []
  for (const [index, item] of (Array.isArray(raw.facets) ? raw.facets : []).entries()) {
    try { facets.push(normalizeFacet(item, index, used)) } catch { /* 丢弃坏 facet */ }
  }
  return {
    id: String(raw.id || ''),
    title: clip(raw.title, MAX_TITLE),
    description: clip(raw.description, MAX_DESC),
    tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => clip(t, 40)).filter(Boolean))].slice(0, 12),
    facets: facets.slice(0, MAX_FACETS),
    papers: normalizePapers(raw.papers),
    match: normalizeMatch(raw.match),
    draftId: /^d-[a-zA-Z0-9_-]{4,40}$/.test(String(raw.draftId || '')) ? raw.draftId : '',
    summary: {
      text: String(raw.summary?.text || ''),
      updatedAt: raw.summary?.updatedAt || null,
      model: raw.summary?.model || null,
      basis: raw.summary?.basis && typeof raw.summary.basis === 'object'
        ? {
            chainIds: Array.isArray(raw.summary.basis.chainIds) ? raw.summary.basis.chainIds.map(String) : [],
            fingerprint: String(raw.summary.basis.fingerprint || ''),
          }
        : null,
    },
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : null,
  }
}

export function readTheme(id) {
  if (!safeId(id)) return null
  const file = themePath(id)
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data?.id !== id) data.id = id
    return normalizeTheme(data)
  } catch {
    return null
  }
}

/** 新建或更新（facets 全量覆盖；key 保留；summary/lastMatch 不随 save 被清空）。 */
export function saveTheme(input = {}) {
  ensureDir()
  const existing = input.id ? readTheme(String(input.id)) : null
  if (input.id && !existing) throw fail('not_found', '研究不存在')
  const title = clip(input.title ?? existing?.title, MAX_TITLE)
  if (!title) throw fail('empty_title', '研究标题不能为空')
  const rawFacets = Array.isArray(input.facets) ? input.facets : (existing?.facets || [])
  if (rawFacets.length > MAX_FACETS) throw fail('too_many_facets', `细分描述最多 ${MAX_FACETS} 条`)
  const used = new Set()
  const facets = rawFacets.map((item, index) => normalizeFacet(item, index, used))
  const at = new Date().toISOString()
  const theme = {
    id: existing?.id || `t-${digest(`${title}|${at}|${Math.random()}`).slice(0, 8)}`,
    title,
    description: clip(input.description ?? existing?.description, MAX_DESC),
    tags: input.tags === undefined
      ? (existing?.tags || [])
      : [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => clip(t, 40)).filter(Boolean))].slice(0, 12),
    facets,
    papers: input.papers === undefined
      ? (existing?.papers || normalizePapers({}))
      : normalizePapers({ ...input.papers, lastMatch: input.papers.lastMatch ?? existing?.papers?.lastMatch }),
    match: input.match === undefined
      ? (existing?.match || normalizeMatch())
      : normalizeMatch({ ...(existing?.match || {}), ...input.match }),
    draftId: existing?.draftId || '',
    summary: existing?.summary || { text: '', updatedAt: null, model: null },
    createdAt: existing?.createdAt || at,
    updatedAt: at,
    lastRun: existing?.lastRun || null,
  }
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme
}

export function deleteTheme(id) {
  if (!safeId(id) || !existsSync(themePath(id))) return false
  unlinkSync(themePath(id))
  try {
    const analysis = join(PATHS.themes, 'analysis', `${id}.json`)
    if (existsSync(analysis)) unlinkSync(analysis)
  } catch { /* 分析文件清理失败不阻断主题删除 */ }
  return true
}

/** 主题下的链：list + facetKey → chain。 */
export function themeChains(themeId) {
  const list = []
  for (const summary of listChains()) {
    const chain = readChain(summary.id)
    if (!chain) continue
    if (chain.provenance?.themeId !== themeId) continue
    list.push(chain)
  }
  const byFacet = new Map()
  for (const chain of list) {
    const key = chain.provenance?.facetKey
    if (!key) continue
    const found = byFacet.get(key)
    // 同一 facet 允许多条（confirmed + 补充 draft）；保留最新的 confirmed 优先。
    if (!found || (found.status !== 'confirmed' && chain.status === 'confirmed')) byFacet.set(key, chain)
    else if (found.status === chain.status) byFacet.set(key, chain)
  }
  return { list, byFacet }
}

function themeChainIndex() {
  const map = new Map()
  for (const summary of listChains()) {
    const chain = readChain(summary.id)
    const themeId = chain?.provenance?.themeId
    if (!themeId) continue
    if (!map.has(themeId)) map.set(themeId, [])
    map.get(themeId).push(chain)
  }
  return map
}

export function themePapers(theme, chains = themeChains(theme.id).list) {
  const records = new Map(readIndex().map((record) => [record.id, record]))
  const map = new Map()
  const ensure = (paperId) => {
    if (!map.has(paperId)) {
      const record = records.get(paperId) || null
      map.set(paperId, {
        paperId,
        title: record?.title || paperId,
        authors: record?.authors || '',
        year: record?.year || '',
        venue: record?.venue || '',
        topics: record?.topics || [],
        score: 0,
        facets: [],
        hits: 0,
        evidence: 0,
        chainCount: 0,
        source: 'chain',
      })
    }
    return map.get(paperId)
  }
  const evidence = new Set()
  for (const chain of chains) {
    for (const node of chain.nodes || []) {
      if (!node?.paperId) continue
      const row = ensure(node.paperId)
      row.chainCount += 1
      if (!evidence.has(node.evidenceId)) {
        evidence.add(node.evidenceId)
        row.evidence += 1
      }
    }
  }
  for (const item of theme.papers.lastMatch?.papers || []) {
    const row = ensure(item.paperId)
    row.score = Math.max(row.score, Number(item.score) || 0)
    row.hits = Math.max(row.hits, Number(item.hits) || 0)
    row.facets = [...new Set([...row.facets, ...(item.facets || [])])]
    if (row.source === 'chain') row.source = 'match'
  }
  for (const paperId of theme.papers.include) {
    const row = ensure(paperId)
    row.source = 'manual'
  }
  for (const paperId of theme.papers.exclude) map.delete(paperId)
  return [...map.values()].sort((a, b) => b.score - a.score || b.chainCount - a.chainCount || a.title.localeCompare(b.title))
}

export function themeStats(theme, chains = themeChains(theme.id).list) {
  const confirmed = chains.filter((chain) => chain.status === 'confirmed').length
  const drafts = chains.filter((chain) => chain.status === 'draft').length
  const covered = new Set(chains.map((chain) => chain.provenance?.facetKey).filter(Boolean))
  const measured = Boolean(theme.papers.lastMatch)
  const rows = themePapers(theme, chains)
  const currentPapers = measured ? rows.filter((row) => row.source !== 'chain').length : rows.length
  const matchedFacets = new Set()
  for (const item of theme.papers.lastMatch?.papers || []) {
    for (const key of item.facets || []) matchedFacets.add(key)
  }
  const gaps = theme.facets.filter((facet) => (
    facet.enabled && !covered.has(facet.key) && measured && !matchedFacets.has(facet.key)
  )).length
  return {
    facets: theme.facets.filter((facet) => facet.enabled).length,
    papers: currentPapers,
    chains: chains.length,
    confirmed,
    drafts,
    pending: drafts,
    gaps,
  }
}

export function listThemes() {
  ensureDir()
  let names = []
  try { names = readdirSync(PATHS.themes).filter((name) => name.endsWith('.json')) } catch { return [] }
  const index = themeChainIndex()
  const out = []
  for (const name of names) {
    const theme = readTheme(name.slice(0, -5))
    if (!theme) continue
    const chains = index.get(theme.id) || []
    out.push({
      id: theme.id,
      title: theme.title,
      description: theme.description,
      tags: theme.tags,
      draftId: theme.draftId,
      updatedAt: theme.updatedAt,
      createdAt: theme.createdAt,
      facets: theme.facets.map((facet) => facet.title),
      stats: themeStats(theme, chains),
    })
  }
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.title.localeCompare(b.title))
}

/* ---------------- 匹配 ---------------- */

function pushTokens(target, text, weight) {
  const tokens = tokenize(text)
  for (let i = 0; i < weight; i += 1) target.push(...tokens)
}

function buildCorpus() {
  const records = new Map(readIndex().map((record) => [record.id, record]))
  const docs = []
  const paragraphState = new Map()
  const paragraphsFor = (paperId) => {
    if (!paragraphState.has(paperId)) {
      const doc = readBlocks(paperId)
      paragraphState.set(paperId, doc ? { doc, index: paragraphIndex(doc) } : null)
    }
    return paragraphState.get(paperId)
  }
  for (const record of records.values()) {
    const card = readCard(record.id)
    if (!card) continue
    const tagText = (record.topics || []).join(' ')
    for (const evidence of card.evidence || []) {
      const state = paragraphsFor(record.id)
      const paragraph = state
        ? ((evidence.block && state.index.byBlock.get(evidence.block))
          || paragraphForQuoteInIndex(state.index, evidence.quote, evidence.page))
        : null
      const text = String(paragraph?.text || evidence.quote || '').slice(0, 800)
      const tokens = []
      pushTokens(tokens, text, 3)
      pushTokens(tokens, record.title, 2)
      pushTokens(tokens, `${tagText} ${record.venue || ''} ${record.year || ''}`, 1)
      docs.push({
        kind: 'evidence', paperId: record.id, evidenceId: evidence.id,
        page: evidence.page, block: paragraph?.firstBlockId || evidence.block || '',
        text, tokens, paragraph: Boolean(paragraph),
      })
    }
    // 七段卡正文也入索引（带证据的段落），提高中文改写下的召回。
    for (const section of card.sections || []) {
      const ids = (section.evidence || [])
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter(Boolean)
      const body = String(section.text || '').trim()
      if (!ids.length || !body) continue
      const tokens = []
      pushTokens(tokens, body, 3)
      pushTokens(tokens, record.title, 2)
      docs.push({
        kind: 'claim', paperId: record.id, evidenceIds: ids.slice(0, 4),
        pages: [], page: null, text: body, tokens,
      })
    }
    const deepread = readDeepRead(record.id)
    if (deepread) {
      for (const candidate of extractClaims(deepread).slice(0, 16)) {
        const tokens = []
        pushTokens(tokens, candidate.text, 3)
        pushTokens(tokens, record.title, 2)
        docs.push({
          kind: 'claim', paperId: record.id, evidenceIds: candidate.evidenceIds || [],
          pages: candidate.pages || [], page: candidate.pages?.[0] || null, text: candidate.text, tokens,
        })
      }
    }
  }
  return { docs, records }
}

function conceptNamesByPaper() {
  let byId
  try {
    byId = new Map(readConcepts().concepts.map((concept) => [concept.id, concept.name]))
  } catch {
    return new Map()
  }
  const map = new Map()
  let edges
  try { edges = readEdges() } catch { return map }
  for (const edge of edges) {
    const ids = [String(edge.source || ''), String(edge.target || '')]
    const paperId = ids.find((id) => id.startsWith('p-'))
    const conceptId = ids.find((id) => id.startsWith('c-'))
    if (!paperId || !conceptId) continue
    const name = byId.get(conceptId)
    if (!name) continue
    if (!map.has(paperId)) map.set(paperId, new Set())
    map.get(paperId).add(name)
  }
  return map
}

function resolveHit(doc, card) {
  if (doc.kind === 'evidence') {
    return { paperId: doc.paperId, evidenceId: doc.evidenceId, page: doc.page, block: doc.block, quote: doc.text, source: 'evidence' }
  }
  const pool = card?.evidence || []
  const byId = new Map(pool.map((evidence) => [evidence.id, evidence]))
  const hit = (doc.evidenceIds || []).map((id) => byId.get(id)).find(Boolean)
    || pool.find((evidence) => Number(evidence.page) === Number(doc.page))
  if (!hit) return null
  return { paperId: doc.paperId, evidenceId: hit.id, page: hit.page, block: hit.block || '', quote: hit.quote || '', source: 'claim', text: doc.text }
}

function expansionTerms(theme, facet, ctx) {
  const cfg = theme.match || DEFAULT_MATCH
  if (!cfg.expand) return []
  if (!ctx.concepts) {
    try { ctx.concepts = readConcepts() } catch { ctx.concepts = { concepts: [] } }
  }
  const text = normalizeTerm([
    facet.title, facet.description, ...(facet.keywords || []), ...(theme.tags || []),
  ].join(' '))
  const out = []
  const seen = new Set()
  for (const concept of ctx.concepts.concepts || []) {
    const names = [concept.name, ...(concept.aliases || [])].filter(Boolean)
    if (!names.some((name) => text.includes(normalizeTerm(name)))) continue
    for (const name of names) {
      if (out.length >= 12) break
      const key = normalizeTerm(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(name)
    }
    if (out.length >= 12) break
  }
  return out
}

/**
 * 单条细分描述匹配。
 * ctx 可复用（一次主题匹配只建一次语料/概念表）。
 * 规则来自 theme.match（缺省 = 旧行为），命中带打分拆解与缺口原因。
 */
export function matchFacet(theme, facet, ctx) {
  const cfg = theme.match || DEFAULT_MATCH
  const corpus = ctx?.corpus || buildCorpus()
  const conceptMap = ctx?.conceptMap || conceptNamesByPaper()
  const query = [facet.title, facet.description, ...(facet.keywords || [])].join(' ')
  const expansions = expansionTerms(theme, facet, ctx || {})
  const tokens = tokenize(expansions.length ? `${query} ${expansions.join(' ')}` : query)
  const expansionKeys = new Set(tokenize(expansions.join(' ')))
  const tagSet = new Set((theme.tags || []).map(normalizeTerm).filter(Boolean))
  const keywords = (facet.keywords || []).map(normalizeTerm).filter(Boolean)
  let keywordMiss = 0
  let tagFiltered = 0
  let yearFiltered = 0
  const hits = []
  if (tokens.length) {
    const scores = bm25(tokens, corpus.docs)
    for (const [doc, hit] of scores) {
      const record = corpus.records.get(doc.paperId)
      if (!record) continue
      if (cfg.tagMode === 'require' && tagSet.size) {
        const matchedTags = (record.topics || []).filter((tag) => tagSet.has(normalizeTerm(tag)))
        if (!matchedTags.length) { tagFiltered += 1; continue }
      }
      const year = Number(String(record.year || '').slice(0, 4))
      if (cfg.yearFrom && year && year < cfg.yearFrom) { yearFiltered += 1; continue }
      if (cfg.yearTo && year && year > cfg.yearTo) { yearFiltered += 1; continue }
      const haystack = normalizeTerm(`${doc.text} ${record.title} ${(record.topics || []).join(' ')}`)
      if (cfg.keywordMode === 'require' && keywords.length && !keywords.some((keyword) => haystack.includes(keyword))) {
        keywordMiss += 1
        continue
      }
      const card = readCard(doc.paperId)
      const resolved = resolveHit(doc, card)
      if (!resolved) continue
      if (doc.paragraph) {
        resolved.quote = String(doc.text || resolved.quote || '').slice(0, 600)
        resolved.block = doc.block || resolved.block
        resolved.paragraph = true
      }
      const tagBoost = tagSet.size
        ? Math.min(3, (record.topics || []).filter((tag) => tagSet.has(normalizeTerm(tag))).length * 1.5)
        : 0
      const conceptBoost = Math.min(2, [...(conceptMap.get(doc.paperId) || [])]
        .filter((name) => {
          const terms = tokenize(name)
          return terms.some((term) => tokens.includes(term))
        }).length * 0.5)
      const parts = { bm25: round(hit.score), tag: round(tagBoost), concept: round(conceptBoost) }
      hits.push({
        ...resolved,
        score: round(parts.bm25 + parts.tag + parts.concept),
        parts,
        matched: hit.matched,
        expandedBy: hit.matched.filter((term) => expansionKeys.has(term)),
        text: doc.text,
      })
    }
  }
  hits.sort((a, b) => b.score - a.score || a.paperId.localeCompare(b.paperId))
  const perPaper = new Map()
  const picked = []
  for (const hit of hits) {
    if (picked.length >= cfg.maxHits) break
    const used = perPaper.get(hit.paperId) || 0
    if (used >= cfg.perPaper) continue
    if (used === 0 && perPaper.size >= cfg.maxPapers) continue
    perPaper.set(hit.paperId, used + 1)
    picked.push(hit)
  }
  const top = picked[0]?.score || 0
  const kept = picked.filter((hit) => hit.score >= Math.max(cfg.minScore, top * cfg.relative))
  let reasonCode = ''
  let reason = ''
  if (!kept.length) {
    if (!corpus.docs.length) {
      reasonCode = 'no_corpus'
      reason = '库里还没有可匹配的证据（先导入论文并生成七段卡）'
    } else if (!tokens.length) {
      reasonCode = 'no_terms'
      reason = '细分描述里没有可用检索词'
    } else if (tagFiltered && cfg.tagMode === 'require' && !hits.length) {
      reasonCode = 'tag_filter_empty'
      reason = '标签设为「必须命中」，没有论文同时满足'
    } else if (yearFiltered && !hits.length) {
      reasonCode = 'year_filter_empty'
      reason = '年份范围内没有匹配论文'
    } else if (keywordMiss && cfg.keywordMode === 'require' && !hits.length) {
      reasonCode = 'keywords_miss'
      reason = '关键词没有命中，放宽关键词或改为「不强制」'
    } else if (hits.length) {
      reasonCode = 'below_threshold'
      reason = '匹配分数低于阈值，可下调最低分或补充描述'
    } else {
      reasonCode = 'no_terms'
      reason = '没有命中任何词，换一种说法或补关键词'
    }
  }
  return {
    facetKey: facet.key,
    facetTitle: facet.title,
    query,
    expansions,
    config: cfg,
    tokens: [...new Set(tokens)].slice(0, 12),
    hits: kept,
    top,
    gap: kept.length === 0,
    reasonCode,
    reason,
  }
}

/** 多条细分描述的命中 → 论文级聚合（供匹配预览与任务写 lastMatch）。 */
export function aggregateThemePapers(results = []) {
  const papers = new Map()
  for (const result of results) {
    for (const hit of result.hits) {
      const row = papers.get(hit.paperId) || { paperId: hit.paperId, score: 0, facets: [], hits: 0 }
      row.score = Math.max(row.score, hit.score)
      row.hits += 1
      if (!row.facets.includes(result.facetKey)) row.facets.push(result.facetKey)
      papers.set(hit.paperId, row)
    }
  }
  return [...papers.values()].sort((a, b) => b.score - a.score)
}

export function matchTheme(theme, options = {}) {
  const corpus = options.corpus || buildCorpus()
  const conceptMap = options.conceptMap || conceptNamesByPaper()
  const ctx = { corpus, conceptMap }
  const wanted = Array.isArray(options.facetKeys) && options.facetKeys.length
    ? new Set(options.facetKeys)
    : null
  const results = []
  for (const facet of theme.facets) {
    if (!facet.enabled) continue
    if (wanted && !wanted.has(facet.key)) continue
    results.push(matchFacet(theme, facet, ctx))
  }
  return {
    themeId: theme.id,
    results,
    papers: aggregateThemePapers(results),
  }
}

/** 匹配结果写回主题的 lastMatch（供总览与研究页复用）。 */
export function recordThemeMatch(themeId, papers = []) {
  const theme = readTheme(themeId)
  if (!theme) throw fail('not_found', '研究不存在')
  const matchedIds = new Set(papers.map((item) => item.paperId))
  // 移出是手动的一次性操作；重新匹配命中后应重新入库，不能被历史 exclude 永久挡住。
  theme.papers.exclude = theme.papers.exclude.filter((paperId) => !matchedIds.has(paperId))
  theme.papers.lastMatch = {
    at: new Date().toISOString(),
    papers: papers.slice(0, 200).map((item) => ({
      paperId: item.paperId,
      score: round(item.score),
      facets: item.facets || [],
      hits: item.hits || 0,
    })),
  }
  theme.updatedAt = new Date().toISOString()
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme.papers.lastMatch
}

/* ---------------- 主题链候选 ---------------- */

function confidenceOf(facet, nodes, match) {
  const papers = new Set(nodes.map((node) => node.paperId))
  let score = 0.45
  score += Math.min(0.2, papers.size * 0.1)
  if (nodes.some((node) => node.block)) score += 0.15
  if ((facet.keywords || []).length) score += 0.1
  if (match.top > 0 && match.top >= Math.max(...match.hits.map((hit) => hit.score)) * 0.7) score += 0.1
  return round(Math.min(0.95, score))
}

export function buildFacetChain(theme, facet, match, options = {}) {
  const nodes = []
  const seen = new Set()
  const seenParagraph = new Set()
  for (const hit of match.hits.slice(0, 4)) {
    if (seen.has(hit.evidenceId)) continue
    if (hit.paragraph) {
      const key = `${hit.paperId}:${hit.block || hit.evidenceId}`
      if (seenParagraph.has(key)) continue
      seenParagraph.add(key)
    }
    if (!hit.paragraph && String(hit.quote || '').trim().length < 24 && !/[。！？.!?]$/.test(hit.quote || '')) continue
    const relation = facet.mode === 'compare' ? 'compares' : cueRelation(hit.quote)
    const node = nodeForEvidence(hit.paperId, hit.evidenceId, relation)
    if (!node) continue
    if (hit.paragraph) {
      node.quote = hit.quote
      node.block = hit.block || node.block
      node.before = ''
      node.after = ''
    }
    seen.add(hit.evidenceId)
    nodes.push(node)
  }
  if (!nodes.length) return null
  const papers = new Set(nodes.map((node) => node.paperId))
  const warnings = []
  if (papers.size === 1) warnings.push('只有 1 篇论文支撑，建议补充证据或放宽关键词')
  if (!nodes.some((node) => node.block)) warnings.push('部分证据缺少版面块，只能定位到页')
  if (match.top < 2.5) warnings.push('匹配分数偏低，请人工核对证据是否切题')
  if (facet.mode === 'verify' && !nodes.some((node) => node.relation === 'contradicts')) {
    warnings.push('没有找到反驳证据，当前只覆盖支持面')
  }
  const claimText = clip(facet.title, MAX_CLAIM)
  return {
    title: claimText.slice(0, 60),
    origin: 'topic',
    status: 'draft',
    confidence: confidenceOf(facet, nodes, match),
    topic: theme.title,
    paperIds: [...papers],
    question: '',
    provenance: {
      themeId: theme.id,
      facetKey: facet.key,
      runId: options.runId || '',
      matcher: THEME_MATCHER,
      query: match.query,
      tokens: match.tokens,
      model: null,
      topScore: match.top,
      hitCount: match.hits.length,
    },
    relations: [],
    warnings,
    claim: {
      text: claimText,
      paperId: nodes[0].paperId,
      sectionKey: '',
      source: 'topic',
    },
    nodes,
  }
}

/**
 * 一次主题建链：返回候选草稿、缺口与匹配明细，不落库。
 * 已有 draft 用 existingChainId 标记（保存时原地更新）；confirmed 只提示不覆盖。
 */
export function themeChainDrafts(theme, options = {}) {
  const runId = options.runId || `run-theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const ctx = {
    corpus: options.corpus || buildCorpus(),
    conceptMap: options.conceptMap || conceptNamesByPaper(),
  }
  const chains = themeChains(theme.id)
  const drafts = []
  const gaps = []
  const results = []
  for (const facet of theme.facets) {
    if (!facet.enabled) continue
    if (Array.isArray(options.facetKeys) && options.facetKeys.length && !options.facetKeys.includes(facet.key)) continue
    const match = matchFacet(theme, facet, ctx)
    results.push({ ...match, hits: match.hits })
    if (!match.hits.length) {
      gaps.push({ facetKey: facet.key, title: facet.title, reason: match.reason })
      continue
    }
    const draft = buildFacetChain(theme, facet, match, { runId })
    if (!draft) {
      gaps.push({ facetKey: facet.key, title: facet.title, reason: '匹配到的证据已失效' })
      continue
    }
    // 观点链（provenance.viewpointId）是独立生命周期，不参与 facet 主链的幂等判断。
    const facetChains = chains.list.filter((chain) => (
      chain.provenance?.facetKey === facet.key && !chain.provenance?.viewpointId
    ))
    const existing = facetChains.find((chain) => chain.status === 'confirmed')
      || facetChains.find((chain) => chain.status === 'draft')
    const existingDraft = facetChains.find((chain) => chain.status === 'draft')
    if (existing?.status === 'confirmed') {
      draft.warnings.push('这条细分描述已有确认链，本次只生成补充草稿，不会覆盖原链')
      draft.provenance.previousChainId = existing.id
      if (existingDraft) {
        draft.existingChainId = existingDraft.id
        draft.warnings.push('已更新原有的补充草稿')
      }
    } else if (existing?.status === 'draft') {
      draft.existingChainId = existing.id
    }
    drafts.push(draft)
  }
  return { runId, themeId: theme.id, drafts, gaps, results }
}

/* ---------------- 研究内容：综合结论与提纲 ---------------- */

function shortAuthor(authors) {
  return String(authors || '').split(/[,，;；、]/)[0].trim() || 'Anon'
}

function citationFor(node) {
  return `[[${node.paperId}#^${node.evidenceId}|${shortAuthor(node.authors)} ${node.year || ''}, p.${node.page}]]`
}

const RELATION_TEXT = {
  supports: '支持',
  contradicts: '反驳',
  qualifies: '限定',
  derives: '推导',
  compares: '对比',
}

/** 按长度截断，尽量在标点或空格处收尾，避免把单词劈成两半。 */
function trimTo(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  const head = value.slice(0, max)
  const cut = Math.max(
    head.lastIndexOf('。'), head.lastIndexOf('.'),
    head.lastIndexOf('，'), head.lastIndexOf(','),
    head.lastIndexOf(' '),
  )
  return (cut > max * 0.6 ? head.slice(0, cut) : head).trim()
}

/** 证据节点 → 「第一作者 年份」；节点没存作者时回到文献库记录里找，避免出现一堆 Anon。 */
function nodeLabel(node, records) {
  const record = records?.get(node?.paperId) || null
  const raw = String(node?.authors || record?.authors || '').split(/[,，;；、]/)[0].trim()
  const year = node?.year || record?.year || ''
  if (raw && raw !== '-' && !/^anon$/i.test(raw)) return `${raw}${year ? ` ${year}` : ''}`
  const title = trimTo(String(record?.title || '').replace(/^[\s\d\-–—:|.]+/, ''), 16)
  if (title) return `${title}${year ? ` ${year}` : ''}`
  return `论文 ${String(node?.paperId || '').slice(-4)}${year ? ` ${year}` : ''}`
}

function clipQuote(text, max = 96) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${trimTo(value, max)}…`
}

/**
 * 研究结论：把已确认证据链的观点按研究内容汇总。
 * 只读 confirmed，不新增事实；每条观点都带论文、页码和原文引文。
 */
export function buildThemeSummary(theme, chains = themeChains(theme.id).list) {
  const confirmed = chains.filter((chain) => chain.status === 'confirmed')
  const facets = (theme.facets || []).filter((facet) => facet.enabled)
  const empty = { text: '', citations: 0, chains: 0, papers: 0, covered: 0, total: facets.length }
  if (!confirmed.length) return empty

  const facetKeys = new Set(facets.map((facet) => facet.key))
  const byFacet = new Map()
  const loose = []
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey
    if (key && facetKeys.has(key)) {
      if (!byFacet.has(key)) byFacet.set(key, [])
      byFacet.get(key).push(chain)
    } else {
      loose.push(chain)
    }
  }

  const records = new Map(readIndex().map((record) => [record.id, record]))
  const papers = new Set()
  let evidenceCount = 0
  for (const chain of confirmed) {
    for (const node of chain.nodes || []) {
      if (node?.paperId) papers.add(node.paperId)
      if (node?.evidenceId) evidenceCount += 1
    }
  }

  const lines = [[
    `已确认证据链 ${confirmed.length} 条`,
    `覆盖 ${byFacet.size}/${facets.length} 条研究内容`,
    `涉及 ${papers.size} 篇论文`,
    `${evidenceCount} 条证据`,
  ].join(' · ')]

  const missing = []
  let section = 0
  for (const facet of facets) {
    const group = byFacet.get(facet.key) || []
    if (!group.length) { missing.push(facet.title); continue }
    section += 1
    const groupPapers = new Set()
    let groupEvidence = 0
    for (const chain of group) {
      for (const node of chain.nodes || []) {
        if (node?.paperId) groupPapers.add(node.paperId)
        if (node?.evidenceId) groupEvidence += 1
      }
    }
    lines.push('')
    lines.push(`【${section}】${facet.title}`)
    lines.push(`　${group.length} 条链 · ${groupPapers.size} 篇论文 · ${groupEvidence} 条证据`)
    group.forEach((chain, index) => {
      const nodes = (chain.nodes || []).filter((node) => node?.evidenceId)
      const support = nodes.filter((node) => node.relation !== 'contradicts')
      const against = nodes.filter((node) => node.relation === 'contradicts')
      const mark = chain.provenance?.previousChainId ? '（补充链）' : ''
      lines.push('')
      lines.push(`　${index + 1}. ${String(chain.claim?.text || '').trim() || '（未写论点）'}${mark}`)

      const named = []
      const seen = new Set()
      for (const node of support) {
        if (!node.paperId || seen.has(node.paperId)) continue
        seen.add(node.paperId)
        named.push(`${nodeLabel(node, records)}（p.${node.page ?? '?'}）`)
      }
      if (named.length) lines.push(`　　 支撑：${named.join('；')}`)

      for (const node of support.filter((item) => item.quote).slice(0, 3)) {
        lines.push(`　　 证据：p.${node.page ?? '?'}「${clipQuote(node.quote)}」`)
      }

      if (nodes.length > 1) {
        const tally = {}
        for (const node of nodes) {
          const key = node.relation || 'supports'
          tally[key] = (tally[key] || 0) + 1
        }
        const parts = Object.entries(tally).map(([key, count]) => `${RELATION_TEXT[key] || key} ${count}`)
        lines.push(`　　 立场：${parts.join(' · ')}`)
      }

      if (against.length) {
        lines.push(`　　 反面证据：${against.map((node) => `${nodeLabel(node, records)} p.${node.page ?? '?'}`).join('；')}`)
      }
    })
  }

  if (loose.length) {
    lines.push('')
    lines.push('【未归入研究内容的已确认链】')
    for (const chain of loose) {
      const text = String(chain.claim?.text || '').trim()
      if (text) lines.push(`　- ${text}`)
    }
  }

  if (missing.length) {
    lines.push('')
    lines.push('【尚未覆盖的研究内容】')
    for (const title of missing) lines.push(`　- ${title}`)
  }

  return {
    text: lines.join('\n').trimEnd(),
    citations: evidenceCount,
    chains: confirmed.length,
    papers: papers.size,
    covered: byFacet.size,
    total: facets.length,
  }
}

export function buildThemeOutline(theme, chains = themeChains(theme.id).list) {
  const confirmed = chains.filter((chain) => chain.status === 'confirmed')
  const byFacet = new Map()
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey
    if (!key) continue
    if (!byFacet.has(key)) byFacet.set(key, [])
    byFacet.get(key).push(chain)
  }
  const parts = [`# ${theme.title}`]
  if (theme.description) parts.push('', `> ${theme.description}`)
  const missing = []
  let citations = 0
  for (const facet of theme.facets) {
    if (!facet.enabled) continue
    parts.push('', `## ${facet.title}`)
    const group = byFacet.get(facet.key) || []
    if (!group.length) {
      missing.push(facet.title)
      parts.push('', '_待补：这条细分描述还没有确认的证据链。_')
      continue
    }
    group.forEach((chain, index) => {
      const nodes = (chain.nodes || []).filter((node) => node.relation !== 'contradicts').slice(0, 2)
      const cites = nodes.map(citationFor).join(' ')
      const prefix = group.length > 1 ? `观点 ${index + 1}：` : ''
      parts.push('', `- ${prefix}${chain.claim?.text || facet.title}${cites ? ` ${cites}` : ''}`)
      citations += nodes.length
    })
  }
  return { markdown: parts.join('\n').trimEnd() + '\n', citations, missing, chains: confirmed.length }
}

/* ---------------- 人工覆盖 ---------------- */

export function setThemePaper(themeId, { paperId, action = 'include' } = {}) {
  const theme = readTheme(themeId)
  if (!theme) throw fail('not_found', '研究不存在')
  if (!isPaperId(paperId)) throw fail('bad_paper', '论文 ID 不合法')
  const include = new Set(theme.papers.include)
  const exclude = new Set(theme.papers.exclude)
  if (action === 'exclude') {
    exclude.add(paperId)
    include.delete(paperId)
  } else if (action === 'restore') {
    exclude.delete(paperId)
    include.delete(paperId)
  } else {
    include.add(paperId)
    exclude.delete(paperId)
  }
  theme.papers.include = [...include]
  theme.papers.exclude = [...exclude]
  theme.updatedAt = new Date().toISOString()
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme
}

/** 已确认链的指纹：id + 更新时间 + 论点 + 证据，排序后哈希。 */
export function chainFingerprint(chains = []) {
  const parts = chains
    .filter((chain) => chain.status === 'confirmed')
    .map((chain) => [
      chain.id,
      chain.updatedAt || chain.createdAt || '',
      chain.claim?.text || '',
      (chain.nodes || []).map((node) => node.evidenceId).join(','),
    ].join('|'))
    .sort()
  return createHash('sha1').update(parts.join('\n')).digest('hex')
}

/** 结论是否过期：basis 指纹与当前已确认链不一致。 */
export function summaryState(theme, chains = themeChains(theme.id).list) {
  const confirmed = chains.filter((chain) => chain.status === 'confirmed')
  const currentIds = confirmed.map((chain) => chain.id).sort()
  const currentFingerprint = chainFingerprint(chains)
  const saved = theme.summary?.basis || null
  const savedIds = (saved?.chainIds || []).slice().sort()
  const added = currentIds.filter((id) => !savedIds.includes(id)).length
  const removed = savedIds.filter((id) => !currentIds.includes(id)).length
  const stale = Boolean(theme.summary?.text && saved?.fingerprint && saved.fingerprint !== currentFingerprint)
  let reason = ''
  if (stale) {
    if (added) reason = `新增 ${added} 条已确认链`
    else if (removed) reason = `减少 ${removed} 条已确认链`
    else reason = '已确认链有修改'
  }
  return {
    stale,
    reason,
    legacy: Boolean(theme.summary?.text && !saved?.fingerprint),
    current: { chainIds: currentIds, fingerprint: currentFingerprint },
    saved: { chainIds: savedIds, fingerprint: saved?.fingerprint || '' },
  }
}

export function updateThemeSummary(themeId, { text = '', model = null } = {}) {
  const theme = readTheme(themeId)
  if (!theme) throw fail('not_found', '研究不存在')
  const chains = themeChains(theme.id).list
  theme.summary = {
    text: String(text).slice(0, 20000),
    updatedAt: new Date().toISOString(),
    model: model || null,
    basis: {
      chainIds: chains.filter((chain) => chain.status === 'confirmed').map((chain) => chain.id).sort(),
      fingerprint: chainFingerprint(chains),
    },
  }
  theme.updatedAt = theme.summary.updatedAt
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme.summary
}

export function bindThemeDraft(themeId, draftId) {
  const theme = readTheme(themeId)
  if (!theme) throw fail('not_found', '研究不存在')
  theme.draftId = String(draftId || '')
  theme.updatedAt = new Date().toISOString()
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme
}

export function markThemeRun(themeId, run = {}) {
  const theme = readTheme(themeId)
  if (!theme) return null
  theme.lastRun = {
    runId: String(run.runId || ''),
    at: new Date().toISOString(),
    matcher: THEME_MATCHER,
    model: run.model || null,
  }
  const file = themePath(theme.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(theme, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return theme.lastRun
}
