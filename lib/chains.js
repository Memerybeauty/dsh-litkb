/**
 * P4.10 论证链：一句可辩护的论点 + 支持/反驳/限定它的原文证据。
 *
 * 三条硬规则：
 * 1. AI 只提议，保存必须由用户触发；claim 为空不落库；
 * 2. 节点只允许库内已有 q-id，页码/块/引文从卡片证据复制，不接受模型给的页码；
 * 3. 证据失效显式标 stale，不静默丢。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATHS, readIndex } from './library.js'
import { readCard, writeCard } from './cards.js'
import { readDeepRead } from './deepread.js'
import { callModel, resolveRoute } from './cardgen.js'
import { createDraft, findEvidence, readDraft, saveDraft, searchEvidence } from './drafts.js'
import { normalizeForMatch, quoteId } from './evidence.js'
import { readBlocks } from './blocks.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLAIM_PROMPT = 'chain-claim.v1'
const MAX_NODES = 12

export const CHAIN_RELATIONS = ['supports', 'contradicts', 'qualifies', 'derives', 'compares']
export const RELATION_LABELS = {
  supports: '支持',
  contradicts: '反驳',
  qualifies: '限定',
  derives: '推导',
  compares: '对比',
}
const CLAIM_SECTION_KEYS = new Set(['conclusion', 'innovation', 'limitations', 'takeaways'])

const WIKI_REF = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|([^\]]*))?\]\]/g
const PAGE_REF = /\[p\.(\d+)(?:\s*[–-]\s*p?\.?(\d+))?\]/g
const QUALIFY_CUE = /局限|限制|仅限于|仅在|仅基于|仅用|仅对|单一数据集|单中心|样本(?:量)?(?:小|有限)|不足|未验证|limited|limitation|single[- ]dataset/i
const CONTRADICT_CUE = /相反|矛盾|不一致|反驳|contradict|contrary|conflict/i

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function cleanInline(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** 图节点短标签：中文 ≤10 字；英文取前两个词（≤14 字符）。 */
export function shortText(text, max = 10) {
  let value = cleanInline(text)
  if (!value) return ''
  value = value.replace(/^(?:作者结论是|作者认为|作者指出|研究表明|研究显示|本文|我们|该文)[:：，,]?\s*/, '')
  const clause = value.split(/[，。；：、,;:!?！？\n（(]/)[0].trim() || value
  const clean = clause.replace(/^[-*+•\d.、)\s]+/, '').trim()
  if (!clean) return ''
  if (/[\u4e00-\u9fa5]/.test(clean)) return Array.from(clean).slice(0, max).join('')
  const words = clean.split(' ').slice(0, 2).join(' ')
  const cap = max + 4
  return words.length > cap ? words.slice(0, cap) : words
}

function digest(text) {
  return createHash('sha1').update(String(text)).digest('hex')
}

function chainPath(id) {
  return join(PATHS.chains, `${id}.json`)
}

function safeId(id) {
  return /^c-[a-z0-9]{8,16}$/.test(String(id || ''))
}

function ensureDir() {
  if (!existsSync(PATHS.chains)) mkdirSync(PATHS.chains, { recursive: true })
}

/** 去掉引用与 Markdown 记号，留下可读论点。 */
export function stripCitations(text) {
  return cleanInline(String(text || '')
    .replace(WIKI_REF, '')
    .replace(PAGE_REF, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+([，。；：！？、])/g, '$1'))
}

/** 一句话 → 分句（中英文都切），保留引用附着在前半句。 */
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？；])|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 抽一条文本里的 q-id 与 `[p.N]` 页码。 */
export function extractRefs(text) {
  const evidenceIds = []
  const pages = []
  let match = WIKI_REF.exec(String(text || ''))
  while (match) {
    if (!evidenceIds.includes(match[2])) evidenceIds.push(match[2])
    const label = String(match[3] || '')
    const labelPage = /p\.(\d+)/.exec(label)
    if (labelPage && !pages.includes(Number(labelPage[1]))) pages.push(Number(labelPage[1]))
    match = WIKI_REF.exec(String(text || ''))
  }
  match = PAGE_REF.exec(String(text || ''))
  while (match) {
    pages.push(Number(match[1]))
    if (match[2]) {
      const end = Number(match[2])
      for (let page = Number(match[1]) + 1; page <= end; page += 1) {
        if (!pages.includes(page)) pages.push(page)
      }
    }
    match = PAGE_REF.exec(String(text || ''))
  }
  return { evidenceIds, pages }
}

/** 论文节点短标签：作者 年份；缺字段回退标题。 */
function paperShort(record, fallback) {
  const title = record?.title || fallback || ''
  const author = String(record?.authors || '').split(/[,，;；、]/)[0].trim()
  const shortAuthor = author.split(/\s+/)[0]
  const year = String(record?.year || '').slice(0, 4)
  return ([shortAuthor, year].filter(Boolean).join(' ').slice(0, 10)) || shortText(title) || '论文'
}

/** 从精读的结论/创新点/局限/核心要点切出候选论点。 */
export function extractClaims(deepread) {
  const out = []
  const seen = new Set()
  for (const section of deepread?.sections || []) {
    if (!CLAIM_SECTION_KEYS.has(section.key)) continue
    for (const paragraph of String(section.markdown || '').split(/\n+/)) {
      const line = paragraph.replace(/^\s*(?:[-*+•]|\d+[.)、])\s*/, '')
      for (const raw of splitSentences(line)) {
        const refs = extractRefs(raw)
        if (!refs.evidenceIds.length && !refs.pages.length) continue
        const text = stripCitations(raw)
        if (text.length < 8 || text.length > 220) continue
        if (/原文未说明。?$/.test(text)) continue
        const key = normalizeForMatch(text)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({
          paperId: deepread.paperId,
          sectionKey: section.key,
          sectionTitle: section.title,
          text,
          evidenceIds: refs.evidenceIds,
          pages: refs.pages,
        })
        if (out.length >= 16) return out
      }
    }
  }
  return out
}

export function claimCandidates(paperId) {
  const deepread = readDeepRead(paperId)
  if (!deepread) return []
  return extractClaims(deepread)
}

function termsOf(text) {
  const out = new Set()
  const source = String(text || '').toLowerCase()
  for (const word of source.match(/[a-z][a-z0-9-]{2,}/g) || []) out.add(word)
  const cjk = source.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i < cjk.length - 1; i += 1) out.add(cjk.slice(i, i + 2))
  return out
}

function overlapScore(wanted, text) {
  if (!wanted.size) return 0
  const have = termsOf(text)
  let score = 0
  for (const term of wanted) {
    if (!have.has(term)) continue
    // 英文/数字词更有区分度（MRI、BERT、0.95），中文二元组只作弱信号。
    score += /^[a-z0-9]/.test(term) ? 4 : 1
  }
  return score
}

/** q-id 或页码 → 卡片证据；页码命中的同页证据只取第一条（优先有 block 的）。 */
export function resolveEvidence({ paperId, evidenceIds = [], pages = [], limit = 4 }) {
  const card = paperId ? readCard(paperId) : null
  if (!card) return []
  const byId = new Map((card.evidence || []).map((ev) => [ev.id, ev]))
  const out = []
  const seen = new Set()
  const push = (ev) => {
    if (!ev || seen.has(ev.id) || out.length >= limit) return
    seen.add(ev.id)
    out.push(ev)
  }
  for (const id of evidenceIds) push(byId.get(id))
  for (const page of pages) {
    if (out.length >= limit) break
    const same = (card.evidence || [])
      .filter((ev) => Number(ev.page) === Number(page))
      .sort((a, b) => (b.block ? 1 : 0) - (a.block ? 1 : 0))
    push(same[0])
  }
  return out
}

function keywordEvidence({ paperId, claim, exclude = new Set(), limit = 4 }) {
  const card = readCard(paperId)
  if (!card) return []
  const wanted = termsOf(claim)
  return (card.evidence || [])
    .filter((ev) => !exclude.has(ev.id))
    .map((ev) => ({ ev, score: overlapScore(wanted, ev.quote) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.ev)
}

export function cueRelation(quote) {
  if (CONTRADICT_CUE.test(String(quote || ''))) return 'contradicts'
  if (QUALIFY_CUE.test(String(quote || ''))) return 'qualifies'
  return 'supports'
}

/** 单个 q-id → 链节点（页码/引文从卡片复制；无效 q-id 返回 null）。 */
export function nodeForEvidence(paperId, evidenceId, relation = 'supports') {
  return normalizeNode({ paperId, evidenceId, relation })
}

function makeNode({ paperId, evidence, relation = 'supports', record = null }) {
  const hit = record || readIndex().find((row) => row.id === paperId) || null
  return {
    id: `n-${digest(`${paperId}#${evidence.id}`).slice(0, 8)}`,
    relation,
    paperId,
    evidenceId: evidence.id,
    page: evidence.page,
    block: evidence.block || null,
    quote: evidence.quote || '',
    note: '',
    title: hit?.title || '',
    authors: hit?.authors || '',
    year: hit?.year || '',
  }
}

/** 论点先行：用该句所在板块的引用 + 同页证据，再用关键词兜底。 */
export function proposeFromClaim({ paperId, claim, evidenceIds = [], pages = [], limit = 4 }) {
  const text = cleanInline(claim)
  if (!text) throw fail('empty_claim', '请先写一句论点')
  const candidates = paperId ? claimCandidates(paperId) : []
  const matched = candidates.find((item) => normalizeForMatch(item.text) === normalizeForMatch(text))
    || candidates.find((item) => normalizeForMatch(item.text).includes(normalizeForMatch(text)))
  const ids = [...(matched?.evidenceIds || []), ...evidenceIds]
  const pageList = [...(matched?.pages || []), ...pages]
  let picked = paperId ? resolveEvidence({ paperId, evidenceIds: ids, pages: pageList, limit }) : []
  if (paperId && picked.length < limit) {
    const exclude = new Set(picked.map((ev) => ev.id))
    picked = [...picked, ...keywordEvidence({ paperId, claim: text, exclude, limit: limit - picked.length })]
  }
  const nodes = picked.map((ev) => makeNode({ paperId, evidence: ev, relation: cueRelation(ev.quote) }))
  const warnings = []
  if (!nodes.length) warnings.push('没有找到能挂到这句论点上的原文证据；请换一句更贴近原文的论点，或先补卡片证据。')
  return { claim: text, nodes, warnings, matched: Boolean(matched) }
}

function resolveNodesByIds(evidenceIds = []) {
  const nodes = []
  const seen = new Set()
  for (const raw of evidenceIds) {
    const id = String(raw || '')
    if (!/^q-[0-9a-f]{8}$/.test(id) || seen.has(id)) continue
    let hit = null
    for (const record of readIndex()) {
      const card = readCard(record.id)
      const evidence = (card?.evidence || []).find((ev) => ev.id === id)
      if (evidence) { hit = { record, evidence }; break }
    }
    if (!hit) continue
    seen.add(id)
    nodes.push(makeNode({ paperId: hit.record.id, evidence: hit.evidence, relation: cueRelation(hit.evidence.quote), record: hit.record }))
  }
  return nodes
}

/**
 * 原文段落建链：点解析稿的某一段 → 用这段做claim草稿与支持证据。
 * 该段还没有 q-id 时补一条证据（引文=段落原文，block=该段），这是用户点「建链」的显式动作。
 */
export function proposeFromBlock({ paperId, blockId }) {
  const record = readIndex().find((row) => row.id === paperId)
  if (!record) throw fail('not_found', '论文不存在')
  if (!/^b-[a-zA-Z0-9_-]+$/.test(String(blockId || ''))) throw fail('block_not_found', '版面块 ID 不合法')
  const doc = readBlocks(paperId)
  if (!doc) throw fail('no_blocks', '这篇论文还没有解析稿，先构建解析稿再建链')
  let pageDoc = null
  let block = null
  for (const page of doc.pages || []) {
    const hit = (page.blocks || []).find((item) => item.id === blockId)
    if (hit) { pageDoc = page; block = hit; break }
  }
  if (!block) throw fail('block_not_found', '找不到这个版面块，请重建解析稿')
  if (block.role === 'header' || block.role === 'footer') {
    throw fail('bad_block', '页眉页脚不适合建链，换一段正文')
  }
  const quote = cleanInline(block.text)
  if (quote.length < 8) throw fail('block_too_short', '这一段太短，换一段正文')
  const card = readCard(paperId)
  if (!card) throw fail('no_card', '先生成七段卡，再建链')
  const page = Number(block.page || pageDoc?.page || 0)
  const normalized = normalizeForMatch(quote)
  let evidence = (card.evidence || []).find((ev) => ev.block === block.id)
    || (card.evidence || []).find((ev) => normalizeForMatch(ev.quote) === normalized)
  let created = false
  if (evidence) {
    if (!evidence.block) {
      evidence.block = block.id
      writeCard(card, record)
    }
  } else {
    const id = quoteId(quote)
    evidence = (card.evidence || []).find((ev) => ev.id === id) || null
    if (!evidence) {
      evidence = {
        id, page, quote, before: '', after: '', kind: 'author_claim', block: block.id, source: 'parse',
      }
      card.evidence = [...(card.evidence || []), evidence]
      writeCard(card, record)
      created = true
    }
  }
  const sentence = splitSentences(quote).find((item) => stripCitations(item).length >= 8) || quote
  const claim = clip(stripCitations(sentence), 160)
  const node = makeNode({ paperId, evidence, relation: 'supports', record })
  return {
    claim,
    nodes: [node],
    warnings: [],
    origin: 'block',
    block: { id: block.id, page },
    notice: created ? `已把这一段补为证据 ${evidence.id}（p.${page}）` : '已挂上这一段对应的证据',
  }
}

/** 证据先行：优先用精读里引用这些证据的句子当论点候选；没有就留空待填。 */
export function proposeFromEvidence({ evidenceIds = [], claim = '' }) {
  const nodes = resolveNodesByIds(evidenceIds)
  const warnings = []
  let text = cleanInline(claim)
  if (!text && nodes.length) {
    const selected = new Set(nodes.map((node) => node.evidenceId))
    let best = null
    for (const paper of new Set(nodes.map((node) => node.paperId))) {
      for (const candidate of claimCandidates(paper)) {
        const score = candidate.evidenceIds.filter((id) => selected.has(id)).length
        if (score > 0 && (!best || score > best.score)) best = { text: candidate.text, score }
      }
    }
    if (best) text = best.text
  }
  if (!text) warnings.push('还没有论点：可以自己写一句，或先补更多证据再让 AI 提议。')
  if (!nodes.length) warnings.push('没有解析到可用证据，请从引用库重新选择。')
  return { claim: text, nodes, warnings }
}

function searchForQuestion(question, limit) {
  const direct = searchEvidence(question, limit)
  if (direct.length) return direct
  const merged = new Map()
  const wanted = [...termsOf(question)].filter((term) => term.length >= 2).slice(0, 8)
  for (const term of wanted) {
    for (const item of searchEvidence(term, limit)) {
      if (!merged.has(item.evidenceId)) merged.set(item.evidenceId, item)
    }
  }
  return [...merged.values()]
}

/** 问题先行：全库证据检索，跨论文去重（每篇最多 2 条）。 */
export function proposeFromQuestion({ question, limit = 6 }) {
  const text = cleanInline(question)
  if (!text) throw fail('empty_question', '请先写一个研究问题')
  const wanted = termsOf(text)
  const items = searchForQuestion(text, Math.max(limit * 4, 24))
    .map((item, index) => ({ item, index, score: overlapScore(wanted, `${item.title} ${item.quote}`) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const bestScore = items[0]?.score || 0
  const cutoff = bestScore > 0 ? Math.max(1, Math.ceil(bestScore * 0.4)) : 0
  const perPaper = new Map()
  const nodes = []
  for (const { item, score } of items) {
    if (cutoff && score < cutoff) continue
    const count = perPaper.get(item.paperId) || 0
    if (count >= 2) continue
    perPaper.set(item.paperId, count + 1)
    nodes.push({
      id: `n-${digest(`${item.paperId}#${item.evidenceId}`).slice(0, 8)}`,
      relation: cueRelation(item.quote),
      paperId: item.paperId,
      evidenceId: item.evidenceId,
      page: item.page,
      block: item.block || null,
      quote: item.quote || '',
      note: '',
      title: item.title || '',
      authors: item.authors || '',
      year: item.year || '',
    })
    if (nodes.length >= limit) break
  }
  const warnings = []
  if (!nodes.length) warnings.push('库里没有检索到相关证据，换个关键词试试。')
  else if (perPaper.size < 2) warnings.push('只找到 1 篇论文的证据；跨论文论证还需要再补一篇。')
  return { claim: '', nodes, warnings }
}

/** 把模型输出清洗成一句论点；含引用或过长则丢弃。 */
export function normalizeClaimText(raw) {
  const text = stripCitations(String(raw || '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^[-*+•]\s*/, '')
    .replace(/^论点[:：]\s*/, ''))
  if (text.length < 8 || text.length > 200) return ''
  if (/\[\[|\]\]|q-[0-9a-f]{8}/i.test(text)) return ''
  return text
}

/** AI 提议论点（只在用户点「提议」时调用；不落库）。 */
export async function suggestClaim({ ctx, question = '', nodes = [], origin = 'evidence' }) {
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const evidenceText = nodes.slice(0, 8).map((node) => {
    const head = `- ${node.title || node.paperId}（p.${node.page}）`
    return `${head}\n  原文：${clip(node.quote, 220)}`
  }).join('\n')
  const user = [
    question ? `【研究问题】${question}` : '',
    `【建链方式】${origin === 'question' ? '问题先行' : '证据先行'}`,
    '',
    '【候选证据】',
    evidenceText || '（无）',
    '',
    '只根据上面的证据写一句可辩护的中文论点，不要引用标记，不要分点，不超过 80 字。',
  ].filter(Boolean).join('\n')
  const system = readFileSync(join(HERE, '..', 'prompts', `${CLAIM_PROMPT}.md`), 'utf8')
  const result = await callModel(ctx, route, system, user, null, { maxTokens: 400, reasoningEffort: 'off' })
  return {
    text: normalizeClaimText(result.text),
    model: `${route.provider}/${route.model}`,
  }
}

/** 三种方式的统一入口；AI 提议在路由层补充，纯函数部分可单测。 */
export function proposeChain({ mode, paperId = '', blockId = '', claim = '', question = '', evidenceIds = [], pages = [] }) {
  if (mode === 'block') return proposeFromBlock({ paperId, blockId })
  if (mode === 'question') return { ...proposeFromQuestion({ question }), origin: 'question' }
  if (mode === 'evidence') return { ...proposeFromEvidence({ evidenceIds, claim }), origin: 'evidence' }
  return { ...proposeFromClaim({ paperId, claim, evidenceIds, pages }), origin: 'claim' }
}


function autoConfidence(candidate, nodes) {
  let score = 0.55
  score += Math.min(0.2, nodes.length * 0.05)
  if ((candidate.evidenceIds || []).length) score += 0.1
  if (candidate.sectionKey === 'conclusion' || candidate.sectionKey === 'takeaways') score += 0.05
  return Math.round(Math.min(0.95, score) * 100) / 100
}


const CARD_CLAIM_KEYS = new Set(['oneLine', 'problem', 'method', 'results', 'limits'])

/** 无精读时，用七段卡的段落/句子兜底；证据仍从卡内 q-id 取。 */
function cardClaimCandidates(card) {
  const out = []
  const seen = new Set()
  const evidenceById = new Map((card?.evidence || []).map((ev) => [ev.id, ev]))
  for (const section of card?.sections || []) {
    if (!CARD_CLAIM_KEYS.has(section.key)) continue
    const ids = (section.evidence || []).map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean)
    const pages = [...new Set(ids.map((id) => evidenceById.get(id)?.page).filter(Boolean))]
    for (const raw of String(section.text || '').split(/\n+/)) {
      const line = raw.replace(/^\s*(?:[-*+•]|\d+[.)、])\s*/, '')
      for (const sentence of splitSentences(line)) {
        const text = stripCitations(sentence).trim()
        if (text.length < 8 || text.length > 220) continue
        const key = normalizeForMatch(text)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({
          paperId: card.paperId,
          sectionKey: section.key,
          sectionTitle: section.title,
          text,
          evidenceIds: ids,
          pages,
        })
        if (out.length >= 12) return out
      }
    }
  }
  return out
}

/**
 * 自动建链：从一篇论文的精读里抽取候选论点，逐条锚定证据，产出 draft 链。
 * 纯函数，不落库；保存与进度由路由/前端控制。
 */
export function autoChainDrafts(paperId, options = {}) {
  const record = readIndex().find((row) => row.id === paperId)
  if (!record) throw fail('not_found', '论文不存在')
  const deepread = readDeepRead(paperId)
  const card = readCard(paperId)
  if (!deepread && !card) throw fail('no_source', '这篇论文还没有精读或七段卡，先生成七段卡或精读再自动建链')
  const allowedSections = new Set(options.sections && options.sections.length
    ? options.sections
    : ['conclusion', 'innovation', 'limitations', 'takeaways'])
  const maxClaims = Math.max(1, Math.min(16, Number(options.maxClaims) || 8))
  const deepCandidates = deepread
    ? extractClaims(deepread).filter((candidate) => allowedSections.has(candidate.sectionKey)).slice(0, maxClaims)
    : []
  const cardFallback = !deepCandidates.length && card
  const candidates = deepCandidates.length ? deepCandidates : cardClaimCandidates(card).slice(0, maxClaims)
  const evidenceFallback = cardFallback
  const existing = new Set(listChains().map((chain) => normalizeForMatch(chain.claim?.text || chain.claim || '')))
  const drafts = []
  const skipped = []
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  for (const candidate of candidates) {
    const fingerprint = normalizeForMatch(candidate.text)
    if (!fingerprint) continue
    if (existing.has(fingerprint)) {
      skipped.push({ text: candidate.text, reason: '这条论点已经有链' })
      continue
    }
    let proposed = null
    try {
      proposed = proposeFromClaim({
        paperId, claim: candidate.text,
        evidenceIds: candidate.evidenceIds, pages: candidate.pages, limit: 4,
      })
    } catch (error) {
      skipped.push({ text: candidate.text, reason: String(error?.message || error) })
      continue
    }
    if (!proposed.nodes.length) {
      skipped.push({ text: candidate.text, reason: '没有可锚定的原文证据' })
      continue
    }
    existing.add(fingerprint)
    drafts.push({
      title: candidate.text.slice(0, 60),
      origin: 'auto',
      status: 'draft',
      confidence: autoConfidence(candidate, proposed.nodes),
      topic: (record.topics || [])[0] || '',
      paperIds: [paperId],
      question: '',
      provenance: {
        runId,
        model: null,
        promptVersion: 'chain-auto.v1',
        sections: [candidate.sectionKey],
        source: deepCandidates.length ? 'deepread' : 'card',
        extractedAt: new Date().toISOString(),
      },
      relations: [],
      warnings: [
        ...(proposed.warnings || []),
        ...(evidenceFallback ? ['还没有精读；已用七段卡候选句兜底，建议补精读后复核。'] : []),
      ],
      claim: {
        text: candidate.text,
        paperId,
        sectionKey: candidate.sectionKey,
        source: 'auto',
      },
      nodes: proposed.nodes,
    })
  }
  return {
    runId,
    paperId,
    title: record.title || paperId,
    drafts,
    skipped,
    scanned: candidates.length,
  }
}

function evidenceStillThere(node) {
  return Boolean(findEvidence(node.paperId, node.evidenceId))
}

function markStale(chain) {
  return {
    ...chain,
    nodes: (chain.nodes || []).map((node) => ({ ...node, stale: !evidenceStillThere(node) })),
  }
}

export function readChain(id) {
  if (!safeId(id) || !existsSync(chainPath(id))) return null
  try {
    return markStale(JSON.parse(readFileSync(chainPath(id), 'utf8')))
  } catch { return null }
}

export function listChains() {
  ensureDir()
  const rows = []
  for (const name of readdirSync(PATHS.chains)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    const chain = readChain(name.slice(0, -5))
    if (!chain) continue
    rows.push({
      id: chain.id,
      title: chain.title || clip(chain.claim?.text, 36),
      claim: chain.claim?.text || '',
      origin: chain.origin || 'claim',
      status: chain.status || 'confirmed',
      nodes: chain.nodes.filter((node) => !node.stale).length,
      stale: chain.nodes.filter((node) => node.stale).length,
      papers: [...new Set(chain.nodes.filter((node) => !node.stale).map((node) => node.paperId))].length,
      paperIds: [...new Set(chain.nodes.map((node) => node.paperId).filter(Boolean))],
      claimPaperId: chain.claim?.paperId || '',
      updatedAt: chain.updatedAt || '',
    })
  }
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function normalizeNode(raw) {
  const evidenceId = String(raw?.evidenceId || '')
  if (!/^q-[0-9a-f]{8}$/.test(evidenceId)) return null
  let hit = raw.paperId ? findEvidence(String(raw.paperId), evidenceId) : null
  if (!hit) {
    for (const record of readIndex()) {
      const card = readCard(record.id)
      const evidence = (card?.evidence || []).find((ev) => ev.id === evidenceId)
      if (evidence) { hit = { record, evidence, card }; break }
    }
  }
  if (!hit) return null
  const relation = CHAIN_RELATIONS.includes(raw.relation) ? raw.relation : 'supports'
  return {
    id: `n-${digest(`${hit.record.id}#${evidenceId}`).slice(0, 8)}`,
    relation,
    paperId: hit.record.id,
    evidenceId,
    page: hit.evidence.page,
    block: hit.evidence.block || null,
    quote: hit.evidence.quote || '',
    note: clip(raw.note, 200),
    title: hit.record.title || '',
    authors: hit.record.authors || '',
    year: hit.record.year || '',
  }
}

function normalizeChain(input, existing = null) {
  const claimText = cleanInline(input?.claim?.text || input?.claim || '')
  if (!claimText) throw fail('empty_claim', '论点不能为空')
  if (claimText.length > 240) throw fail('claim_too_long', '论点请控制在 240 字以内')
  const seen = new Set()
  const nodes = []
  const dropped = []
  for (const raw of input?.nodes || []) {
    const node = normalizeNode(raw)
    if (!node) { dropped.push(String(raw?.evidenceId || '')); continue }
    if (seen.has(node.evidenceId)) continue
    seen.add(node.evidenceId)
    nodes.push(node)
    if (nodes.length >= MAX_NODES) break
  }
  if (!nodes.length) throw fail('no_evidence', '一条链至少要有一个有效证据节点')
  const at = new Date().toISOString()
  const title = clip(input?.title, 60) || clip(claimText, 40)
  return {
    id: existing?.id || `c-${digest(`${claimText}|${at}|${Math.random()}`).slice(0, 8)}`,
    title,
    origin: ['claim', 'evidence', 'question', 'block', 'auto', 'topic'].includes(input?.origin) ? input.origin : 'claim',
    status: input?.status === 'draft' ? 'draft' : 'confirmed',
    confidence: Number.isFinite(Number(input?.confidence))
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : (input.origin === 'auto' || input.origin === 'topic' ? 0.6 : 1),
    topic: cleanInline(input?.topic).slice(0, 80),
    paperIds: [...new Set([
      ...(Array.isArray(input?.paperIds) ? input.paperIds.map((id) => cleanInline(id)).filter(Boolean) : []),
      ...nodes.map((node) => node.paperId),
    ])],
    provenance: input?.provenance && typeof input.provenance === 'object' ? input.provenance : null,
    relations: Array.isArray(input?.relations) ? input.relations.slice(0, 20) : [],
    review: input?.review && typeof input.review === 'object' ? input.review : null,
    warnings: Array.isArray(input?.warnings) ? input.warnings.map((item) => cleanInline(item)).filter(Boolean).slice(0, 10) : [],
    question: cleanInline(input?.question).slice(0, 300),
    claim: {
      text: claimText,
      paperId: cleanInline(input?.claim?.paperId) || nodes[0].paperId,
      sectionKey: cleanInline(input?.claim?.sectionKey),
      source: cleanInline(input?.claim?.source) || 'manual',
    },
    nodes,
    createdAt: existing?.createdAt || at,
    updatedAt: at,
    dropped: dropped.filter(Boolean),
  }
}

export function saveChain(input = {}) {
  ensureDir()
  let existing = null
  if (input.id) {
    existing = readChain(input.id)
    if (!existing) throw fail('not_found', '链不存在')
  }
  const chain = normalizeChain(input, existing)
  const { dropped, ...clean } = chain
  const file = chainPath(clean.id)
  writeFileSync(`${file}.tmp`, JSON.stringify(clean, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return chain
}

export function deleteChain(id) {
  if (!safeId(id) || !existsSync(chainPath(id))) return false
  unlinkSync(chainPath(id))
  return true
}

function citationLabel(node, record) {
  const authors = String(record?.authors || node.authors || '').split(/[,，;；、]/)[0].trim()
  const year = record?.year ?? node.year ?? ''
  const label = `${authors || 'Anon'} ${year || ''}, p.${node.page}`
  return label.replace(/\s+/g, ' ').trim()
}

function nodeClause(node, records) {
  const record = records.get(node.paperId)
  const cite = `[[${node.paperId}#^${node.evidenceId}|${citationLabel(node, record)}]]`
  const note = clip(node.note, 70)
  if (note) return `${note}（${cite}）`
  const quote = clip(node.quote, 80)
  // OCR 引文常从句子中间开始；不完整就只给引用，不把碎片塞进正文。
  const readable = quote.length >= 12
    && /^[A-Z\u4e00-\u9fa5“"'(]/.test(quote)
    && /[.。!?！？;；]$/.test(quote)
  return readable ? `「${quote}」${cite}` : cite
}

/** 链 → 可直接插入文稿的论证段；失效节点跳过并计数。 */
export function chainParagraph(chain) {
  if (!chain) throw fail('not_found', '链不存在')
  const records = new Map(readIndex().map((row) => [row.id, row]))
  const usable = []
  const skipped = []
  for (const node of chain.nodes || []) {
    if (!findEvidence(node.paperId, node.evidenceId)) skipped.push(node.evidenceId)
    else usable.push(node)
  }
  const claimText = cleanInline(chain.claim?.text)
  if (!claimText) throw fail('empty_claim', '论点不能为空')
  if (!usable.length) throw fail('no_evidence', '这条链没有仍有效的证据节点')
  const parts = [`${claimText}${/[。！？.!?]$/.test(claimText) ? '' : '。'}`]
  const pick = (relations) => usable.filter((node) => relations.includes(node.relation))
  const supports = pick(['supports', 'derives'])
  if (supports.length) parts.push(`支持这一判断的证据是：${supports.map((node) => nodeClause(node, records)).join('；')}。`)
  const qualifies = pick(['qualifies'])
  if (qualifies.length) parts.push(`需要限定的条件是：${qualifies.map((node) => nodeClause(node, records)).join('；')}。`)
  const contradicts = pick(['contradicts'])
  if (contradicts.length) parts.push(`也有证据给出不同或相反的结果：${contradicts.map((node) => nodeClause(node, records)).join('；')}。`)
  const compares = pick(['compares'])
  if (compares.length) parts.push(`可比的观察见：${compares.map((node) => nodeClause(node, records)).join('；')}。`)
  return {
    text: parts.join(' '),
    citations: usable.length,
    skipped,
    title: chain.title || '',
  }
}


/** 图布局：`chains/.layout.json`，只存节点坐标，可删可重建。 */
function layoutPath() {
  return join(PATHS.chains, '.layout.json')
}

export function readChainLayout() {
  if (!existsSync(layoutPath())) return {}
  try {
    const data = JSON.parse(readFileSync(layoutPath(), 'utf8'))
    return data && typeof data.positions === 'object' && data.positions ? data.positions : {}
  } catch { return {} }
}

export function writeChainLayout(positions = {}) {
  ensureDir()
  const clean = {}
  let count = 0
  for (const [id, pos] of Object.entries(positions || {})) {
    if (count >= 2000) break
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(id)) continue
    const x = Number(pos?.x)
    const y = Number(pos?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    clean[id] = { x: Math.round(x), y: Math.round(y) }
    count += 1
  }
  const file = layoutPath()
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), positions: clean }, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return clean
}

/** 证据链知识库：claim → evidence → paper；关系用 supports/contradicts/... 标色。 */
export function chainGraph() {
  const rows = listChains()
  const records = new Map(readIndex().map((row) => [row.id, row]))
  const nodes = new Map()
  const edges = []
  const evidenceSeen = new Set()
  const paperSeen = new Set()
  const paperEdges = new Set()
  const chainCounts = new Map()
  let staleEdges = 0

  for (const row of rows) {
    const chain = readChain(row.id)
    if (!chain) continue
    const claimId = `claim:${chain.id}`
    const paperId = chain.claim?.paperId || ''
    for (const id of new Set((chain.nodes || []).map((node) => node.paperId).filter(Boolean))) {
      chainCounts.set(id, (chainCounts.get(id) || 0) + 1)
    }
    nodes.set(claimId, {
      data: {
        id: claimId, kind: 'claim', chainId: chain.id,
        label: clip(chain.claim?.text || chain.title, 90),
        full: String(chain.claim?.text || chain.title || ''),
        short: shortText(chain.claim?.text || chain.title) || '论点',
        title: chain.title || '', origin: chain.origin || 'claim',
        paperId, count: row.nodes, stale: row.stale,
      },
    })
    for (const node of chain.nodes || []) {
      const evidenceId = `evidence:${node.paperId}:${node.evidenceId}`
      if (!nodes.has(evidenceId)) {
        nodes.set(evidenceId, {
          data: {
            id: evidenceId, kind: 'evidence',
            label: clip(node.quote, 80),
            full: String(node.quote || ''),
            short: `p.${node.page} 证据`,
            quote: node.quote || '', page: node.page, block: node.block || '',
            paperId: node.paperId, evidenceId: node.evidenceId,
            title: node.title || records.get(node.paperId)?.title || node.paperId,
            stale: Boolean(node.stale),
          },
        })
        evidenceSeen.add(evidenceId)
      } else if (node.stale) {
        nodes.get(evidenceId).data.stale = true
      }
      const relation = node.relation || 'supports'
      edges.push({
        data: {
          id: `rel:${chain.id}:${node.evidenceId}`,
          source: claimId, target: evidenceId,
          kind: relation, label: RELATION_LABELS[relation] || '支持',
          stale: Boolean(node.stale),
        },
      })
      if (node.stale) staleEdges += 1

      const paperNodeId = `paper:${node.paperId}`
      if (!nodes.has(paperNodeId)) {
        const record = records.get(node.paperId)
        const title = record?.title || node.title || node.paperId
        nodes.set(paperNodeId, {
          data: {
            id: paperNodeId, kind: 'paper', paperId: node.paperId,
            label: clip(title, 50), full: String(title || ''),
            short: paperShort(record, title),
            year: record?.year || node.year || '',
            chains: chainCounts.get(node.paperId) || 0, chained: true,
          },
        })
        paperSeen.add(paperNodeId)
      }
      const paperEdgeId = `excerpt:${node.paperId}:${node.evidenceId}`
      if (!paperEdges.has(paperEdgeId)) {
        paperEdges.add(paperEdgeId)
        edges.push({
          data: {
            id: paperEdgeId, source: evidenceId, target: paperNodeId,
            kind: 'excerpt', label: '', stale: false,
          },
        })
      }
    }
  }

  // 有链时把全库论文都画出来：未建链的论文虚化，单独排在下方，避免「只有一篇论文」的误解。
  if (rows.length) {
    for (const record of records.values()) {
      const paperNodeId = `paper:${record.id}`
      if (nodes.has(paperNodeId)) {
        nodes.get(paperNodeId).data.chains = chainCounts.get(record.id) || 0
        nodes.get(paperNodeId).data.chained = true
        continue
      }
      const title = record.title || record.id
      nodes.set(paperNodeId, {
        data: {
          id: paperNodeId, kind: 'paper', paperId: record.id,
          label: clip(title, 50), full: String(title || ''),
          short: paperShort(record, title), year: record.year || '',
          chains: 0, chained: false, unchained: true,
        },
      })
      paperSeen.add(paperNodeId)
    }
  }

  const positions = readChainLayout()
  const visible = {}
  for (const [id, pos] of Object.entries(positions)) if (nodes.has(id)) visible[id] = pos
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      chains: rows.length,
      claims: rows.length,
      evidence: evidenceSeen.size,
      papers: paperSeen.size,
      chainedPapers: [...nodes.values()].filter((node) => node.data.kind === 'paper' && node.data.chained).length,
      unchainedPapers: [...nodes.values()].filter((node) => node.data.kind === 'paper' && !node.data.chained).length,
      staleEdges,
    },
    nodes: [...nodes.values()],
    edges,
    positions: visible,
  }
}

/** 把一条链的论证段追加到文稿；draftId 为空时新建「论证链」草稿。 */
export function appendChainToDraft({ chain, draftId = '' }) {
  const paragraph = chainParagraph(chain)
  let draft = null
  if (draftId) {
    draft = readDraft(draftId)
    if (!draft) throw fail('not_found', '文稿不存在')
  } else {
    draft = createDraft({
      title: clip(chain.title || chain.claim?.text || '论证链', 40) || '论证链',
      type: '综述',
    })
  }
  const body = String(draft.body || '').trimEnd()
  const nextBody = `${body}${body ? '\n\n' : ''}${paragraph.text}`
  const saved = saveDraft(draft.id, { body: nextBody })
  return {
    ...paragraph,
    draft: { id: saved.id, title: saved.title, chars: nextBody.length },
  }
}
