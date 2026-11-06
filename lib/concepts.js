/**
 * 概念词表（P3）：`concepts/concepts.json` 是方法 / 数据集 / 指标的受控词表。
 *
 * 三条规则：
 * 1. 概念不自由生长：同类同名（归一化后）只保留一个，旧名进别名；
 * 2. 拿不准的标 `pending`，不进图；人工合并/批准后才转 `active`；
 * 3. ID 由 kind + 归一化名生成，改名不换 ID，旧名自动保留为别名。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { PATHS } from './library.js'

export const CONCEPT_KINDS = ['method', 'dataset', 'metric']
export const CONCEPT_PATH = join(PATHS.concepts, 'concepts.json')
export const EDGES_PATH = join(PATHS.concepts, 'edges.jsonl')
export const ANALYSIS_DIR = join(PATHS.concepts, 'papers')

const EMPTY = { version: 1, updatedAt: null, concepts: [] }

function ensureDir() {
  if (!existsSync(PATHS.concepts)) mkdirSync(PATHS.concepts, { recursive: true })
  if (!existsSync(ANALYSIS_DIR)) mkdirSync(ANALYSIS_DIR, { recursive: true })
}

/** NFKC → 小写 → 去空白与常见标点/连字符；U-Net / UNet / u net 归一后同名。 */
export function normalizeTerm(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00a0\u3000\-_/\\.,;:!?'"“”‘’()\[\]{}<>《》〈〉【】、，。；：！？·…—–&+]/g, '')
}

export function conceptId(kind, name) {
  const digest = createHash('sha1').update(`${kind}:${normalizeTerm(name)}`).digest('hex')
  return `c-${digest.slice(0, 8)}`
}

export function readConcepts() {
  ensureDir()
  if (!existsSync(CONCEPT_PATH)) return { ...EMPTY, concepts: [] }
  try {
    const data = JSON.parse(readFileSync(CONCEPT_PATH, 'utf8'))
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt || null,
      concepts: Array.isArray(data.concepts)
        ? data.concepts.filter((c) => c && CONCEPT_KINDS.includes(c.kind) && c.name)
        : [],
    }
  } catch {
    return { ...EMPTY, concepts: [] }
  }
}

export function writeConcepts(store) {
  ensureDir()
  const data = {
    version: 1,
    updatedAt: new Date().toISOString(),
    concepts: (store.concepts || []).map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      aliases: [...new Set(c.aliases || [])],
      definition: c.definition || '',
      status: c.status === 'pending' ? 'pending' : 'active',
      source: c.source || 'llm',
      createdAt: c.createdAt || new Date().toISOString(),
      updatedAt: c.updatedAt || null,
    })),
  }
  const tmp = CONCEPT_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, CONCEPT_PATH)
  store.updatedAt = data.updatedAt
  return data
}

/** 别名索引：归一化名 → concept（同 kind 内）。冲突时先到先得。 */
export function conceptIndex(store) {
  const index = new Map()
  for (const concept of store.concepts || []) {
    for (const name of [concept.name, ...(concept.aliases || [])]) {
      const key = `${concept.kind}:${normalizeTerm(name)}`
      if (key.endsWith(':') || index.has(key)) continue
      index.set(key, concept)
    }
  }
  return index
}

export function findConcept(store, kind, name) {
  if (!CONCEPT_KINDS.includes(kind)) return null
  return conceptIndex(store).get(`${kind}:${normalizeTerm(name)}`) || null
}

export function getConcept(store, id) {
  return (store.concepts || []).find((c) => c.id === id) || null
}

function uniqueAliases(name, aliases) {
  const seen = new Set([normalizeTerm(name)])
  const out = []
  for (const alias of aliases || []) {
    const value = String(alias || '').trim()
    const key = normalizeTerm(value)
    if (!value || !key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** 新建或取回概念；same kind + normalized name 已存在时返回已有的。 */
export function ensureConcept(store, { kind, name, aliases = [], definition = '', status = 'active', source = 'llm' }) {
  const clean = String(name || '').trim()
  if (!CONCEPT_KINDS.includes(kind) || !clean) return null
  const existing = findConcept(store, kind, clean)
  if (existing) {
    let changed = false
    for (const alias of uniqueAliases(clean, [clean, ...aliases])) {
      if (normalizeTerm(alias) === normalizeTerm(existing.name)) continue
      if (!(existing.aliases || []).some((a) => normalizeTerm(a) === normalizeTerm(alias))) {
        existing.aliases = [...(existing.aliases || []), alias]
        changed = true
      }
    }
    if (changed) existing.updatedAt = new Date().toISOString()
    return existing
  }
  const concept = {
    id: conceptId(kind, clean),
    kind,
    name: clean,
    aliases: uniqueAliases(clean, aliases),
    definition,
    status: status === 'pending' ? 'pending' : 'active',
    source,
    createdAt: new Date().toISOString(),
  }
  // ID 碰撞（极端哈希冲突）：加后缀，保证唯一
  if (getConcept(store, concept.id)) concept.id = `${concept.id}-${store.concepts.length + 1}`
  store.concepts.push(concept)
  return concept
}

/** 合并：from 的正式名 + 别名并入 into，删除 from；同 kind 才允许。 */
export function mergeConcepts(store, fromId, intoId) {
  if (!fromId || !intoId || fromId === intoId) {
    return { ok: false, code: 'invalid', error: '需要两个不同的概念' }
  }
  const from = getConcept(store, fromId)
  const into = getConcept(store, intoId)
  if (!from || !into) return { ok: false, code: 'not_found', error: '概念不存在' }
  if (from.kind !== into.kind) return { ok: false, code: 'kind_mismatch', error: '只能合并同类概念' }
  into.aliases = [...new Set([...(into.aliases || []), from.name, ...(from.aliases || [])])]
    .filter((a) => normalizeTerm(a) !== normalizeTerm(into.name))
  into.updatedAt = new Date().toISOString()
  store.concepts = store.concepts.filter((c) => c.id !== from.id)
  repointAnalyses(from.id, into.id)
  return { ok: true, from, into }
}

/** 改名 / 加别名 / 批准待归一。改名保留旧名作为别名，ID 不变。 */
export function updateConcept(store, id, patch = {}) {
  const concept = getConcept(store, id)
  if (!concept) return { ok: false, code: 'not_found', error: '概念不存在' }
  const nextName = patch.name === undefined ? concept.name : String(patch.name || '').trim()
  if (!nextName) return { ok: false, code: 'invalid_name', error: '概念名不能为空' }
  if (normalizeTerm(nextName) !== normalizeTerm(concept.name)) {
    const clash = findConcept(store, concept.kind, nextName)
    if (clash && clash.id !== concept.id) {
      return { ok: false, code: 'duplicate', error: `已存在同名概念「${clash.name}」，请用合并` }
    }
    const oldName = concept.name
    concept.aliases = [...new Set([...(concept.aliases || []), oldName])]
    concept.name = nextName
  }
  if (Array.isArray(patch.aliases)) {
    concept.aliases = uniqueAliases(concept.name, patch.aliases)
  }
  if (patch.status === 'active' || patch.status === 'pending') {
    concept.status = patch.status
  }
  if (typeof patch.definition === 'string') concept.definition = patch.definition.slice(0, 300)
  concept.updatedAt = new Date().toISOString()
  return { ok: true, concept }
}

/* ---------------- 单篇抽取缓存 ---------------- */

function analysisPath(paperId) {
  return join(ANALYSIS_DIR, `${paperId}.json`)
}

export function readAnalysis(paperId) {
  const file = analysisPath(paperId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function writeAnalysis(paperId, data) {
  ensureDir()
  const tmp = analysisPath(paperId) + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, analysisPath(paperId))
}

export function listAnalyses() {
  ensureDir()
  return readdirSync(ANALYSIS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readAnalysis(name.slice(0, -5)))
    .filter(Boolean)
}

export function deleteAnalysis(paperId) {
  const file = analysisPath(paperId)
  if (existsSync(file)) {
    writeFileSync(file + '.deleted', '')
    // 直接覆盖为空，避免误删其他文件；listAnalyses 会读失败并跳过
    writeFileSync(file, '')
  }
}

/** 合并概念后，把单篇缓存里的边与候选指向新 ID（保留原始名）。 */
function repointAnalyses(fromId, toId) {
  for (const analysis of listAnalyses()) {
    let changed = false
    for (const edge of analysis.edges || []) {
      if (edge.source === fromId) { edge.source = toId; changed = true }
      if (edge.target === fromId) { edge.target = toId; changed = true }
    }
    for (const candidate of analysis.candidates || []) {
      if (candidate.conceptId === fromId) { candidate.conceptId = toId; changed = true }
    }
    if (changed) writeAnalysis(analysis.paperId, analysis)
  }
}

/* ---------------- 边表 ---------------- */

export function readEdges() {
  ensureDir()
  if (!existsSync(EDGES_PATH)) return []
  const rows = []
  for (const line of readFileSync(EDGES_PATH, 'utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const edge = JSON.parse(text)
      if (edge && edge.id && edge.source && edge.target && edge.type) rows.push(edge)
    } catch { /* 跳过坏行 */ }
  }
  return rows
}

export function writeEdges(edges) {
  ensureDir()
  const tmp = EDGES_PATH + '.tmp'
  const body = (edges || []).map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(tmp, body + (edges?.length ? '\n' : ''), 'utf8')
  renameSync(tmp, EDGES_PATH)
  return edges || []
}

/**
 * 从单篇缓存重建全库边表：只保留两端都是 active 概念的边。
 * 这是唯一的写 edges.jsonl 入口，保证合并/批准后自动生效。
 */
export function rebuildEdges() {
  const store = readConcepts()
  const active = new Map(store.concepts.filter((c) => c.status === 'active').map((c) => [c.id, c]))
  const seen = new Set()
  const edges = []
  for (const analysis of listAnalyses()) {
    for (const edge of analysis.edges || []) {
      if (!edge?.id || !edge.source || !edge.target) continue
      if (!active.has(edge.target)) continue
      if (String(edge.source).startsWith('c-') && !active.has(edge.source)) continue
      if (seen.has(edge.id)) continue
      seen.add(edge.id)
      edges.push(edge)
    }
  }
  edges.sort((a, b) => String(a.source).localeCompare(String(b.source)) || String(a.type).localeCompare(String(b.type)))
  writeEdges(edges)
  return edges
}

/** 每个概念被多少条边使用（用于待归一队列与图节点）。 */
export function conceptUsage(edges = readEdges()) {
  const usage = new Map()
  const bump = (id) => usage.set(id, (usage.get(id) || 0) + 1)
  for (const edge of edges) {
    bump(edge.source)
    bump(edge.target)
  }
  return usage
}
