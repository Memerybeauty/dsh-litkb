/**
 * 写作文稿（P4.7）：`drafts/<id>.md`，frontmatter + Markdown。
 * 引用固定写成 [[paper#^q-id|作者 年, p.N]]。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATHS, readIndex } from './library.js'
import { readCard } from './cards.js'
import { gbtEntry } from './export.js'
import { callModel, resolveRoute } from './cardgen.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CITATION = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|([^\]]+))?\]\]/g
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function ensureDir() {
  if (!existsSync(PATHS.drafts)) mkdirSync(PATHS.drafts, { recursive: true })
}

function draftPath(id) {
  return join(PATHS.drafts, `${id}.md`)
}

function safeId(id) {
  return /^d-[a-zA-Z0-9_-]{4,40}$/.test(String(id || ''))
}

function parseFront(text) {
  const match = String(text || '').match(FRONT)
  const meta = {}
  let body = String(text || '')
  if (match) {
    body = body.slice(match[0].length)
    for (const line of match[1].split('\n')) {
      const at = line.indexOf(':')
      if (at < 0) continue
      const key = line.slice(0, at).trim()
      let value = line.slice(at + 1).trim()
      if (value === 'null') value = null
      meta[key] = value
    }
  }
  return { meta, body }
}

function serialize(draft) {
  const fields = ['id', 'title', 'type', 'status', 'created', 'updated']
  const lines = ['---']
  for (const key of fields) {
    if (draft[key] === undefined || draft[key] === null || draft[key] === '') continue
    lines.push(`${key}: ${String(draft[key]).replace(/\n/g, ' ')}`)
  }
  lines.push('---', '', draft.body || '')
  return lines.join('\n')
}

export function parseCitations(body) {
  const text = String(body || '')
  const seen = new Set()
  const papers = []
  const citations = []
  const missing = []
  const records = new Map(readIndex().map((r) => [r.id, r]))
  let match = CITATION.exec(text)
  while (match) {
    const [, paperId, evidenceId, label] = match
    const record = records.get(paperId)
    const card = record ? readCard(paperId) : null
    const ev = (card?.evidence || []).find((item) => item.id === evidenceId)
    if (!record || !card || !ev) {
      missing.push({ paperId, evidenceId, raw: match[0] })
    } else {
      citations.push({
        paperId, evidenceId, page: ev.page, quote: ev.quote,
        title: record.title || paperId, label: label || '',
      })
      if (!seen.has(paperId)) {
        seen.add(paperId)
        papers.push({
          paperId, title: record.title || paperId, authors: record.authors || '',
          year: record.year || '', venue: record.venue || '', type: record.type || '',
        })
      }
    }
    match = CITATION.exec(text)
  }
  return {
    citations,
    papers,
    missing,
    references: papers.map((record, index) => ({
      index: index + 1,
      text: gbtEntry(record),
      paperId: record.paperId,
    })),
  }
}

export function listDrafts() {
  ensureDir()
  const rows = []
  for (const name of readdirSync(PATHS.drafts)) {
    if (!name.endsWith('.md')) continue
    const id = name.slice(0, -3)
    try {
      const text = readFileSync(draftPath(id), 'utf8')
      const { meta, body } = parseFront(text)
      const citations = parseCitations(body)
      rows.push({
        id,
        title: meta.title || '未命名文稿',
        type: meta.type || '综述',
        status: meta.status || '草稿',
        created: meta.created || '',
        updated: meta.updated || '',
        chars: body.length,
        citations: citations.citations.length,
        missing: citations.missing.length,
      })
    } catch { /* 跳过坏文件 */ }
  }
  return rows.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
}

export function readDraft(id) {
  if (!safeId(id) || !existsSync(draftPath(id))) return null
  const text = readFileSync(draftPath(id), 'utf8')
  const { meta, body } = parseFront(text)
  return {
    id,
    title: meta.title || '未命名文稿',
    type: meta.type || '综述',
    status: meta.status || '草稿',
    created: meta.created || '',
    updated: meta.updated || '',
    body,
  }
}

export function createDraft({ title = '未命名文稿', type = '综述', body = '' } = {}) {
  ensureDir()
  const at = new Date().toISOString()
  const id = `d-${createHash('sha1').update(`${title}|${at}|${Math.random()}`).digest('hex').slice(0, 8)}`
  const draft = { id, title: String(title).slice(0, 120) || '未命名文稿', type: String(type).slice(0, 20) || '综述', status: '草稿', created: at, updated: at, body: String(body) }
  writeDraft(draft)
  return draft
}

export function writeDraft(draft) {
  ensureDir()
  const file = draftPath(draft.id)
  if (existsSync(file)) {
    try {
      const versions = join(PATHS.drafts, '.versions')
      if (!existsSync(versions)) mkdirSync(versions, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      writeFileSync(join(versions, `${draft.id}.${stamp}.md`), readFileSync(file, 'utf8'), 'utf8')
      const list = readdirSync(versions).filter((name) => name.startsWith(`${draft.id}.`)).sort()
      for (const old of list.slice(0, Math.max(0, list.length - 20))) {
        try { unlinkSync(join(versions, old)) } catch { /* 忽略 */ }
      }
    } catch { /* 快照失败不阻塞保存 */ }
  }
  const tmp = file + '.tmp'
  writeFileSync(tmp, serialize(draft), 'utf8')
  renameSync(tmp, file)
  return draft
}

export function deleteDraft(id) {
  if (!safeId(id) || !existsSync(draftPath(id))) return false
  unlinkSync(draftPath(id))
  const versions = join(PATHS.drafts, '.versions')
  if (existsSync(versions)) {
    for (const name of readdirSync(versions)) {
      if (name.startsWith(`${id}.`)) {
        try { unlinkSync(join(versions, name)) } catch { /* 忽略 */ }
      }
    }
  }
  return true
}

export function saveDraft(id, patch = {}) {
  const current = readDraft(id)
  if (!current) return null
  const draft = {
    ...current,
    ...(patch.title !== undefined ? { title: String(patch.title).slice(0, 120) || '未命名文稿' } : {}),
    ...(patch.type !== undefined ? { type: String(patch.type).slice(0, 20) || '综述' } : {}),
    ...(patch.status !== undefined ? { status: String(patch.status).slice(0, 20) || '草稿' } : {}),
    ...(patch.body !== undefined ? { body: String(patch.body) } : {}),
    updated: new Date().toISOString(),
  }
  return writeDraft(draft)
}

export function exportDraft(id) {
  const draft = readDraft(id)
  if (!draft) return null
  const parsed = parseCitations(draft.body)
  const lines = [draft.body.trim(), '', '## 参考文献', '']
  if (parsed.references.length) {
    for (const ref of parsed.references) lines.push(`[${ref.index}] ${ref.text}`)
  } else {
    lines.push('（暂无引用）')
  }
  if (parsed.missing.length) {
    lines.push('', '> 缺失证据：', ...parsed.missing.map((item) => `- ${item.raw}`))
  }
  return `${lines.join('\n').trim()}\n`
}

/** 全库证据搜索：标题/作者/引文命中。 */
export function searchEvidence(query = '', limit = 60) {
  const needle = String(query || '').trim().toLowerCase()
  const out = []
  for (const record of readIndex()) {
    const card = readCard(record.id)
    if (!card) continue
    const titleHit = !needle || `${record.title || ''} ${record.authors || ''}`.toLowerCase().includes(needle)
    for (const ev of card.evidence || []) {
      if (needle && !titleHit && !String(ev.quote || '').toLowerCase().includes(needle)) continue
      out.push({
        paperId: record.id,
        title: record.title || record.id,
        authors: record.authors || '',
        year: record.year || '',
        evidenceId: ev.id,
        page: ev.page,
        block: ev.block || '',
        quote: ev.quote || '',
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

export function draftCitations(id) {
  const draft = readDraft(id)
  if (!draft) return null
  return parseCitations(draft.body)
}

export function findEvidence(paperId, evidenceId) {
  const record = readIndex().find((r) => r.id === paperId)
  const card = record ? readCard(paperId) : null
  const ev = (card?.evidence || []).find((item) => item.id === evidenceId)
  return record && ev ? { record, evidence: ev, card } : null
}


const ASSIST_PROMPT = 'write-evidence.v1'

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function assistCitationCheck(text, allowed) {
  const warnings = []
  const invalid = []
  const regex = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|[^\]]*)?\]\]/g
  let match = regex.exec(text)
  const cited = new Set()
  while (match) {
    const key = `${match[1]}#${match[2]}`
    cited.add(key)
    if (!allowed.has(key) && !invalid.includes(key)) invalid.push(key)
    match = regex.exec(text)
  }
  if (!cited.size) warnings.push('生成段落没有引用任何证据')
  if (invalid.length) warnings.push(`引用了未选中的证据：${invalid.join('、')}`)
  return { warnings, invalid, cited: [...cited] }
}

export async function assistDraft({ ctx, draftId, evidenceIds = [], instruction = '' }) {
  const draft = readDraft(draftId)
  if (!draft) throw fail('not_found', '文稿不存在')
  const ids = [...new Set((evidenceIds || []).map((item) => String(item)))].slice(0, 6)
  const found = []
  for (const id of ids) {
    const hit = readIndex()
      .map((record) => ({ record, card: readCard(record.id) }))
      .find(({ card }) => (card?.evidence || []).some((ev) => ev.id === id))
    if (!hit) continue
    const ev = (hit.card.evidence || []).find((item) => item.id === id)
    if (ev) found.push({ record: hit.record, evidence: ev })
  }
  if (!found.length) throw fail('no_evidence', '请选择至少一条证据')
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const allowed = new Set(found.map(({ record, evidence }) => `${record.id}#${evidence.id}`))
  const evidenceText = found.map(({ record, evidence }) => [
    `- 论文：${record.title || record.id}（${record.id}，${record.year || '年份未知'}）`,
    `  证据：${evidence.id}，p.${evidence.page}`,
    `  原文：${String(evidence.quote || '').replace(/\s+/g, ' ').slice(0, 500)}`,
  ].join('\n')).join('\n\n')
  const user = [
    `【写作意图】${String(instruction || '写一段与研究现状相关的正文').slice(0, 300)}`,
    '',
    '【当前文稿（仅用于衔接，不要照抄）】',
    String(draft.body || '').slice(-2500) || '（空文稿）',
    '',
    '【可用证据】',
    evidenceText,
    '',
    '输出要求：2–4 句中文正文；每条事实后带 [[论文ID#^证据ID|p.页码]]；只能使用上面的证据。',
  ].join('\n')
  const system = readFileSync(join(HERE, '..', 'prompts', `${ASSIST_PROMPT}.md`), 'utf8')
  const result = await callModel(ctx, route, system, user, null, {
    maxTokens: 1200,
    reasoningEffort: 'off',
  })
  const checked = assistCitationCheck(result.text, allowed)
  return {
    text: result.text.trim(),
    warnings: checked.warnings,
    cited: checked.cited,
    model: `${route.provider}/${route.model}`,
    usage: result.usage || null,
  }
}
