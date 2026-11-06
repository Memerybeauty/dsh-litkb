/**
 * 图谱（P3）：七段卡 + 证据 → 概念/边 → concepts/edges.jsonl。
 *
 * 硬规则：
 * 1. 只抽四类边：uses / improves_on / evaluates_on / reports；
 * 2. 每条边必须引用卡片里已存在的 evidence_id，页码/块/引文从证据复制；
 * 3. reports 必须有数字 value；没有就丢弃；
 * 4. 目标概念必须是 active（pending 不画），概念合并后自动重建边表。
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callModel, parseModelJson, resolveRoute } from './cardgen.js'
import { readCard } from './cards.js'
import { blocksPath, findBlockForQuote, readBlocks } from './blocks.js'
import { readIndex } from './library.js'
import {
  CONCEPT_KINDS, conceptIndex, conceptUsage, ensureConcept, findConcept, normalizeTerm,
  readAnalysis, readConcepts, readEdges, rebuildEdges, writeAnalysis, writeConcepts,
} from './concepts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const EXTRACT_PROMPT_VERSION = 'graph-extract.v1'
export const NORMALIZE_PROMPT_VERSION = 'graph-normalize.v1'

const EDGE_TYPES = ['uses', 'improves_on', 'evaluates_on', 'reports']
const TYPE_KIND = {
  uses: 'method',
  improves_on: 'method',
  evaluates_on: 'dataset',
  reports: 'metric',
}
const EDGE_LABEL = {
  uses: '使用',
  improves_on: '改进',
  evaluates_on: '在…上评测',
  reports: '报告',
}

function loadPrompt(version) {
  return readFileSync(join(HERE, '..', 'prompts', `${version}.md`), 'utf8')
}

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function edgeId(record, type, source, target, metric, value, evidence) {
  const digest = createHash('sha1')
    .update([record.id, type, source, target, metric || '', value ?? '', evidence].join('|'))
    .digest('hex')
  return `e-${digest.slice(0, 10)}`
}

/* ---------------- 输入组装 ---------------- */

export function buildExtractionInput(record, card) {
  const evidence = card?.evidence || []
  const sections = (card?.sections || []).map((section) => {
    const ids = (section.evidence || []).join(', ') || '无'
    return `### ${section.title}\n${String(section.text || '').trim()}\n（证据：${ids}）`
  })
  const evidences = evidence.map((ev) => `- ${ev.id} | p.${ev.page} | ${clip(ev.quote, 220)}`)
  const head = [
    `【标题】${record.title || '(未命名)'}`,
    `【年份】${record.year || '—'}`,
    `【类型】${record.type || '—'}`,
    `【主题】${(record.topics || []).join('、') || '—'}`,
    '',
    '【七段卡】',
    sections.join('\n\n'),
    '',
    '【证据清单】（边的 evidence 只能从这个清单里选）',
    evidences.join('\n') || '(无)',
  ].join('\n')
  return { system: loadPrompt(EXTRACT_PROMPT_VERSION), user: head }
}

/* ---------------- 候选与归一 ---------------- */

function collectCandidates(parsed) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(parsed?.concepts) ? parsed.concepts : []) {
    const kind = String(raw?.kind || '').toLowerCase()
    const name = String(raw?.name || '').trim()
    if (!CONCEPT_KINDS.includes(kind) || !name || name.length > 80) continue
    const key = `${kind}:${normalizeTerm(name)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind,
      name,
      aliases: (Array.isArray(raw?.aliases) ? raw.aliases : [])
        .map((a) => String(a || '').trim())
        .filter((a) => a && a.length <= 80)
        .slice(0, 6),
      proposed: raw?.proposed === true,
    })
  }
  return out.slice(0, 30)
}

function levenshtein(a, b) {
  const s = normalizeTerm(a)
  const t = normalizeTerm(b)
  if (!s || !t) return Math.max(s.length, t.length)
  if (Math.abs(s.length - t.length) > 6) return 99
  const prev = new Array(t.length + 1)
  for (let j = 0; j <= t.length; j += 1) prev[j] = j
  for (let i = 1; i <= s.length; i += 1) {
    let diagonal = prev[0]
    prev[0] = i
    for (let j = 1; j <= t.length; j += 1) {
      const above = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (s[i - 1] === t[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[t.length]
}

/** 两个名字是否「像同一个东西」（只用于把候选降级为 pending，不会自动合并）。 */
export function looksSimilar(a, b) {
  const x = normalizeTerm(a)
  const y = normalizeTerm(b)
  if (!x || !y) return false
  if (x === y) return true
  // res14 / res15 这类只差数字的名字是不同数据集/版本，不能因为编辑距离近就进待归一。
  const digitsX = (x.match(/\d+/g) || []).join(',')
  const digitsY = (y.match(/\d+/g) || []).join(',')
  if (digitsX !== digitsY && x.replace(/\d+/g, '#') === y.replace(/\d+/g, '#')) return false
  const maxLen = Math.max(x.length, y.length)
  if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) return true
  return levenshtein(x, y) / maxLen <= 0.22
}

async function modelMappings({ ctx, store, candidates }) {
  const route = resolveRoute(ctx)
  const llm = ctx?.get?.('llm')
  if (!route || !llm?.stream) return null
  const existing = (store.concepts || [])
    .filter((c) => c.status === 'active')
    .map((c) => ({ id: c.id, kind: c.kind, name: c.name, aliases: c.aliases || [] }))
  if (!existing.length) return null
  const user = JSON.stringify({
    existing,
    candidates: candidates.map((c) => ({ kind: c.kind, name: c.name, aliases: c.aliases || [] })),
  }, null, 2)
  try {
    const result = await callModel(ctx, route, loadPrompt(NORMALIZE_PROMPT_VERSION), user, null, {
      maxTokens: 2048,
      reasoningEffort: 'off',
    })
    const parsed = parseModelJson(result.text)
    return Array.isArray(parsed?.mappings) ? parsed.mappings : null
  } catch {
    return null
  }
}

/**
 * 把候选解析成词表里的概念：先别名精确匹配，再批量问模型，最后按相似度降级 pending。
 * 返回 name/alias → concept 的映射，供边解析使用。
 */
export async function resolveCandidates({ ctx, store, candidates }) {
  const mapping = new Map()
  const unresolved = []
  for (const candidate of candidates) {
    const hit = findConcept(store, candidate.kind, candidate.name)
    if (hit) {
      ensureConcept(store, { ...candidate, status: hit.status, source: hit.source })
      mapping.set(`${candidate.kind}:${normalizeTerm(candidate.name)}`, hit)
    } else {
      unresolved.push(candidate)
    }
  }
  if (!unresolved.length) return mapping

  const hasVocabulary = (store.concepts || []).some((c) => c.status === 'active')
  const mappings = hasVocabulary ? await modelMappings({ ctx, store, candidates: unresolved }) : null
  const byId = new Map((store.concepts || []).map((c) => [c.id, c]))

  for (const candidate of unresolved) {
    const suggestion = mappings?.find((m) => m
      && String(m.kind || '').toLowerCase() === candidate.kind
      && normalizeTerm(m.name) === normalizeTerm(candidate.name))
    let target = null
    if (suggestion?.match) {
      const found = byId.get(String(suggestion.match))
      if (found && found.kind === candidate.kind) target = found
    }
    if (!target) {
      const similar = (store.concepts || []).find((c) => c.kind === candidate.kind
        && c.status === 'active' && looksSimilar(c.name, candidate.name))
      if (similar) {
        // 没有模型把握的同义候选：进待归一，不直接合并，避免把不同方法并成一个
        target = ensureConcept(store, {
          kind: candidate.kind,
          name: candidate.name,
          aliases: candidate.aliases,
          status: 'pending',
          source: 'llm',
        })
      } else {
        target = ensureConcept(store, {
          kind: candidate.kind,
          name: candidate.name,
          aliases: candidate.aliases,
          status: 'active',
          source: 'llm',
        })
      }
    } else {
      ensureConcept(store, {
        kind: candidate.kind,
        name: candidate.name,
        aliases: candidate.aliases,
        status: target.status,
        source: target.source,
      })
    }
    if (target) mapping.set(`${candidate.kind}:${normalizeTerm(candidate.name)}`, target)
  }
  return mapping
}

/* ---------------- 边校验 ---------------- */

function numericValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw, unit: '' }
  if (typeof raw === 'string') {
    const text = raw.trim()
    const percent = /%/.test(text)
    const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
    if (!match) return null
    const value = Number(match[0])
    if (!Number.isFinite(value)) return null
    return percent ? { value: value / 100, unit: '%' } : { value, unit: '' }
  }
  return null
}

export function normalizeExtraction({ parsed, record, card, store, mapping }) {
  const evidence = new Map((card?.evidence || []).map((ev) => [ev.id, ev]))
  const warnings = []
  let dropped = 0
  const note = (text) => { if (warnings.length < 24) warnings.push(text) }

  const nameToConcept = new Map()
  const addName = (kind, name, concept) => {
    const key = `${kind}:${normalizeTerm(name)}`
    if (!nameToConcept.has(key)) nameToConcept.set(key, concept)
  }
  for (const [key, concept] of mapping || []) {
    nameToConcept.set(key, concept)
  }
  for (const concept of store.concepts || []) {
    addName(concept.kind, concept.name, concept)
    for (const alias of concept.aliases || []) addName(concept.kind, alias, concept)
  }

  const edges = []
  for (const raw of Array.isArray(parsed?.edges) ? parsed.edges : []) {
    const type = String(raw?.type || '').toLowerCase()
    if (!EDGE_TYPES.includes(type)) {
      dropped += 1
      note(`未知边类型「${type || '空'}」，已丢弃`)
      continue
    }
    const expectedKind = TYPE_KIND[type]
    const targetName = String(raw?.target || '').trim()
    const targetConcept = targetName
      ? nameToConcept.get(`${expectedKind}:${normalizeTerm(targetName)}`)
      : null
    if (!targetConcept) {
      dropped += 1
      note(`${EDGE_LABEL[type]}「${targetName || '空'}」找不到${expectedKind}概念，已丢弃`)
      continue
    }
    const ev = evidence.get(String(raw?.evidence || ''))
    if (!ev) {
      dropped += 1
      note(`${EDGE_LABEL[type]}「${targetConcept.name}」引用的证据不存在，已丢弃`)
      continue
    }

    let source = record.id
    const sourceName = String(raw?.source || '').trim()
    if (sourceName) {
      const sourceConcept = nameToConcept.get(`method:${normalizeTerm(sourceName)}`)
      if (sourceConcept && sourceConcept.status === 'active') source = sourceConcept.id
      else note(`边来源「${sourceName}」不是已声明的方法，按论文处理`)
    }

    let metric = ''
    let value = null
    let unit = ''
    let dataset = ''
    if (type === 'reports') {
      const numeric = numericValue(raw?.value)
      if (!numeric) {
        dropped += 1
        note(`「${targetConcept.name}」缺少数字结果，已丢弃`)
        continue
      }
      metric = targetConcept.name
      value = numeric.value
      unit = String(raw?.unit || numeric.unit || '').slice(0, 16)
      dataset = String(raw?.dataset || '').trim().slice(0, 80)
    }

    const confidenceRaw = Number(raw?.confidence)
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0.7

    const id = edgeId(record, type, source, targetConcept.id, metric, value, ev.id)
    if (edges.some((e) => e.id === id)) continue
    edges.push({
      id,
      source,
      target: targetConcept.id,
      type,
      paper: record.id,
      evidence: ev.id,
      page: ev.page,
      block: ev.block || null,
      quote: ev.quote,
      ...(type === 'reports' ? { metric, value, unit, dataset } : {}),
      confidence,
      at: new Date().toISOString(),
    })
  }
  return { edges, warnings, dropped }
}

/* ---------------- 单篇抽取 ---------------- */

export async function analyzePaper({ ctx, record, card, store }) {
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const { system, user } = buildExtractionInput(record, card)
  const result = await callModel(ctx, route, system, user, null, {
    maxTokens: 4096,
    reasoningEffort: 'off',
  })
  const parsed = parseModelJson(result.text)
  const candidates = collectCandidates(parsed)
  const mapping = await resolveCandidates({ ctx, store, candidates })
  const { edges, warnings, dropped } = normalizeExtraction({
    parsed, record, card, store, mapping,
  })
  // 卡片里的 block 可能为空（旧卡未回贴）；构建时按页 + 引文补一次，保证点边能高亮。
  const cachedBlocks = getBlockDoc(record.id)
  if (cachedBlocks) {
    for (const edge of edges) {
      if (edge.block && cachedBlocks.ids.has(edge.block)) continue
      const block = findBlockForQuote(cachedBlocks.doc, edge.page, edge.quote)
      if (block) edge.block = block.id
    }
  }
  const analysis = {
    schema: 1,
    paperId: record.id,
    title: record.title || '',
    year: record.year ?? null,
    model: `${route.provider}/${route.model}`,
    promptVersion: EXTRACT_PROMPT_VERSION,
    normalizePromptVersion: NORMALIZE_PROMPT_VERSION,
    at: new Date().toISOString(),
    candidates: candidates.map((c) => {
      const concept = mapping.get(`${c.kind}:${normalizeTerm(c.name)}`)
      return {
        kind: c.kind,
        name: c.name,
        aliases: c.aliases,
        proposed: c.proposed,
        conceptId: concept?.id || null,
        status: concept?.status || null,
      }
    }),
    edges,
    warnings,
    dropped,
    usage: result.usage || null,
  }
  return analysis
}

/** 旧分析缓存补块：只补 block 为空的边，返回是否有改动。 */
function repairAnalysisBlocks(analysis, paperId) {
  if (!analysis || !Array.isArray(analysis.edges)) return false
  const cached = getBlockDoc(paperId)
  if (!cached) return false
  let changed = false
  for (const edge of analysis.edges) {
    if (edge.block && cached.ids.has(edge.block)) continue
    const block = findBlockForQuote(cached.doc, edge.page, edge.quote)
    if (block && block.id !== edge.block) { edge.block = block.id; changed = true }
  }
  return changed
}

/** 批量构建：默认增量（有缓存跳过），force 重跑。 */
export async function buildAll({ ctx, paperIds = [], force = false, onProgress = () => {} }) {
  const store = readConcepts()
  const wanted = new Set((paperIds || []).filter(Boolean))
  const records = readIndex().filter((r) => !wanted.size || wanted.has(r.id))
  const targets = []
  for (const record of records) {
    const card = readCard(record.id)
    if (card) targets.push({ record, card })
  }
  if (!targets.length) throw fail('no_cards', '库里还没有七段卡，无法构图；请先生成至少一篇卡片')

  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const withoutCard = records.length - targets.length

  let analyzed = 0
  let skipped = 0
  let failed = 0
  let dropped = 0
  const warnings = []
  let lastError = null

  for (let i = 0; i < targets.length; i += 1) {
    const { record, card } = targets[i]
    onProgress({ step: `抽取《${clip(record.title, 28)}》`, done: i, total: targets.length, analyzed, skipped, failed })
    if (!force) {
      const existing = readAnalysis(record.id)
      if (existing) {
        if (repairAnalysisBlocks(existing, record.id)) writeAnalysis(record.id, existing)
        skipped += 1
        continue
      }
    }
    try {
      const analysis = await analyzePaper({ ctx, record, card, store })
      writeAnalysis(record.id, analysis)
      writeConcepts(store)
      analyzed += 1
      dropped += analysis.dropped || 0
      for (const warning of analysis.warnings || []) {
        if (warnings.length < 40) warnings.push(`${record.id}：${warning}`)
      }
    } catch (error) {
      failed += 1
      lastError = error
      if (warnings.length < 40) warnings.push(`${record.id}：抽取失败（${error?.message || error}）`)
    }
  }

  if (analyzed === 0 && skipped === 0 && failed > 0) throw lastError || fail('llm_error', '图谱抽取失败')

  const edges = rebuildEdges()
  const pending = store.concepts.filter((c) => c.status === 'pending').length
  if (withoutCard > 0) warnings.unshift(`${withoutCard} 篇没有七段卡，已跳过（先生成卡片再构图）`)
  const summary = {
    papers: targets.length,
    withoutCard,
    analyzed,
    skipped,
    failed,
    edges: edges.length,
    dropped,
    pending,
    warnings,
  }
  onProgress({ step: '重建边表', done: targets.length, total: targets.length, ...summary })
  return summary
}

/* ---------------- 图数据 ---------------- */

const blockDocCache = new Map()

/**
 * 按论文取版面块并缓存；引用 blocks 文件 mtime，重建解析稿后自动失效。
 * 返回 { doc, ids } 或 null。
 */
function getBlockDoc(paperId) {
  let mtime = 0
  try {
    mtime = statSync(blocksPath(paperId)).mtimeMs
  } catch {
    blockDocCache.set(paperId, { mtime: 0, doc: null, ids: new Set() })
    return null
  }
  const cached = blockDocCache.get(paperId)
  if (cached && cached.mtime === mtime) return cached.doc ? cached : null
  const doc = readBlocks(paperId)
  if (!doc) {
    blockDocCache.set(paperId, { mtime, doc: null, ids: new Set() })
    return null
  }
  const entry = {
    mtime,
    doc,
    ids: new Set(doc.pages.flatMap((page) => (page.blocks || []).map((block) => block.id))),
  }
  blockDocCache.set(paperId, entry)
  return entry
}

/** 边没有 block 或 block 已失效时，按页 + 引文回贴；返回副本，不写盘。 */
function ensureEdgeBlock(edge) {
  const cached = getBlockDoc(edge.paper)
  if (!cached) return edge
  if (edge.block && cached.ids.has(edge.block)) return edge
  const block = findBlockForQuote(cached.doc, edge.page, edge.quote)
  if (!block) return edge
  return { ...edge, block: block.id, blockRepaired: true }
}

export function readGraph() {
  const records = readIndex()
  const store = readConcepts()
  const edges = readEdges()
  const concepts = new Map(store.concepts.map((c) => [c.id, c]))
  const nodes = new Map()

  const ensurePaper = (record) => {
    if (!record || nodes.has(record.id)) return
    const card = readCard(record.id)
    const analysis = readAnalysis(record.id)
    if (!card && !analysis) return
    nodes.set(record.id, {
      id: record.id,
      type: 'paper',
      name: record.title || record.id,
      title: record.title || record.id,
      year: record.year ?? null,
      paperType: record.type || '',
      topics: record.topics || [],
      cardStatus: card?.status || null,
      analyzed: Boolean(analysis),
      degree: 0,
    })
  }
  for (const record of records) ensurePaper(record)

  const kept = []
  for (const edge of edges) {
    const target = concepts.get(edge.target)
    if (!target || target.status !== 'active') continue
    const record = records.find((r) => r.id === edge.paper || r.id === edge.source)
    if (record) ensurePaper(record)
    if (!nodes.has(edge.paper)) continue
    if (String(edge.source).startsWith('c-') && !concepts.has(edge.source)) continue
    const withBlock = ensureEdgeBlock(edge)
    if (String(edge.source).startsWith('c-')) {
      const source = concepts.get(edge.source)
      if (source && !nodes.has(source.id)) {
        nodes.set(source.id, {
          id: source.id,
          type: 'concept',
          kind: source.kind,
          name: source.name,
          aliases: source.aliases || [],
          degree: 0,
        })
      }
    }
    if (!nodes.has(target.id)) {
      nodes.set(target.id, {
        id: target.id,
        type: 'concept',
        kind: target.kind,
        name: target.name,
        aliases: target.aliases || [],
        degree: 0,
      })
    }
    kept.push(withBlock)
  }

  const degree = new Map()
  for (const edge of kept) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  }
  const nodeList = [...nodes.values()].map((node) => ({ ...node, degree: degree.get(node.id) || 0 }))
  const byId = new Map(nodeList.map((n) => [n.id, n]))

  const graphEdges = kept
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({
      ...edge,
      sourceName: byId.get(edge.source)?.name || edge.source,
      targetName: byId.get(edge.target)?.name || edge.target,
      sourceType: byId.get(edge.source)?.type || 'paper',
      targetType: byId.get(edge.target)?.type || 'concept',
    }))

  const topics = [...new Set(records.flatMap((r) => r.topics || []))].sort((a, b) => a.localeCompare(b, 'zh'))
  const analyses = records.filter((r) => readAnalysis(r.id)).length
  return {
    nodes: nodeList,
    edges: graphEdges,
    meta: {
      papers: records.length,
      paperNodes: nodeList.filter((n) => n.type === 'paper').length,
      conceptNodes: nodeList.filter((n) => n.type === 'concept').length,
      edges: graphEdges.length,
      evidenceCoverage: graphEdges.length
        ? Number((graphEdges.filter((e) => e.evidence && e.page).length / graphEdges.length).toFixed(3))
        : 1,
      pending: store.concepts.filter((c) => c.status === 'pending').length,
      concepts: store.concepts.length,
      analyses,
      at: new Date().toISOString(),
    },
    topics,
  }
}

/* ---------------- 可比组 ---------------- */

export function compareGroups() {
  const records = new Map(readIndex().map((r) => [r.id, r]))
  const store = readConcepts()
  const conceptName = new Map(store.concepts.map((c) => [c.id, c.name]))
  const groups = new Map()

  for (const edge of readEdges()) {
    if (edge.type !== 'reports' || typeof edge.value !== 'number' || !Number.isFinite(edge.value)) continue
    const dataset = edge.dataset || '未注明'
    const metric = conceptName.get(edge.target) || edge.metric || '未注明指标'
    const key = `${dataset}::${metric}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        dataset,
        metric,
        unit: edge.unit || '',
        rows: [],
        _latest: new Map(),
      })
    }
    const group = groups.get(key)
    const rowKey = `${edge.paper}::${metric}`
    const at = Date.parse(edge.at || '') || 0
    const previous = group._latest.get(rowKey)
    if (previous && previous.at >= at) continue
    const record = records.get(edge.paper)
    group._latest.set(rowKey, { at })
    group.rows = group.rows.filter((row) => row.paper !== edge.paper)
    group.rows.push({
      paper: edge.paper,
      title: record?.title || edge.paper,
      year: record?.year ?? null,
      value: edge.value,
      unit: edge.unit || '',
      evidence: edge.evidence,
      page: edge.page,
      quote: edge.quote,
      at: edge.at,
    })
  }

  return [...groups.values()]
    .map((group) => {
      const { _latest, ...rest } = group
      return {
        ...rest,
        rows: rest.rows.sort((a, b) => b.value - a.value || String(b.year || '').localeCompare(String(a.year || ''))),
      }
    })
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length || a.dataset.localeCompare(b.dataset, 'zh'))
}

/* ---------------- 词表管理 ---------------- */

export function conceptOverview() {
  const store = readConcepts()
  const usage = conceptUsage()
  const concepts = (store.concepts || []).map((concept) => ({
    ...concept,
    usage: usage.get(concept.id) || 0,
  }))
  return {
    concepts,
    pending: concepts.filter((c) => c.status === 'pending'),
    active: concepts.filter((c) => c.status === 'active'),
    updatedAt: store.updatedAt,
  }
}

export { EDGE_LABEL, EDGE_TYPES, TYPE_KIND, conceptIndex }
