/**
 * 研究方向分析（v0.16.0）：
 *   一篇论文进入研究主题后，按每条研究内容（facet）做全文判断：
 *   是否符合、什么立场、有哪些观点、证据 q-id。
 *   再把多篇论文的观点合成观点簇，标出一致/分歧；观点可一键生成草稿链。
 *
 * 与旧的主题建链互补：旧链是 BM25 快速候选；这里是对整篇论文的方向审查。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, readIndex } from './library.js'
import { readCard, writeCard } from './cards.js'
import { readBlocks } from './blocks.js'
import { readDeepRead } from './deepread.js'
import { buildPageIndex, locateQuote, makeEvidence } from './evidence.js'
import { callModel, parseModelJson } from './cardgen.js'
import { listChains, nodeForEvidence, readChain, saveChain } from './chains.js'
import { readTheme, themePapers } from './themes.js'

const STANCES = ['supports', 'contradicts', 'qualifies', 'mixed', 'mentions', 'not_relevant']
const ROLES = ['method', 'data', 'metric', 'result', 'limitation', 'definition', 'comparison']
export const ANALYSIS_MATCHER = 'theme-analysis.v1'
const MAX_FULLTEXT = 60000
const MAX_CANDIDATES = 100
const MAX_NEW_EVIDENCE = 24

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function analysisDir() {
  return join(PATHS.themes, 'analysis')
}

function analysisPath(themeId) {
  return join(analysisDir(), `${themeId}.json`)
}

function safeThemeId(themeId) {
  return /^t-[a-z0-9]{6,16}$/.test(String(themeId || ''))
}

export function readAnalysis(themeId) {
  if (!safeThemeId(themeId)) return null
  try {
    const parsed = JSON.parse(readFileSync(analysisPath(themeId), 'utf8'))
    if (!parsed || parsed.themeId !== themeId) return null
    return parsed
  } catch {
    return null
  }
}

export function saveAnalysis(analysis) {
  if (!analysis || !safeThemeId(analysis.themeId)) throw fail('bad_theme', '研究 ID 不合法')
  if (!existsSync(analysisDir())) mkdirSync(analysisDir(), { recursive: true })
  const file = analysisPath(analysis.themeId)
  const payload = { ...analysis, version: 1, updatedAt: new Date().toISOString() }
  writeFileSync(`${file}.tmp`, JSON.stringify(payload, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return payload
}

function pageEntries(paperId) {
  const doc = readBlocks(paperId)
  if (!doc) return []
  const pages = []
  for (const page of doc.pages || []) {
    const blocks = (page.blocks || [])
      .filter((block) => block && block.text && !['header', 'footer'].includes(block.role))
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    const text = blocks.map((block) => block.text).join('\n').trim()
    if (text) pages.push({ page: page.page, text })
  }
  return pages
}

function deepreadText(paperId) {
  const deepread = readDeepRead(paperId)
  if (!deepread) return ''
  const sections = Array.isArray(deepread.sections) ? deepread.sections : []
  const parts = sections.map((section) => `## ${section.title || section.key || ''}\n${section.markdown || ''}`)
  return parts.join('\n\n').slice(0, 14000)
}

function cardText(card) {
  if (!card) return ''
  const sections = (card.sections || []).map((section) => `## ${section.title || section.key || ''}\n${section.text || ''}`)
  return sections.join('\n\n').slice(0, 9000)
}

function candidateEvidence(card) {
  const list = (card?.evidence || []).slice(0, MAX_CANDIDATES)
  return list.map((ev) => `[${ev.id}] p.${ev.page} | ${clip(ev.quote, 260)}`).join('\n')
}

export function buildPaperSource(record) {
  const card = readCard(record.id)
  const pages = pageEntries(record.id)
  const deepread = deepreadText(record.id)
  const full = pages.map((page) => `【p.${page.page}】\n${page.text}`).join('\n\n')
  const fullText = full.slice(0, MAX_FULLTEXT)
  const meta = [
    `【论文】${record.title || record.id}`,
    `作者：${record.authors || '未知'}；年份：${record.year || '未知'}；期刊/会议：${record.venue || '未知'}`,
    `标签：${(record.topics || []).join(' / ') || '无'}`,
  ].join('\n')
  const parts = [meta]
  const cardBody = cardText(card)
  if (deepread) parts.push(`【精读摘要】\n${deepread}`)
  if (cardBody) parts.push(`【七段卡摘要】\n${cardBody}`)
  const candidates = candidateEvidence(card)
  if (candidates) parts.push(`【候选证据 q-id（优先从这里选）】\n${candidates}`)
  if (fullText) parts.push(`【全文节选】\n${fullText}`)
  const text = parts.join('\n\n')
  return {
    text,
    pages,
    card,
    hasFullText: Boolean(fullText),
    truncated: full.length > MAX_FULLTEXT,
    chars: text.length,
  }
}

function promptFacets(facets) {
  return facets.map((facet) => {
    const keywords = (facet.keywords || []).join(' / ')
    return `- ${facet.key}｜${facet.title}｜${facet.description || '无描述'}${keywords ? `｜关键词：${keywords}` : ''}`
  }).join('\n')
}

const EXTRACT_SYSTEM = [
  '你是严谨的文献研究员。你的任务不是写综述，而是判断一篇论文对一个研究方向的每条研究内容分别意味着什么。',
  '只输出 JSON，不要解释。所有观点必须有原文依据；不能编造 q-id 或引文。',
].join('\n')

export async function extractPaperAnalysis({ ctx, route, theme, record, facetKeys = [] } = {}) {
  if (!ctx || !route) throw fail('no_model', '没有可用模型')
  if (!theme || !record) throw fail('bad_input', '缺少研究或论文')
  const wanted = Array.isArray(facetKeys) && facetKeys.length ? new Set(facetKeys) : null
  const facets = (theme.facets || []).filter((facet) => facet.enabled && (!wanted || wanted.has(facet.key)))
  if (!facets.length) throw fail('no_facets', '研究没有启用的细分描述')
  const source = buildPaperSource(record)
  if (!source.card) throw fail('no_card', '这篇论文还没有七段卡，无法做方向分析')
  if (!source.hasFullText && !source.text) throw fail('no_text', '这篇论文没有可分析的原文')

  const user = [
    `【研究方向】${theme.title}`,
    theme.description ? `研究描述：${theme.description}` : '',
    '',
    '【研究内容】',
    promptFacets(facets),
    '',
    source.text,
    '',
    '【任务】',
    '逐条判断这篇论文对每条研究内容的关系。对每条研究内容输出：',
    '1. relevance：0=不符合/未涉及，1=只提及背景，2=部分符合，3=直接相关；',
    '2. stance：supports / contradicts / qualifies / mixed / mentions / not_relevant；',
    '3. summary：不超过 80 字，概括这篇论文在该研究内容上的观点；',
    '4. rationale：不超过 100 字，说明为什么符合或不符合；',
    '5. claims：0–3 条观点，每条 text 不超过 120 字；role 取 method/data/metric/result/limitation/definition/comparison；',
    '   evidenceIds 只能从上面的候选 q-id 里选；如果论点依赖候选之外的原文，给 quote（必须逐字来自全文）和 page，服务端会回贴校验。',
    '规则：',
    '- 不要把标题、作者、致谢、参考文献当证据；',
    '- 没有涉及就 relevance=0、stance=not_relevant、claims=[]，不要硬凑；',
    '- 不确定的观点不要写；宁可少一条，也不要编造。',
    '',
    '只输出 JSON：',
    '{"facets":{"f1":{"relevance":3,"stance":"supports","summary":"...","rationale":"...","claims":[{"text":"...","role":"result","evidenceIds":["q-..."],"quote":"","page":1}]}}}',
  ].filter(Boolean).join('\n')

  const result = await callModel(ctx, route, EXTRACT_SYSTEM, user, null, {
    maxTokens: 8192,
    reasoningEffort: 'off',
  })
  const parsed = parseModelJson(result.text)
  const rawFacets = parsed?.facets && typeof parsed.facets === 'object' ? parsed.facets : {}
  const normalized = {}
  for (const facet of facets) {
    normalized[facet.key] = normalizeFacetAnalysis(rawFacets[facet.key], facet)
  }
  const anchored = anchorClaims(record, source.card, source.pages, normalized)
  return {
    paperId: record.id,
    title: record.title || record.id,
    authors: record.authors || '',
    year: record.year || '',
    venue: record.venue || '',
    facets: anchored.facets,
    evidence: anchored.evidence,
    meta: {
      chars: source.chars,
      fullText: source.hasFullText,
      truncated: source.truncated,
      newEvidence: anchored.newEvidence.length,
      model: `${route.provider}/${route.model}`,
    },
  }
}

function normalizeFacetAnalysis(raw, facet) {
  const relevance = Math.max(0, Math.min(3, Math.round(Number(raw?.relevance) || 0)))
  let stance = STANCES.includes(raw?.stance) ? raw.stance : (relevance > 0 ? 'mentions' : 'not_relevant')
  if (!relevance && stance !== 'not_relevant') stance = 'not_relevant'
  if (relevance && stance === 'not_relevant') stance = 'mentions'
  const claims = []
  for (const item of Array.isArray(raw?.claims) ? raw.claims.slice(0, 3) : []) {
    const text = clip(item?.text, 180)
    if (!text) continue
    claims.push({
      text,
      role: ROLES.includes(item?.role) ? item.role : 'result',
      evidenceIds: Array.isArray(item?.evidenceIds)
        ? item.evidenceIds.map((id) => String(id || '')).filter((id) => /^q-[0-9a-f]{8}$/.test(id)).slice(0, 4)
        : [],
      quote: clip(item?.quote, 600),
      page: Math.max(0, Math.round(Number(item?.page) || 0)),
    })
  }
  return {
    relevance,
    stance,
    summary: clip(raw?.summary, 160),
    rationale: clip(raw?.rationale, 200),
    claims,
    facetTitle: facet.title,
  }
}

function anchorClaims(record, card, pages, facets) {
  const byId = new Map((card.evidence || []).map((ev) => [ev.id, ev]))
  const pageIndex = buildPageIndex(pages)
  const newEvidence = []
  for (const analysis of Object.values(facets)) {
    for (const claim of analysis.claims) {
      const ids = [...new Set(claim.evidenceIds.filter((id) => byId.has(id)))]
      if (!ids.length && claim.quote) {
        const located = locateQuote(claim.quote, pageIndex, claim.page || undefined)
        if (located) {
          const pageEntry = pages.find((page) => page.page === located.page)
          if (pageEntry) {
            const evidence = makeEvidence(pageEntry, located)
            if (!byId.has(evidence.id)) {
              if (newEvidence.length >= MAX_NEW_EVIDENCE) continue
              byId.set(evidence.id, evidence)
              newEvidence.push(evidence)
            }
            ids.push(evidence.id)
          }
        }
      }
      claim.evidenceIds = [...new Set(ids)]
      claim.supported = claim.evidenceIds.length > 0
    }
  }
  if (newEvidence.length) {
    try {
      writeCard({ ...card, evidence: [...(card.evidence || []), ...newEvidence] }, record)
    } catch { /* 证据回写失败不阻断分析 */ }
  }
  const evidence = {}
  for (const analysis of Object.values(facets)) {
    for (const claim of analysis.claims) {
      for (const evidenceId of claim.evidenceIds) {
        const found = byId.get(evidenceId)
        if (found) evidence[evidenceId] = { id: found.id, page: found.page, quote: found.quote || '' }
      }
    }
  }
  return { facets, newEvidence, evidence }
}

function synthesisPrompt(theme, facet, papers) {
  const rows = papers.map((paper) => {
    const analyzed = paper.facets?.[facet.key]
    const claims = (analyzed?.claims || []).map((claim) => `  - ${claim.text}（${claim.evidenceIds.join('、') || '无 q-id'}）`).join('\n')
    return [
      `[${paper.paperId}] ${paper.title}`,
      `  立场：${analyzed?.stance || 'not_relevant'}；相关度：${analyzed?.relevance || 0}`,
      `  概括：${analyzed?.summary || ''}`,
      claims ? `  观点：\n${claims}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  return [
    `【研究方向】${theme.title}`,
    `【研究内容】${facet.title}`,
    facet.description ? `描述：${facet.description}` : '',
    '',
    '【各论文在该研究内容上的观点】',
    rows,
    '',
    '【任务】',
    '把这些论文归纳成 1–5 个观点簇。每个观点必须说明：',
    '- statement：观点句，不超过 120 字；',
    '- papers：支持这个观点的论文 id 列表；',
    '- evidenceIds：这些论文里能支撑该观点的 q-id；',
    '- agreements：观点内部/论文之间一致的地方；',
    '- disagreements：论文之间的差异、限定或冲突。',
    '另外输出整条研究内容层面的 agreements / disagreements / gaps。',
    '不要编造论文 id 或 q-id；只有一篇论文时也可以只有一个观点。',
    '',
    '只输出 JSON：',
    '{"viewpoints":[{"statement":"...","papers":["p-..."],"evidenceIds":["q-..."],"agreements":["..."],"disagreements":["..."]}],"agreements":["..."],"disagreements":["..."],"gaps":["..."]}',
  ].filter(Boolean).join('\n')
}

export async function synthesizeFacet({ ctx, route, theme, facet, papers = [] } = {}) {
  const relevant = papers.filter((paper) => {
    const analyzed = paper.facets?.[facet.key]
    return analyzed && analyzed.relevance > 0 && analyzed.stance !== 'not_relevant'
  })
  if (!relevant.length) {
    return {
      key: facet.key,
      title: facet.title,
      viewpoints: [],
      agreements: [],
      disagreements: [],
      gaps: ['没有论文涉及这条研究内容'],
      paperCount: papers.length,
      relevantCount: 0,
    }
  }
  if (!ctx || !route) throw fail('no_model', '没有可用模型')
  const result = await callModel(ctx, route, EXTRACT_SYSTEM, synthesisPrompt(theme, facet, relevant), null, {
    maxTokens: 4096,
    reasoningEffort: 'off',
  })
  const parsed = parseModelJson(result.text)
  const normalized = normalizeSynthesis(parsed, relevant, facet)
  const evidenceCount = normalized.viewpoints.reduce((sum, viewpoint) => sum + viewpoint.evidence.length, 0)
  const confidence = relevant.length > 1
    ? Math.min(0.95, 0.4 + Math.min(0.25, relevant.length * 0.06) + Math.min(0.2, evidenceCount * 0.03) + (normalized.agreements.length ? 0.05 : 0))
    : Math.min(0.8, 0.35 + Math.min(0.2, evidenceCount * 0.04))
  return {
    key: facet.key,
    title: facet.title,
    viewpoints: normalized.viewpoints.map((viewpoint, index) => ({ ...viewpoint, confidence })),
    agreements: normalized.agreements,
    disagreements: normalized.disagreements,
    gaps: [
      ...normalized.gaps,
      ...(relevant.length === 1 ? ['目前只有 1 篇论文涉及，无法做跨论文比较'] : []),
    ],
    paperCount: papers.length,
    relevantCount: relevant.length,
    evidenceCount,
  }
}

function normalizeSynthesis(parsed, papers, facet) {
  const byPaper = new Map(papers.map((paper) => [paper.paperId, paper]))
  const cardById = new Map(papers.map((paper) => [paper.paperId, readCard(paper.paperId)]))
  const evidenceIndex = new Map()
  for (const paper of papers) {
    const analyzed = paper.facets?.[facet.key]
    for (const claim of analyzed?.claims || []) {
      for (const evidenceId of claim.evidenceIds || []) {
        evidenceIndex.set(`${paper.paperId}#${evidenceId}`, { paperId: paper.paperId, evidenceId })
      }
    }
  }
  const viewpoints = []
  for (const raw of Array.isArray(parsed?.viewpoints) ? parsed.viewpoints.slice(0, 5) : []) {
    const statement = clip(raw?.statement, 200)
    if (!statement) continue
    const ids = Array.isArray(raw?.papers)
      ? raw.papers.map((id) => String(id || '')).filter((id) => byPaper.has(id))
      : []
    if (!ids.length) continue
    const evidence = []
    for (const evidenceId of Array.isArray(raw?.evidenceIds) ? raw.evidenceIds : []) {
      const id = String(evidenceId || '')
      for (const paperId of ids) {
        if (evidenceIndex.has(`${paperId}#${id}`)) {
          const found = (cardById.get(paperId)?.evidence || []).find((ev) => ev.id === id)
          evidence.push({ paperId, evidenceId: id, page: found?.page, quote: found?.quote || '' })
          break
        }
      }
    }
    viewpoints.push({
      id: `v${viewpoints.length + 1}`,
      statement,
      papers: [...new Set(ids)],
      evidence,
      agreements: Array.isArray(raw?.agreements) ? raw.agreements.map((item) => clip(item, 240)).filter(Boolean).slice(0, 6) : [],
      disagreements: Array.isArray(raw?.disagreements) ? raw.disagreements.map((item) => clip(item, 240)).filter(Boolean).slice(0, 6) : [],
    })
  }
  if (!viewpoints.length) {
    for (const paper of papers) {
      const analyzed = paper.facets?.[facet.key]
      const claim = analyzed?.claims?.[0]
      viewpoints.push({
        id: `v${viewpoints.length + 1}`,
        statement: analyzed?.summary || claim?.text || facet.title,
        papers: [paper.paperId],
        evidence: (analyzed?.claims || []).flatMap((item) => (item.evidenceIds || []).map((evidenceId) => ({ paperId: paper.paperId, evidenceId }))).slice(0, 4),
        agreements: [],
        disagreements: [],
      })
    }
  }
  return {
    viewpoints,
    agreements: Array.isArray(parsed?.agreements) ? parsed.agreements.map((item) => clip(item, 240)).filter(Boolean).slice(0, 8) : [],
    disagreements: Array.isArray(parsed?.disagreements) ? parsed.disagreements.map((item) => clip(item, 240)).filter(Boolean).slice(0, 8) : [],
    gaps: Array.isArray(parsed?.gaps) ? parsed.gaps.map((item) => clip(item, 240)).filter(Boolean).slice(0, 6) : [],
  }
}

/** 从观点生成 draft 链；同一观点已有 confirmed 时只生成补充草稿。 */
export function createViewpointChain({ themeId, facetKey, viewpointId } = {}) {
  const analysis = readAnalysis(themeId)
  if (!analysis) throw fail('no_analysis', '还没有方向分析，请先运行分析')
  const theme = readTheme(themeId)
  if (!theme) throw fail('not_found', '研究不存在')
  const facet = (theme.facets || []).find((item) => item.key === facetKey)
  const viewpoint = analysis.facets?.[facetKey]?.viewpoints?.find((item) => item.id === viewpointId)
  if (!facet || !viewpoint) throw fail('not_found', '观点不存在')
  const nodes = (viewpoint.evidence || [])
    .map((item) => nodeForEvidence(item.paperId, item.evidenceId, 'supports'))
    .filter(Boolean)
  if (!nodes.length) throw fail('no_evidence', '这个观点还没有可锚定的证据')
  const related = listChains()
    .map((item) => readChain(item.id))
    .filter((chain) => chain?.provenance?.themeId === themeId
      && chain?.provenance?.facetKey === facetKey
      && chain?.provenance?.viewpointId === viewpointId)
  const existing = related.find((chain) => chain.status === 'draft') || related[0] || null
  const confirmed = existing?.status === 'confirmed'
  const chain = saveChain({
    id: confirmed ? undefined : existing?.id,
    title: clip(viewpoint.statement, 60),
    origin: 'topic',
    status: 'draft',
    confidence: viewpoint.confidence || 0.6,
    topic: theme.title,
    paperIds: viewpoint.papers,
    question: '',
    provenance: {
      themeId,
      facetKey,
      viewpointId,
      analysisRunId: analysis.runId || '',
      matcher: ANALYSIS_MATCHER,
      previousChainId: confirmed ? existing.id : undefined,
      agreements: viewpoint.agreements || [],
      disagreements: viewpoint.disagreements || [],
    },
    warnings: [
      ...(viewpoint.papers?.length === 1 ? ['只有 1 篇论文支撑这个观点'] : []),
      ...(viewpoint.evidence?.length ? [] : ['这个观点还没有绑定证据 q-id']),
    ],
    claim: {
      text: clip(viewpoint.statement, 240),
      paperId: viewpoint.papers?.[0] || nodes[0].paperId,
      sectionKey: '',
      source: 'topic',
    },
    nodes,
  })
  return chain
}

export function analysisStats(analysis) {
  if (!analysis) return { papers: 0, relevant: 0, viewpoints: 0, gaps: 0 }
  const papers = Object.keys(analysis.papers || {})
  let relevant = 0
  for (const paper of Object.values(analysis.papers || {})) {
    if (Object.values(paper.facets || {}).some((item) => item.relevance > 0)) relevant += 1
  }
  let viewpoints = 0
  let gaps = 0
  for (const facet of Object.values(analysis.facets || {})) {
    viewpoints += (facet.viewpoints || []).length
    if (!(facet.viewpoints || []).length) gaps += 1
  }
  return { papers: papers.length, relevant, viewpoints, gaps }
}

/** 供服务端任务使用：按主题论文清单读取记录。 */
export function analysisPapers(theme) {
  const records = new Map(readIndex().map((record) => [record.id, record]))
  return themePapers(theme)
    .map((row) => records.get(row.paperId))
    .filter((record) => record && existsSync(join(PATHS.cards, `${record.id}.card.json`)))
}
