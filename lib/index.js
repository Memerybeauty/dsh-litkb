/* 由 scripts/build-server.mjs 从 src/server/*.js 生成；不要直接编辑本文件。 */
/**
 * dsh-litkb · 服务端插件（v0.3.0 / P2.1）
 * 大类（知网 12 类）+ 扁平标签 + 七段卡（章节切分 / 证据块 / 卡片页）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PATHS, TYPES, ensureLibrary, findByDoi, findByHash, readIndex, readTags, sha256, stats, upsert,
  writeIndex, writeTags,
} from './library.js'
import { addAnnotation, addQuoteEvidence, cardSummary, listVersions, readCard, readVersion, recomputeCardStatus, renderCardMarkdown, writeCard } from './cards.js'
import { blocksSummary, ensureBlocks, readBlocks, renderParsedMarkdown, repairEvidenceBlocks } from './blocks.js'
import { documentParagraphs, paragraphPages } from './paragraphs.js'
import { renderPagePng } from './render.js'
import { publicSettings, writeSettings } from './settings.js'
import { glossaryHash, readGlossary, writeGlossary } from './glossary.js'
import { readTranslation, translateDocument, translationSummary } from './translate.js'
import { evidenceCsv, evidenceRows, findBacklinks } from './evidence-scan.js'
import { applySection, callModel, generateCard, generateCardSection, llmStatus, parseModelJson, SECTION_DEFS } from './cardgen.js'
import { mergeConcepts, readConcepts, readEdges, rebuildEdges, updateConcept, writeConcepts } from './concepts.js'
import { buildAll, compareGroups, conceptOverview, readGraph } from './graph.js'
import { askPaper } from './ask.js'
import { exportBibtex, exportBilingual, exportCanvas, exportCardMarkdown, exportGbt, exportMermaid } from './export.js'
import { assistDraft, createDraft, deleteDraft, draftCitations, exportDraft, listDrafts, readDraft, saveDraft, searchEvidence } from './drafts.js'
import { draftToDocx } from './docx-export.js'
import { buildVaultZip } from './vault-export.js'
import { loadPaperPages } from './pdftext.js'
import { buildDeepRead, readDeepRead, writeDeepRead } from './deepread.js'
import { appendChainToDraft, autoChainDrafts, chainGraph, chainParagraph, claimCandidates, deleteChain, listChains, proposeChain, readChain, saveChain, suggestClaim, writeChainLayout } from './chains.js'
import { searchLibrary } from './search.js'
import { answerQuestion } from './answer.js'
import { AGENT_TOOL_NAMES, registerAgentTools } from './agent-tools.js'
import { autoCrossPaperDrafts } from './chain-cross.js'
import { listSearchHistory, recordSearch } from './search-history.js'
import { resolveLink } from './link-import.js'
import {
  aggregateThemePapers, bindThemeDraft, buildThemeOutline, buildThemeSummary, deleteTheme, listThemes, markThemeRun,
  matchTheme, readTheme, recordThemeMatch, saveTheme, setThemePaper, themeChainDrafts, themeChains,
  themePapers, themeStats, summaryState, updateThemeSummary,
} from './themes.js'
import {
  analysisPapers, analysisStats, createViewpointChain, extractPaperAnalysis,
  readAnalysis, saveAnalysis, synthesizeFacet,
} from './theme-analysis.js'
import { extractPdf } from './pdf.js'
import { classify, matchTags } from './classify.js'
import {
  backupDirInfo, buildBackupZip, libraryInfo, MAX_RESTORE_BYTES, quickLibraryCounts,
  recoverInterruptedRestore, restoreBackup,
} from './backup.js'
import { deletePaper, paperDeleteImpact } from './paper-delete.js'
import { applyAutoStatus, migrateAutoStatuses } from './paper-status.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
export const STARTED_AT = new Date().toISOString()

export const name = 'dsh-litkb'
export const inject = ['webServer']


function json(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function tagCounts(rows) {
  const counts = {}
  for (const row of rows) for (const t of row.topics || []) counts[t] = (counts[t] || 0) + 1
  return counts
}

function listTags() {
  const defs = readTags()
  const counts = tagCounts(readIndex())
  return defs.tags.map((t) => ({ name: t.name, keywords: t.keywords || [], count: counts[t.name] || 0 }))
}

async function importPdfBuffer(buffer, filename = 'untitled.pdf', source = 'upload', metaOverride = {}) {
  if (buffer.length < 1000 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw Object.assign(new Error('不是 PDF 文件'), { code: 'not_pdf' })
  }
  const hash = sha256(buffer)
  const existing = findByHash(hash)
  if (existing) return { duplicate: true, paper: existing }
  let extracted
  try {
    extracted = await extractPdf(buffer)
  } catch (err) {
    const msg = `${err?.name || ''} ${err?.message || ''}`
    if (/password|encrypt/i.test(msg)) {
      throw Object.assign(new Error('PDF 已加密，请先解除密码'), { code: 'encrypted' })
    }
    throw Object.assign(new Error('无法解析该 PDF（可能已损坏或是扫描件）'), { code: 'parse_failed' })
  }
  if (extracted.chars < 50) {
    throw Object.assign(new Error('几乎抽不到文字（可能是扫描件），请先 OCR'), { code: 'parse_failed' })
  }
  const base = classify({ text: extracted.text, filename, info: extracted.info }, readTags().tags)
  const meta = {
    title: String(metaOverride.title || '').trim() || base.title,
    authors: String(metaOverride.authors || '').trim() || base.authors,
    year: String(metaOverride.year || '').trim() || base.year,
    venue: String(metaOverride.venue || '').trim() || base.venue,
    doi: String(metaOverride.doi || '').trim() || base.doi,
  }
  const doi = String(meta.doi || '').trim()
  if (doi) {
    const sameDoi = findByDoi(doi)
    if (sameDoi) return { duplicate: true, paper: sameDoi, duplicateCode: 'doi' }
  }
  const id = `p-${hash.slice(0, 8)}`
  const pdfFile = `${id}.pdf`
  writeFileSync(join(PATHS.papers, pdfFile), buffer)
  writeFileSync(join(PATHS.text, `${id}.txt`), extracted.text, 'utf8')
  const record = {
    id,
    citekey: id,
    sha256: hash,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    doi: meta.doi,
    type: base.type,
    topics: base.topics,
    status: '待读',
    file: pdfFile,
    pages: extracted.numPages,
    chars: extracted.chars,
    quality: extracted.quality,
    source,
    originalName: filename,
    importedAt: new Date().toISOString(),
    importedFrom: String(metaOverride.url || ''),
  }
  writeFileSync(join(PATHS.cards, `${id}.md`), renderCardMarkdown(record, readCard(id), extracted.text.slice(0, 600)), 'utf8')
  upsert(record)
  return { duplicate: false, paper: record, quality: extracted.quality }
}

async function importPdf(req, res) {
  try {
    const buffer = await readBody(req)
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'untitled.pdf'))
    const result = await importPdfBuffer(buffer, filename, 'upload')
    if (result.duplicate) {
      json(res, 200, { ok: true, duplicate: true, code: result.duplicateCode || 'duplicate_sha', paper: result.paper })
      return
    }
    json(res, 200, {
      ok: true,
      paper: result.paper,
      ingest: publicIngestJob(maybeStartIngest(result.paper)),
      warning: result.quality < 0.4 ? 'low_quality' : undefined,
      warningText: result.quality < 0.4 ? '解析质量偏低，建议人工核对' : undefined,
    })
  } catch (error) {
    if (error?.code === 'TOO_LARGE') {
      json(res, 413, { ok: false, code: 'too_large', error: '文件超过 80MB' })
      return
    }
    const code = error?.code || 'server_error'
    const status = code === 'not_pdf' ? 400 : (code === 'encrypted' || code === 'parse_failed' ? 422 : 500)
    json(res, status, { ok: false, code, error: String(error?.message || '服务端处理失败，请重试') })
  }
}

async function updatePaper(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'))
    const rows = readIndex()
    const record = rows.find((r) => r.id === body.id)
    if (!record) {
      json(res, 404, { ok: false, error: 'paper not found' })
      return
    }
    const patch = body.patch || {}
    const next = { ...record }
    for (const key of ['title', 'year', 'venue', 'doi', 'status', 'authors']) {
      if (key in patch) next[key] = patch[key]
    }
    if ('status' in patch) {
      if (!STATUSES.includes(patch.status)) {
        json(res, 422, { ok: false, error: '未知状态' })
        return
      }
      next.statusReason = String(patch.reason || '').trim()
      next.statusSource = 'manual'
    }
    if (typeof patch.type === 'string') {
      if (!TYPES.includes(patch.type)) {
        json(res, 422, { ok: false, error: 'invalid type' })
        return
      }
      next.type = patch.type
    }
    if (Array.isArray(patch.topics)) next.topics = patch.topics.filter((t) => typeof t === 'string')
    if (patch.edited) next.edited = true

    const text = readFileSync(join(PATHS.text, `${record.id}.txt`), 'utf8')
    const card = readCard(record.id)
    if (card && 'status' in patch && patch.status !== record.status) {
      card.statusHistory = Array.isArray(card.statusHistory) ? card.statusHistory : []
      card.statusHistory.push({
        from: record.status || '待读',
        to: patch.status,
        at: new Date().toISOString(),
        reason: String(patch.reason || '').trim(),
      })
    }
    writeFileSync(join(PATHS.cards, `${record.id}.md`), renderCardMarkdown(next, card, text.slice(0, 600)), 'utf8')
    upsert(next)
    json(res, 200, { ok: true, paper: next })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function createTag(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
    const name = String(body.name || '').trim()
    if (!name) {
      json(res, 422, { ok: false, error: '标签名不能为空' })
      return
    }
    if (name.length > 24) {
      json(res, 422, { ok: false, error: '标签名过长（≤24 字）' })
      return
    }
    const defs = readTags()
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
      : []
    const existing = defs.tags.find((t) => t.name === name)
    if (existing) {
      existing.keywords = keywords
    } else {
      defs.tags.push({ name, keywords })
    }
    writeTags(defs)
    json(res, 200, { ok: true, tags: listTags() })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function deleteTag(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    const name = String(body.name || '').trim()
    if (!name) {
      json(res, 422, { ok: false, error: '缺少标签名' })
      return
    }
    const rows = readIndex()
    const affected = rows.filter((r) => (r.topics || []).includes(name)).length
    if (!body.confirmed) {
      json(res, 409, { ok: false, error: '需要确认', affected })
      return
    }
    const defs = readTags()
    defs.tags = defs.tags.filter((t) => t.name !== name)
    writeTags(defs)
    for (const row of rows) {
      if ((row.topics || []).includes(name)) {
        row.topics = row.topics.filter((t) => t !== name)
        const text = readFileSync(join(PATHS.text, `${row.id}.txt`), 'utf8')
        writeFileSync(join(PATHS.cards, `${row.id}.md`), renderCardMarkdown(row, readCard(row.id), text.slice(0, 600)), 'utf8')
      }
    }
    writeIndex(rows)
    json(res, 200, { ok: true, affected, tags: listTags() })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function reclassify(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    const rows = readIndex()
    const tags = readTags().tags
    const targets = body.id ? rows.filter((r) => r.id === body.id) : rows
    const replace = body.replace === true
    for (const row of targets) {
      const text = readFileSync(join(PATHS.text, `${row.id}.txt`), 'utf8')
      const matched = matchTags({ title: row.title, text }, tags)
      row.topics = replace ? matched : [...new Set([...(row.topics || []), ...matched])]
      writeFileSync(join(PATHS.cards, `${row.id}.md`), renderCardMarkdown(row, readCard(row.id), text.slice(0, 600)), 'utf8')
    }
    writeIndex(rows)
    json(res, 200, { ok: true, updated: targets.length })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}


/* ---------------- 七段卡任务（串行队列，一次只跑一篇） ---------------- */
let pluginCtx = null
const jobs = new Map()
let jobChain = Promise.resolve()
const deepJobs = new Map()
const autoChainJobs = new Map()
let autoChainQueue = Promise.resolve()

function publicAutoChainJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    step: job.step,
    mode: job.mode || 'paper',
    total: job.total,
    done: job.done,
    created: job.created,
    skipped: job.skipped,
    failed: job.failed,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    items: job.items.slice(-80),
    errors: job.errors.slice(-20),
  }
}

function startAutoChainJob({ paperIds = [], sections = [], autoConfirm = false, mode = 'paper', topic = '', maxPairs = 16 } = {}) {
  const ids = [...new Set(paperIds.map((id) => String(id || '')).filter((id) => /^p-[a-zA-Z0-9_-]+$/.test(id)))]
  if (!ids.length) return null
  const job = {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'queued', step: '排队中', mode,
    total: ids.length, done: 0, created: 0, skipped: 0, failed: 0,
    items: [], errors: [],
    startedAt: new Date().toISOString(), finishedAt: null,
    paperIds: ids, topic, maxPairs,
  }
  autoChainJobs.set(job.id, job)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, item] of autoChainJobs) {
    if (item.status !== 'running' && item.status !== 'queued' && Date.parse(item.finishedAt || item.startedAt) < cutoff) autoChainJobs.delete(id)
  }
  autoChainQueue = autoChainQueue.then(() => runAutoChainJob(job, { sections, autoConfirm, topic, maxPairs })).catch(() => {})
  return job
}

function persistAutoDrafts(job, drafts, autoConfirm, paperId = '') {
  for (const draft of drafts) {
    try {
      const confirmed = autoConfirm && Number(draft.confidence) >= 0.8
      const chain = saveChain({
        ...draft,
        status: confirmed ? 'confirmed' : 'draft',
        review: confirmed ? { action: 'auto-confirmed', at: new Date().toISOString() } : null,
      })
      job.created += 1
      job.items.push({
        chainId: chain.id, paperId: paperId || chain.claim?.paperId || '',
        title: chain.title, confidence: chain.confidence, status: chain.status,
      })
    } catch (error) {
      job.failed += 1
      job.errors.push({
        paperId: paperId || draft.claim?.paperId || '',
        message: String(error?.message || error), code: error?.code || 'error',
      })
    }
  }
}

async function runAutoChainJob(job, options) {
  job.status = 'running'
  if (job.mode === 'cross') {
    job.total = 1
    job.done = 0
    job.step = '跨论文分组与关系判断'
    try {
      const result = autoCrossPaperDrafts({
        paperIds: job.paperIds,
        topic: options.topic,
        maxPairs: options.maxPairs || 16,
      })
      job.skipped += result.skipped.length
      persistAutoDrafts(job, result.drafts, options.autoConfirm)
      job.step = `跨论文完成：${result.drafts.length} 条草稿`
    } catch (error) {
      job.failed += 1
      job.errors.push({ paperId: '', message: String(error?.message || error), code: error?.code || 'error' })
    }
    job.done = 1
    job.status = 'done'
    job.step = '完成'
    job.finishedAt = new Date().toISOString()
    return
  }
  const records = new Map(readIndex().map((record) => [record.id, record]))
  for (const paperId of job.paperIds) {
    if (job.status === 'cancelled') break
    const record = records.get(paperId)
    job.step = `自动建链：${record?.title || paperId}`
    try {
      const result = autoChainDrafts(paperId, { sections: options.sections, maxClaims: 8 })
      job.skipped += result.skipped.length
      persistAutoDrafts(job, result.drafts, options.autoConfirm, paperId)
    } catch (error) {
      job.failed += 1
      job.errors.push({ paperId, message: String(error?.message || error), code: error?.code || 'error' })
    }
    job.done += 1
  }
  job.status = 'done'
  job.step = '完成'
  job.finishedAt = new Date().toISOString()
}

let deepChain = Promise.resolve()

function publicDeepJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    step: job.step,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    sections: job.sections ?? null,
  }
}

function startDeepJob(record) {
  const existing = deepJobs.get(record.id)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: record.id,
    status: 'queued',
    step: '排队中',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    sections: null,
  }
  deepJobs.set(record.id, job)
  deepChain = deepChain.then(() => runDeepJob(record.id, job)).catch(() => {})
  return job
}

async function runDeepJob(id, job) {
  job.status = 'running'
  job.step = '读取原文与卡片'
  try {
    const record = readIndex().find((r) => r.id === id)
    if (!record) throw Object.assign(new Error('论文不存在'), { code: 'not_found' })
    job.step = '精读：提取问题 / 方法 / 结果 / claims'
    const deepread = await buildDeepRead({ ctx: pluginCtx, record })
    try { applyAutoStatus(id, '精读') } catch { /* 状态回写失败不影响精读 */ }
    job.sections = deepread?.sections?.length || 0
    job.status = 'done'
    job.step = '完成'
  } catch (error) {
    job.status = 'failed'
    job.step = '失败'
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
  } finally {
    job.finishedAt = new Date().toISOString()
  }
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    key: job.key || null,
    status: job.status,
    step: job.step,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    card: job.card,
  }
}

function pruneJobs() {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of jobs) {
    const at = Date.parse(job.finishedAt || job.startedAt)
    if (job.status !== 'running' && job.status !== 'queued' && at < cutoff) jobs.delete(id)
  }
}

function startCardJob(record, options = {}) {
  pruneJobs()
  const existing = jobs.get(record.id)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: record.id,
    key: options.key || null,
    status: 'queued',
    step: '排队中',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    card: null,
  }
  jobs.set(record.id, job)
  jobChain = jobChain.then(() => runCardJob(record.id, job)).catch(() => {})
  return job
}

async function runCardJob(id, job) {
  job.status = 'running'
  job.step = '读取分页原文'
  try {
    const record = readIndex().find((r) => r.id === id)
    if (!record) throw Object.assign(new Error('论文不存在'), { code: 'not_found' })
    const doc = await loadPaperPages(record)
    const blockDoc = readBlocks(record.id)
    const pages = blockDoc ? paragraphPages(blockDoc) : doc.pages
    job.step = `切分章节（${pages.length} 页）并调用模型`
    let card
    if (job.key) {
      const existing = readCard(id)
      if (!existing) throw Object.assign(new Error('还没有七段卡，无法单段重生成'), { code: 'no_card' })
      const def = SECTION_DEFS.find((d) => d.key === job.key)
      if (!def) throw Object.assign(new Error('未知段落'), { code: 'invalid_key' })
      job.step = `重生成「${def.title}」`
      const patch = await generateCardSection({ ctx: pluginCtx, record, pages, key: job.key })
      card = applySection(existing, patch, def.title)
    } else {
      card = await generateCard({ ctx: pluginCtx, record, pages })
    }
    job.step = '写入卡片与证据'
    writeCard(card, record)
    try { applyAutoStatus(id, '略读') } catch { /* 状态回写失败不影响卡片 */ }
    job.card = cardSummary(card)
    job.status = 'done'
    job.step = '完成'
  } catch (error) {
    job.status = 'failed'
    job.step = '失败'
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
  } finally {
    job.finishedAt = new Date().toISOString()
  }
}

/* ---------------- 解析稿任务（PaddleOCR 可能跑几分钟，必须异步） ---------------- */
const blockJobs = new Map()
let blockChain = Promise.resolve()

function publicBlockJob(job) {
  if (!job) return null
  return {
    id: job.id, status: job.status, step: job.step, parser: job.parser || null,
    startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error,
  }
}

function startBlocksJob(record, options) {
  const existing = blockJobs.get(record.id)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: record.id, status: 'queued', step: '排队中', parser: null,
    startedAt: new Date().toISOString(), finishedAt: null, error: null,
  }
  blockJobs.set(record.id, job)
  blockChain = blockChain.then(() => runBlocksJob(record.id, job, options)).catch(() => {})
  return job
}

async function runBlocksJob(id, job, options) {
  job.status = 'running'
  job.step = '准备解析'
  try {
    const record = readIndex().find((r) => r.id === id)
    if (!record) throw Object.assign(new Error('论文不存在'), { code: 'not_found' })
    const doc = await ensureBlocks(record, {
      force: options?.force === true,
      backend: options?.backend,
      onProgress: (progress) => {
        if (progress?.step) job.step = progress.step
        else if (progress?.totalPages) job.step = `PaddleOCR 解析 ${progress.extractedPages}/${progress.totalPages} 页`
        else if (progress?.state) job.step = `PaddleOCR ${progress.state}`
      },
    })
    job.parser = doc.parser
    job.status = 'done'
    job.step = doc.fallback ? '完成（PaddleOCR 不可用，已用 pdf.js 兜底）' : '完成'
  } catch (error) {
    job.status = 'failed'
    job.step = '失败'
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
  } finally {
    job.finishedAt = new Date().toISOString()
  }
}

/* ---------------- 入库自动管线：原文解析 → 七段卡 → 精读 ---------------- */
const ingestJobs = new Map()
let ingestChain = Promise.resolve()
const INGEST_TIMEOUT = {
  blocks: 30 * 60 * 1000,
  card: 15 * 60 * 1000,
  deepread: 15 * 60 * 1000,
}

function publicIngestJob(job) {
  if (!job) return null
  return {
    id: job.id,
    paperId: job.paperId,
    title: job.title,
    status: job.status,
    step: job.step,
    steps: job.steps,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  }
}

function listIngestJobs(limit = 20) {
  return [...ingestJobs.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, limit)
    .map(publicIngestJob)
}

function maybeStartIngest(record) {
  if (!record?.id) return null
  try {
    if (publicSettings().autoIngest === false) return null
  } catch { /* 设置读取失败时按开启处理 */ }
  return startIngestJob(record)
}

function startIngestJob(record) {
  if (!record?.id) return null
  const existing = ingestJobs.get(record.id)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: record.id,
    paperId: record.id,
    title: record.title || record.id,
    status: 'queued',
    step: '排队中',
    steps: {
      blocks: { status: 'queued', message: '' },
      card: { status: 'queued', message: '' },
      deepread: { status: 'queued', message: '' },
    },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  }
  ingestJobs.set(record.id, job)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, item] of ingestJobs) {
    if (!['queued', 'running'].includes(item.status) && Date.parse(item.finishedAt || item.startedAt) < cutoff) {
      ingestJobs.delete(id)
    }
  }
  ingestChain = ingestChain.then(() => runIngestJob(record.id, job)).catch(() => {})
  return job
}

async function waitIngestJob(map, id, timeout) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const job = map.get(id)
    if (job && (job.status === 'done' || job.status === 'failed')) return job
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return map.get(id) || null
}

function finishIngestJob(job) {
  const steps = Object.values(job.steps)
  const done = steps.filter((step) => step.status === 'done').length
  const failed = steps.filter((step) => step.status === 'failed').length
  job.status = done >= 3 ? 'done' : done > 0 ? 'partial' : 'failed'
  job.step = done >= 3
    ? '完成：原文解析 · 七段卡 · 精读'
    : done > 0 ? `部分完成（${done}/3${failed ? `，${failed} 项失败` : ''}）` : '未完成'
  job.finishedAt = new Date().toISOString()
  if (!job.error && done < 3) {
    const reason = steps.find((step) => step.status === 'failed' || step.status === 'skipped')
    job.error = { code: done > 0 ? 'partial' : 'failed', message: reason?.message || '部分步骤未完成' }
  }
  try {
    if (job.steps.deepread.status === 'done') applyAutoStatus(job.paperId, '精读')
    else if (job.steps.card.status === 'done') applyAutoStatus(job.paperId, '略读')
  } catch { /* 状态回写失败不影响任务结果 */ }
}

async function runIngestJob(id, job) {
  job.status = 'running'
  try {
    const record = readIndex().find((item) => item.id === id)
    if (!record) throw Object.assign(new Error('论文不存在'), { code: 'not_found' })

    if (readBlocks(id)) {
      job.steps.blocks = { status: 'done', message: '已有解析稿' }
    } else {
      job.steps.blocks = { status: 'running', message: '准备解析' }
      job.step = '原文解析'
      try {
        startBlocksJob(record, {})
        const done = await waitIngestJob(blockJobs, id, INGEST_TIMEOUT.blocks)
        if (!done || done.status !== 'done') {
          job.steps.blocks = {
            status: 'failed',
            message: done?.error?.message || (done ? '原文解析未完成' : '原文解析超时'),
          }
        } else {
          job.steps.blocks = { status: 'done', message: done.parser ? `解析器 ${done.parser}` : '完成' }
        }
      } catch (error) {
        job.steps.blocks = { status: 'failed', message: String(error?.message || error) }
      }
    }

    const model = llmStatus(pluginCtx)
    if (!model.available || !model.route) {
      const message = model.available ? '未选择默认模型' : '宿主未提供模型服务'
      job.steps.card = { status: 'skipped', message }
      job.steps.deepread = { status: 'skipped', message }
    } else {
      if (readCard(id)) {
        job.steps.card = { status: 'done', message: '已有七段卡' }
      } else {
        job.steps.card = { status: 'running', message: '调用模型生成' }
        job.step = '七段卡'
        try {
          startCardJob(record)
          const done = await waitIngestJob(jobs, id, INGEST_TIMEOUT.card)
          if (!done || done.status !== 'done') {
            job.steps.card = {
              status: 'failed',
              message: done?.error?.message || (done ? '七段卡未完成' : '七段卡超时'),
            }
          } else {
            job.steps.card = { status: 'done', message: '完成' }
          }
        } catch (error) {
          job.steps.card = { status: 'failed', message: String(error?.message || error) }
        }
      }

      if (job.steps.card.status !== 'done' || !readCard(id)) {
        job.steps.deepread = { status: 'skipped', message: '七段卡未完成，跳过精读' }
      } else if (readDeepRead(id)) {
        job.steps.deepread = { status: 'done', message: '已有精读' }
      } else {
        job.steps.deepread = { status: 'running', message: '调用模型生成' }
        job.step = '精读'
        try {
          startDeepJob(record)
          const done = await waitIngestJob(deepJobs, id, INGEST_TIMEOUT.deepread)
          if (!done || done.status !== 'done') {
            job.steps.deepread = {
              status: 'failed',
              message: done?.error?.message || (done ? '精读未完成' : '精读超时'),
            }
          } else {
            job.steps.deepread = { status: 'done', message: '完成' }
          }
        } catch (error) {
          job.steps.deepread = { status: 'failed', message: String(error?.message || error) }
        }
      }
    }
  } catch (error) {
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
    for (const [key, step] of Object.entries(job.steps)) {
      if (step.status === 'running') job.steps[key] = { status: 'failed', message: job.error.message }
    }
  } finally {
    finishIngestJob(job)
  }
}

/* ---------------- 翻译任务 ---------------- */
const translateJobs = new Map()
let translateChain = Promise.resolve()

function publicTranslateJob(job) {
  if (!job) return null
  return {
    id: job.id, status: job.status, step: job.step, total: job.total || 0,
    done: job.done || 0, failed: job.failed || 0, startedAt: job.startedAt,
    finishedAt: job.finishedAt, error: job.error, summary: job.summary || null,
  }
}

function startTranslateJob(record, params) {
  const existing = translateJobs.get(record.id)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: record.id, status: 'queued', step: '排队中', total: 0, done: 0, failed: 0,
    startedAt: new Date().toISOString(), finishedAt: null, error: null, summary: null,
  }
  translateJobs.set(record.id, job)
  translateChain = translateChain.then(() => runTranslateJob(record.id, job, params)).catch(() => {})
  return job
}

async function runTranslateJob(id, job, params) {
  job.status = 'running'
  job.step = '准备翻译'
  try {
    const record = readIndex().find((r) => r.id === id)
    if (!record) throw Object.assign(new Error('论文不存在'), { code: 'not_found' })
    const result = await translateDocument({
      ctx: pluginCtx, record, params, force: params.force === true,
      onProgress: (progress) => {
        job.total = progress.total ?? job.total
        job.done = progress.done ?? job.done
        job.failed = progress.failed ?? job.failed
        if (progress.step) job.step = progress.step
      },
    })
    job.summary = translationSummary(result.doc)
    job.status = 'done'
    job.step = '完成'
  } catch (error) {
    job.status = 'failed'
    job.step = '失败'
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
  } finally {
    job.finishedAt = new Date().toISOString()
  }
}

/* ---------------- 图谱任务（P3，串行） ---------------- */
const graphJobs = new Map()
let graphChain = Promise.resolve()
const GRAPH_JOB_ID = 'graph'

function publicGraphJob(job) {
  if (!job) return null
  return {
    id: job.id, status: job.status, step: job.step,
    done: job.done || 0, total: job.total || 0,
    analyzed: job.analyzed || 0, skipped: job.skipped || 0, failed: job.failed || 0,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    error: job.error, summary: job.summary || null,
  }
}

function startGraphJob(params) {
  const existing = graphJobs.get(GRAPH_JOB_ID)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing
  const job = {
    id: GRAPH_JOB_ID, status: 'queued', step: '排队中', done: 0, total: 0,
    analyzed: 0, skipped: 0, failed: 0,
    startedAt: new Date().toISOString(), finishedAt: null, error: null, summary: null,
  }
  graphJobs.set(GRAPH_JOB_ID, job)
  graphChain = graphChain.then(() => runGraphJob(job, params)).catch(() => {})
  return job
}

async function runGraphJob(job, params) {
  job.status = 'running'
  job.step = '准备抽取概念与边'
  try {
    const summary = await buildAll({
      ctx: pluginCtx,
      paperIds: params.paperIds,
      force: params.force,
      onProgress: (progress) => {
        if (typeof progress.done === 'number') job.done = progress.done
        if (typeof progress.total === 'number') job.total = progress.total
        if (typeof progress.analyzed === 'number') job.analyzed = progress.analyzed
        if (typeof progress.skipped === 'number') job.skipped = progress.skipped
        if (typeof progress.failed === 'number') job.failed = progress.failed
        if (progress.step) job.step = progress.step
      },
    })
    job.summary = summary
    job.status = 'done'
    job.step = summary.failed ? '完成（部分失败，见摘要）' : '完成'
  } catch (error) {
    job.status = 'failed'
    job.step = '失败'
    job.error = { code: error?.code || 'error', message: String(error?.message || error) }
  } finally {
    job.finishedAt = new Date().toISOString()
  }
}


/* ---------------- 卡片编辑 / 批注 / 状态 ---------------- */
const STATUSES = ['待读', '略读', '精读', '已引用', '弃读']

async function updateStatus(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8'))
    const record = readIndex().find((r) => r.id === String(body.id || ''))
    if (!record) {
      json(res, 404, { ok: false, error: '论文不存在' })
      return
    }
    const from = record.status || '待读'
    const to = String(body.to || '').trim()
    const reason = String(body.reason || '').trim()
    if (!STATUSES.includes(to)) {
      json(res, 422, { ok: false, error: '未知状态', from, to })
      return
    }
    const nextRecord = { ...record, status: to, statusReason: reason, statusSource: 'manual' }
    const card = readCard(record.id)
    if (card) {
      card.statusHistory = Array.isArray(card.statusHistory) ? card.statusHistory : []
      card.statusHistory.push({ from, to, at: new Date().toISOString(), reason })
      card.updatedAt = new Date().toISOString()
      writeCard(card, nextRecord)
    } else {
      upsert(nextRecord)
    }
    json(res, 200, { ok: true, paper: nextRecord, card })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

function queryParam(req, key) {
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get(key) || ''
  } catch {
    return ''
  }
}


export function apply(ctx) {
  const webServer = ctx.webServer
  pluginCtx = ctx
  ctx.logger?.info?.(`[dsh-litkb] plugin loaded v${pkg.version}`)
  try {
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
    if (tools && typeof tools.register === 'function') {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const disposers = registerAgentTools(ctx, tools)
          return () => disposers.forEach((dispose) => { try { dispose() } catch { /* ignore */ } })
        }, 'dsh-litkb: agent tools')
      } else {
        registerAgentTools(ctx, tools)
      }
      ctx.logger?.info?.(`[dsh-litkb] ${AGENT_TOOL_NAMES.length} agent tools registered`)
    } else {
      ctx.logger?.warn?.('[dsh-litkb] tools unavailable; agent tools skipped')
    }
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] agent tools skipped: ${String(error?.message || error)}`)
  }
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[dsh-litkb] webServer unavailable; routes skipped')
    return
  }

  ensureLibrary()
  try {
    const recovery = recoverInterruptedRestore()
    if (recovery.recovered) {
      ctx.logger?.warn?.(`[dsh-litkb] recovered ${recovery.recovered} data roots from an interrupted restore`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] restore recovery skipped: ${String(error?.message || error)}`)
  }
  try {
    const migrated = migrateAutoStatuses()
    if (migrated) ctx.logger?.info?.(`[dsh-litkb] auto reading status migrated: ${migrated} paper(s)`)
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-litkb] auto status migration skipped: ${String(error?.message || error)}`)
  }

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/health',
    handler: async (req, res) => {
      json(res, 200, {
        ok: true, plugin: name, version: pkg.version, stage: 'P5',
        library: PATHS.root, stats: stats(readIndex()), time: new Date().toISOString(),
      })
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/papers',
    handler: async (req, res) => {
      try {
        const rows = readIndex().sort((a, b) => String(b.added).localeCompare(String(a.added)))
        json(res, 200, { ok: true, papers: rows, stats: stats(rows), library: PATHS.root })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/tags',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        json(res, 200, { ok: true, tags: listTags(), types: TYPES })
        return
      }
      json(res, 405, { ok: false, error: 'method not allowed' })
    },
  })

  // 读卡片：卡片本体 + 生成任务 + 模型可用性（前端据此决定按钮是否可点）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (!id) {
          json(res, 400, { ok: false, error: '缺少 id' })
          return
        }
        const record = readIndex().find((r) => r.id === id)
        const pdfMissing = record ? !existsSync(join(PATHS.papers, record.file)) : true
        const card = readCard(id)
        const blocks = readBlocks(id)
        if (card && blocks) {
          const changed = repairEvidenceBlocks(card, blocks)
          if (changed) writeCard(card, record)
        }
        json(res, 200, {
          ok: true,
          card,
          job: publicJob(jobs.get(id)),
          llm: llmStatus(pluginCtx),
          pdfMissing,
          blocks: blocksSummary(blocks),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 生成七段卡：立即返回 202 + job，前端轮询 /api/litkb/card
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/generate',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const id = String(body.id || '')
        const record = readIndex().find((r) => r.id === id)
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const status = llmStatus(pluginCtx)
        if (!status.available) {
          json(res, 503, { ok: false, code: 'no_llm', error: '宿主未提供模型服务，七段卡无法生成' })
          return
        }
        if (!status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '没有可用的默认模型' })
          return
        }
        if (body.force !== true) {
          const existing = readCard(id)
          if (existing) {
            json(res, 200, { ok: true, skipped: true, card: existing, job: publicJob(jobs.get(id)) })
            return
          }
        }
        const job = startCardJob(record)
        json(res, 202, { ok: true, job: publicJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 保存某段正文（写回 card.json + md，旧版备份）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/section',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        const card = record ? readCard(record.id) : null
        if (!record || !card) {
          json(res, 404, { ok: false, error: '卡片不存在' })
          return
        }
        const key = String(body.key || '')
        const section = (card.sections || []).find((s) => s.key === key)
        if (!section) {
          json(res, 422, { ok: false, error: '未知段落' })
          return
        }
        const text = String(body.text || '').trim()
        if (!text) {
          json(res, 422, { ok: false, error: '正文不能为空' })
          return
        }
        if (text.length > 2000) {
          json(res, 422, { ok: false, error: '单段正文不能超过 2000 字' })
          return
        }
        section.text = text
        card.updatedAt = new Date().toISOString()
        card.editedSections = [...new Set([...(card.editedSections || []), key])]
        recomputeCardStatus(card)
        writeCard(card, record)
        json(res, 200, { ok: true, card })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 追加批注
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/evidence',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const record = readIndex().find((row) => row.id === String(body.id || ''))
        const card = record ? readCard(record.id) : null
        if (!record || !card) { json(res, 404, { ok: false, error: '卡片不存在' }); return }
        const quote = String(body.quote || '').trim()
        if (!quote) { json(res, 422, { ok: false, error: '缺少原文句子' }); return }
        const evidence = addQuoteEvidence(card, {
          quote, page: body.page, block: body.block,
        })
        if (!evidence) { json(res, 422, { ok: false, error: '证据不合法' }); return }
        writeCard(card, record)
        json(res, 200, { ok: true, evidence })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/annotate',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        const card = record ? readCard(record.id) : null
        if (!record || !card) {
          json(res, 404, { ok: false, error: '卡片不存在' })
          return
        }
        const text = String(body.text || '').trim()
        if (!text) {
          json(res, 422, { ok: false, error: '批注不能为空' })
          return
        }
        if (text.length > 1000) {
          json(res, 422, { ok: false, error: '批注不能超过 1000 字' })
          return
        }
        addAnnotation(card, text, {
          quote: body.quote,
          page: body.page,
          block: body.block,
        })
        writeCard(card, record)
        json(res, 200, { ok: true, card })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({ kind: 'exact', path: '/api/litkb/card/status', handler: updateStatus })

  // 单段 / 整卡重生成
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/regenerate',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const key = body.key ? String(body.key) : null
        if (key && !readCard(record.id)) {
          json(res, 409, { ok: false, code: 'no_card', error: '还没有七段卡，请先生成整卡' })
          return
        }
        const status = llmStatus(pluginCtx)
        if (!status.available || !status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '宿主未提供可用模型' })
          return
        }
        const job = startCardJob(record, { key })
        json(res, 202, { ok: true, job: publicJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 版本列表 / 回滚
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/versions',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (!id) {
          json(res, 400, { ok: false, error: '缺少 id' })
          return
        }
        json(res, 200, { ok: true, versions: listVersions(id) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/card/restore',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const card = readVersion(record.id, body.version)
        if (!card) {
          json(res, 404, { ok: false, error: '版本不存在' })
          return
        }
        writeCard(card, record)
        json(res, 200, { ok: true, card })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 原文 PDF：给卡片里的 p.N 跳转用（浏览器原生 #page=N）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/pdf',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const record = readIndex().find((r) => r.id === id)
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const file = join(PATHS.papers, record.file)
        if (!existsSync(file)) {
          json(res, 404, { ok: false, error: 'PDF 文件缺失' })
          return
        }
        const data = readFileSync(file)
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': data.length,
          'content-disposition': `inline; filename="${record.id}.pdf"`,
          'cache-control': 'private, max-age=3600',
        })
        res.end(data)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 解析稿：块文档（读）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/blocks',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (!id) {
          json(res, 400, { ok: false, error: '缺少 id' })
          return
        }
        const doc = readBlocks(id)
        if (doc) doc.paragraphs = documentParagraphs(doc)
        json(res, 200, {
          ok: true,
          doc,
          summary: blocksSummary(doc),
          job: publicBlockJob(blockJobs.get(id)),
          settings: publicSettings(),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 解析稿：构建（同步；几页到几十页通常 1–5 秒）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/blocks/build',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        if (body.force !== true) {
          const cached = readBlocks(record.id)
          if (cached) {
            json(res, 200, { ok: true, doc: cached, summary: blocksSummary(cached), job: null })
            return
          }
        }
        const job = startBlocksJob(record, { force: body.force === true, backend: body.backend })
        json(res, 202, { ok: true, job: publicBlockJob(job) })
      } catch (error) {
        const status = error?.code === 'pdf_missing' ? 404 : 500
        json(res, status, { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  // 解析稿：导出 Markdown（带块锚点）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/blocks.md',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const record = readIndex().find((r) => r.id === id)
        const doc = readBlocks(id)
        if (!record || !doc) {
          json(res, 404, { ok: false, error: '解析稿尚未构建' })
          return
        }
        const markdown = renderParsedMarkdown(doc, record)
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="${record.id}.parse.md"`,
          'cache-control': 'no-store',
        })
        res.end(markdown)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 页图：解析稿右侧的原文页面
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/page',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const record = readIndex().find((r) => r.id === id)
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const page = Number(queryParam(req, 'page')) || 1
        const dpi = Number(queryParam(req, 'dpi')) || 120
        const buffer = await renderPagePng(record, page, dpi)
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': buffer.length,
          'cache-control': 'private, max-age=86400',
          'etag': `W/"${record.id}-${page}-${dpi}-${buffer.length}"`,
        })
        res.end(buffer)
      } catch (error) {
        const status = error?.code === 'pdf_missing' ? 404 : error?.code === 'no_canvas' ? 503 : 500
        json(res, status, { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  // 本地设置（PaddleOCR 令牌等；只回传是否已配置）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/settings',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          json(res, 200, { ok: true, settings: publicSettings(), llm: llmStatus(pluginCtx) })
          return
        }
        const body = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8'))
        const paddle = body.paddle || {}
        const patch = { paddle: {} }
        if (typeof body.autoIngest === 'boolean') {
          patch.autoIngest = body.autoIngest
        }
        if (body.llm && typeof body.llm === 'object') {
          const provider = String(body.llm.provider || 'deepseek-official').trim().slice(0, 80)
          const model = String(body.llm.model || 'deepseek-v4-pro').trim().slice(0, 120)
          if (provider && model) {
            patch.llm = {
              mode: body.llm.mode === 'fixed' ? 'fixed' : 'host',
              provider,
              model,
            }
          }
        }
        if (typeof paddle.token === 'string') {
          patch.paddle.token = paddle.token.trim()
        }
        if (typeof paddle.model === 'string' && paddle.model.trim()) {
          patch.paddle.model = paddle.model.trim()
        }
        if (typeof paddle.enabled === 'boolean') {
          patch.paddle.enabled = paddle.enabled
        }
        writeSettings(patch)
        json(res, 200, { ok: true, settings: publicSettings(), llm: llmStatus(pluginCtx) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 维护：索引重建 / 缓存清理
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/maintenance',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        const action = String(body.action || '')
        if (action === 'rebuild-index') {
          const before = readIndex()
          const map = new Map()
          for (const row of before) if (row?.id) map.set(row.id, row)
          const rows = [...map.values()]
          writeIndex(rows)
          json(res, 200, { ok: true, action, before: before.length, after: rows.length })
          return
        }
        if (action === 'clear-pages') {
          let count = 0
          if (existsSync(PATHS.text)) {
            for (const name of readdirSync(PATHS.text)) {
              if (!name.endsWith('.pages.json')) continue
              unlinkSync(join(PATHS.text, name))
              count += 1
            }
          }
          json(res, 200, { ok: true, action, removed: count })
          return
        }
        if (action === 'clear-history') {
          const file = join(PATHS.cache, 'search-history.json')
          const removed = existsSync(file)
          if (removed) unlinkSync(file)
          json(res, 200, { ok: true, action, removed: removed ? 1 : 0 })
          return
        }
        json(res, 400, { ok: false, error: '未知维护动作' })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 首次上手：按真实库计算里程碑，前端据此显示欢迎页/清单
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/onboarding',
    handler: async (req, res) => {
      try {
        const counts = quickLibraryCounts()
        const items = [
          { key: 'paper', title: '导入第一篇论文', hint: 'PDF 拖拽，或「链接 / DOI」', done: counts.papers > 0, count: counts.papers, target: 'library' },
          { key: 'card', title: '生成七段卡', hint: '打开论文 → 七段卡 → 生成', done: counts.cards > 0, count: counts.cards, target: 'library' },
          { key: 'chain', title: '建一条证据链', hint: '自动建链后在审核队列确认', done: counts.confirmedChains > 0, count: counts.confirmedChains, target: 'library' },
          { key: 'theme', title: '建一个研究并探索', hint: '工作台 → 新建研究 → 开始探索', done: counts.themes > 0, count: counts.themes, target: 'theme' },
          { key: 'draft', title: '写一份文稿', hint: '写作 → 新建文稿 → 插入引用', done: counts.drafts > 0, count: counts.drafts, target: 'writing' },
        ]
        json(res, 200, {
          ok: true,
          version: pkg.version,
          library: PATHS.root,
          items,
          completed: items.filter((item) => item.done).length,
          total: items.length,
          next: items.find((item) => !item.done)?.key || '',
          counts,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 删除论文：GET 影响面 / POST 执行（confirm=true）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/delete',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const impact = paperDeleteImpact(queryParam(req, 'id'))
          if (!impact) {
            json(res, 404, { ok: false, error: '论文不存在' })
            return
          }
          json(res, 200, { ok: true, ...impact })
          return
        }
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        if (body.confirm !== true) {
          json(res, 428, { ok: false, code: 'confirm_required', error: '删除论文需要 confirm=true' })
          return
        }
        const id = String(body.id || '')
        const active = (map) => {
          const job = map.get(id)
          return Boolean(job && (job.status === 'queued' || job.status === 'running'))
        }
        const autoRunning = [...autoChainJobs.values()].some(
          (job) => (job.status === 'queued' || job.status === 'running') && (job.paperIds || []).includes(id),
        )
        if (active(ingestJobs) || active(jobs) || active(deepJobs) || active(blockJobs) || autoRunning) {
          json(res, 409, {
            ok: false,
            code: 'busy',
            error: '这篇论文正在自动处理 / 生成中，请等任务完成后再删除',
          })
          return
        }
        const result = deletePaper(id)
        if (!result) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        ingestJobs.delete(id)
        jobs.delete(id)
        deepJobs.delete(id)
        blockJobs.delete(id)
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 入库自动管线：GET 查询任务 / POST 手动补全
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/ingest',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const id = queryParam(req, 'id')
          if (id) {
            json(res, 200, { ok: true, job: publicIngestJob(ingestJobs.get(id)) })
            return
          }
          json(res, 200, { ok: true, jobs: listIngestJobs() })
          return
        }
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        const record = readIndex().find((row) => row.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const job = startIngestJob(record)
        json(res, 202, { ok: true, job: publicIngestJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 整库备份：下载 zip（不含 settings.json / cache）
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/backup',
    handler: async (req, res) => {
      try {
        const { buffer, filename } = buildBackupZip({ version: pkg.version })
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${filename}"`,
          'content-length': buffer.length,
          'cache-control': 'no-store',
        })
        res.end(buffer)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 从备份恢复：覆盖前自动快照；必须显式 confirm=restore
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/restore',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: '请使用 POST 上传备份' })
          return
        }
        if (queryParam(req, 'confirm') !== 'restore') {
          json(res, 428, { ok: false, code: 'confirm_required', error: '恢复会覆盖当前库，需要确认' })
          return
        }
        const body = await readBody(req, MAX_RESTORE_BYTES)
        const result = restoreBackup(body)
        json(res, 200, { ok: true, ...result, library: PATHS.root, counts: libraryInfo() })
      } catch (error) {
        const rawCode = String(error?.code || 'error')
        const code = rawCode === 'TOO_LARGE' ? 'too_large' : rawCode
        const status = code === 'too_large' ? 413
          : code === 'restore_busy' ? 409
            : ['empty_zip', 'bad_zip', 'bad_entry', 'bad_manifest', 'no_data'].includes(code) ? 422
              : 500
        json(res, status, { ok: false, code, error: String(error?.message || error) })
      }
    },
  })

  // 术语表
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/glossary',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const data = readGlossary()
          json(res, 200, { ok: true, terms: data.terms, hash: glossaryHash(data.terms) })
          return
        }
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8'))
        if (!Array.isArray(body.terms) || body.terms.length > 200) {
          json(res, 422, { ok: false, error: '术语表格式不正确（最多 200 条）' })
          return
        }
        const terms = body.terms
          .map((t) => ({ source: String(t?.source || '').trim(), target: String(t?.target || '').trim(), aliases: Array.isArray(t?.aliases) ? t.aliases : [] }))
          .filter((t) => t.source && t.target)
        const saved = writeGlossary(terms)
        json(res, 200, { ok: true, terms: saved.terms, hash: glossaryHash(saved.terms) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 证据反链：被哪些卡片/草稿引用
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/evidence/backlinks',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (!/^q-[0-9a-f]{8}$/.test(id)) {
          json(res, 400, { ok: false, error: '证据 ID 格式不正确' })
          return
        }
        const paper = queryParam(req, 'paper')
        const links = findBacklinks(id, {
          excludeCard: paper ? join(PATHS.cards, `${paper}.md`) : undefined,
        })
        json(res, 200, { ok: true, id, links })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 证据导出：JSON / CSV
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/evidence/export',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const record = readIndex().find((r) => r.id === id)
        const card = record ? readCard(record.id) : null
        if (!record || !card) {
          json(res, 404, { ok: false, error: '卡片不存在' })
          return
        }
        const format = queryParam(req, 'format') === 'csv' ? 'csv' : 'json'
        const rows = evidenceRows(record, card)
        if (format === 'csv') {
          const data = evidenceCsv(rows)
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${record.id}.evidence.csv"`,
            'cache-control': 'no-store',
          })
          res.end(data)
          return
        }
        const payload = JSON.stringify({
          paper: { id: record.id, title: record.title || '' },
          exportedAt: new Date().toISOString(),
          evidence: rows,
        }, null, 2)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${record.id}.evidence.json"`,
          'cache-control': 'no-store',
        })
        res.end(payload)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 翻译：读取 / 启动任务
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/translate',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const id = queryParam(req, 'id')
          if (!id) {
            json(res, 400, { ok: false, error: '缺少 id' })
            return
          }
          const doc = readTranslation(id)
          json(res, 200, {
            ok: true,
            doc,
            summary: translationSummary(doc),
            job: publicTranslateJob(translateJobs.get(id)),
          })
          return
        }
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        if (!readBlocks(record.id)) {
          json(res, 409, { ok: false, code: 'no_blocks', error: '请先在「解析稿」里构建版面块' })
          return
        }
        const status = llmStatus(pluginCtx)
        if (!status.available || !status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '宿主未提供可用模型' })
          return
        }
        const params = {
          scope: ['summary', 'section', 'paper', 'block'].includes(body.scope) ? body.scope : 'summary',
          section: typeof body.section === 'string' ? body.section : undefined,
          blockIds: Array.isArray(body.blockIds) ? body.blockIds.filter((x) => typeof x === 'string') : [],
          force: body.force === true,
        }
        const job = startTranslateJob(record, params)
        json(res, 202, { ok: true, job: publicTranslateJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })


  /* ---------------- 图谱（P3） ---------------- */
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/graph',
    handler: async (req, res) => {
      try {
        json(res, 200, {
          ok: true,
          graph: readGraph(),
          job: publicGraphJob(graphJobs.get(GRAPH_JOB_ID)),
          concepts: conceptOverview(),
          llm: llmStatus(pluginCtx),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/graph/build',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const paperIds = Array.isArray(body.paperIds)
          ? body.paperIds.map((id) => String(id)).filter(Boolean).slice(0, 100)
          : []
        const hasCard = readIndex().some((record) => readCard(record.id)
          && (!paperIds.length || paperIds.includes(record.id)))
        if (!hasCard) {
          json(res, 409, { ok: false, code: 'no_cards', error: '库里还没有七段卡，无法构图；请先生成至少一篇卡片' })
          return
        }
        const status = llmStatus(pluginCtx)
        if (!status.available || !status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '宿主未提供可用模型，图谱抽取无法进行' })
          return
        }
        const job = startGraphJob({ paperIds, force: body.force === true })
        json(res, 202, { ok: true, job: publicGraphJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/concepts',
    handler: async (req, res) => {
      try {
        json(res, 200, { ok: true, ...conceptOverview(), edges: readEdges().length })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/concepts/merge',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const from = String(body.from || '')
        const into = String(body.into || '')
        if (!from || !into) {
          json(res, 422, { ok: false, error: '缺少 from / into' })
          return
        }
        const store = readConcepts()
        const result = mergeConcepts(store, from, into)
        if (!result.ok) {
          json(res, result.code === 'not_found' ? 404 : 422, { ok: false, code: result.code, error: result.error })
          return
        }
        writeConcepts(store)
        const edges = rebuildEdges()
        json(res, 200, {
          ok: true, merged: result.into.id,
          ...conceptOverview(), edges: edges.length,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/concepts/update',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const id = String(body.id || '')
        if (!id) {
          json(res, 422, { ok: false, error: '缺少 id' })
          return
        }
        const store = readConcepts()
        const result = updateConcept(store, id, {
          name: body.name,
          aliases: body.aliases,
          status: body.status,
          definition: body.definition,
        })
        if (!result.ok) {
          json(res, result.code === 'not_found' ? 404 : 422, { ok: false, code: result.code, error: result.error })
          return
        }
        writeConcepts(store)
        const edges = rebuildEdges()
        json(res, 200, {
          ok: true, concept: result.concept,
          ...conceptOverview(), edges: edges.length,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/compare',
    handler: async (req, res) => {
      try {
        const groups = compareGroups()
        json(res, 200, { ok: true, groups })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/ask',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
        const question = String(body.question || '').trim()
        if (!question) {
          json(res, 422, { ok: false, error: '问题不能为空' })
          return
        }
        if (question.length > 500) {
          json(res, 422, { ok: false, error: '问题不能超过 500 字' })
          return
        }
        const selection = String(body.selection || '').slice(0, 3000)
        const record = readIndex().find((r) => r.id === String(body.id || ''))
        if (!record) {
          json(res, 404, { ok: false, error: '论文不存在' })
          return
        }
        const card = readCard(record.id)
        const blocks = readBlocks(record.id)
        if (!card && !blocks) {
          json(res, 409, { ok: false, code: 'no_material', error: '这篇还没有卡片或解析稿，无法追问' })
          return
        }
        const status = llmStatus(pluginCtx)
        if (!status.available || !status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '宿主未提供可用模型，无法追问' })
          return
        }
        const records = readIndex()
          .map((row) => ({ ...row, card: row.id === record.id ? card : readCard(row.id) }))
          .filter((row) => row.card)
        const result = await askPaper({
          ctx: pluginCtx,
          record,
          card,
          blocks,
          question,
          selection,
          page: Number(body.page) || 0,
          blockId: String(body.blockId || ''),
          records,
        })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, error?.code === 'no_context' ? 409 : 500, {
          ok: false, code: error?.code || 'error', error: String(error?.message || error),
        })
      }
    },
  })

  // 导出：BibTeX / GB-T / 卡片 MD / Mermaid / Canvas
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/export',
    handler: async (req, res) => {
      try {
        const format = queryParam(req, 'format') || 'bibtex'
        const id = queryParam(req, 'id')
        let data = null
        let filename = 'litkb.txt'
        let type = 'text/plain; charset=utf-8'
        if (format === 'bibtex') {
          data = exportBibtex({ id })
          filename = id ? `${id}.bib` : 'litkb.bib'
        } else if (format === 'gbt') {
          if (!id) { json(res, 400, { ok: false, error: '缺少 id' }); return }
          data = exportGbt(id)
          filename = `${id}.gbt.txt`
        } else if (format === 'card') {
          if (!id) { json(res, 400, { ok: false, error: '缺少 id' }); return }
          data = exportCardMarkdown(id)
          filename = `${id}.md`
          type = 'text/markdown; charset=utf-8'
        } else if (format === 'bilingual') {
          if (!id) { json(res, 400, { ok: false, error: '缺少 id' }); return }
          data = exportBilingual(id)
          filename = `${id}.bilingual.md`
          type = 'text/markdown; charset=utf-8'
        } else if (format === 'mermaid') {
          data = exportMermaid()
          filename = 'litkb.mmd'
        } else if (format === 'canvas') {
          data = exportCanvas()
          filename = 'litkb.canvas'
          type = 'application/json; charset=utf-8'
        } else {
          json(res, 400, { ok: false, error: '不支持的导出格式' })
          return
        }
        if (data === null) {
          json(res, 404, { ok: false, error: '论文或卡片不存在' })
          return
        }
        res.writeHead(200, {
          'content-type': type,
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        })
        res.end(data)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })


  /* ---------------- 精读（P4.9） ---------------- */
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/deepread/compare',
    handler: async (req, res) => {
      try {
        const ids = String(queryParam(req, 'ids') || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 6)
        const records = new Map(readIndex().map((record) => [record.id, record]))
        const papers = []
        const sectionMap = new Map()
        for (const id of ids) {
          const record = records.get(id)
          if (!record) continue
          const deepread = readDeepRead(id)
          const sections = {}
          if (deepread) {
            for (const section of deepread.sections || []) {
              sections[section.key] = {
                title: section.title, index: section.index,
                markdown: section.markdown || '',
              }
              if (!sectionMap.has(section.key)) {
                sectionMap.set(section.key, {
                  key: section.key, title: section.title, index: section.index || 99,
                })
              }
            }
          }
          papers.push({
            id: record.id, title: record.title || id, authors: record.authors || '',
            year: record.year || '', available: Boolean(deepread),
            generatedAt: deepread?.generatedAt || '', model: deepread?.model || '',
            sections,
          })
        }
        const sections = [...sectionMap.values()].sort((a, b) => a.index - b.index)
        json(res, 200, { ok: true, papers, sections })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/deepread/section',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const id = String(body.id || '')
        const key = String(body.key || '')
        const deepread = readDeepRead(id)
        if (!deepread) { json(res, 404, { ok: false, error: '还没有精读' }); return }
        const section = (deepread.sections || []).find((item) => item.key === key)
        if (!section) { json(res, 404, { ok: false, error: '这段不存在' }); return }
        section.markdown = String(body.markdown || '').slice(0, 20000)
        section.editedAt = new Date().toISOString()
        deepread.updatedAt = section.editedAt
        deepread.markdown = (deepread.sections || []).map((item) => `## ${item.index}. ${item.title}\n\n${item.markdown.trim()}`).join('\n\n')
        writeDeepRead(deepread)
        json(res, 200, { ok: true, deepread })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/deepread/build',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const id = String(body.id || '')
        const record = readIndex().find((r) => r.id === id)
        if (!record) { json(res, 404, { ok: false, error: '论文不存在' }); return }
        const status = llmStatus(pluginCtx)
        if (!status.available) { json(res, 503, { ok: false, code: 'no_llm', error: '宿主未提供模型服务' }); return }
        if (!status.route) { json(res, 503, { ok: false, code: 'no_model', error: '没有可用的默认模型' }); return }
        if (!readCard(id)) { json(res, 422, { ok: false, code: 'no_card', error: '先生成七段卡，再做精读' }); return }
        if (body.force !== true) {
          const existing = readDeepRead(id)
          if (existing) { json(res, 200, { ok: true, skipped: true, deepread: existing, job: publicDeepJob(deepJobs.get(id)) }); return }
        }
        const job = startDeepJob(record)
        json(res, 202, { ok: true, job: publicDeepJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/deepread',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const deepread = readDeepRead(id)
        const job = deepJobs.get(id) || null
        json(res, 200, { ok: true, deepread, job: publicDeepJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })


  /* ---------------- 论证链（P4.10） ---------------- */
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains',
    handler: async (req, res) => {
      try {
        json(res, 200, { ok: true, chains: listChains() })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/graph',
    handler: async (req, res) => {
      try {
        json(res, 200, { ok: true, graph: chainGraph() })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/layout',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'))
        const positions = writeChainLayout(body.positions || {})
        json(res, 200, { ok: true, count: Object.keys(positions).length })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/vendor/cytoscape.js',
    handler: async (req, res) => {
      try {
        const file = join(HERE, 'vendor', 'cytoscape.min.js')
        if (!existsSync(file)) { json(res, 404, { ok: false, error: '图引擎文件缺失' }); return }
        const data = readFileSync(file)
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-length': data.length,
        })
        res.end(data)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/read',
    handler: async (req, res) => {
      try {
        const chain = readChain(queryParam(req, 'id'))
        if (!chain) { json(res, 404, { ok: false, error: '链不存在' }); return }
        json(res, 200, { ok: true, chain })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/claims',
    handler: async (req, res) => {
      try {
        const paperId = queryParam(req, 'paperId')
        json(res, 200, { ok: true, claims: claimCandidates(paperId) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/propose',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
        const mode = ['claim', 'evidence', 'question', 'block'].includes(body.mode) ? body.mode : 'claim'
        const result = proposeChain({
          mode,
          paperId: String(body.paperId || ''),
          blockId: String(body.blockId || ''),
          claim: String(body.claim || ''),
          question: String(body.question || ''),
          evidenceIds: Array.isArray(body.evidenceIds) ? body.evidenceIds : [],
          pages: Array.isArray(body.pages) ? body.pages : [],
        })
        let model = null
        if (!result.claim && (mode === 'evidence' || mode === 'question') && result.nodes.length) {
          const status = llmStatus(pluginCtx)
          if (status.available && status.route) {
            try {
              const suggestion = await suggestClaim({
                ctx: pluginCtx, question: String(body.question || ''), nodes: result.nodes, origin: mode,
              })
              if (suggestion.text) {
                result.claim = suggestion.text
                model = suggestion.model
              } else {
                result.warnings.push('AI 没有给出可用的论点，请手动填写')
              }
            } catch (error) {
              result.warnings.push(`AI 提论点失败：${String(error?.message || error)}`)
            }
          } else {
            result.warnings.push('模型不可用，论点请手动填写')
          }
        }
        json(res, 200, { ok: true, ...result, model })
      } catch (error) {
        const code = error?.code || 'error'
        const status = code === 'not_found' ? 404
          : ['empty_claim', 'empty_question', 'no_blocks', 'block_not_found', 'bad_block', 'block_too_short', 'no_card'].includes(code) ? 422 : 500
        json(res, status, { ok: false, code, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/auto/run',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const paperIds = Array.isArray(body.paperIds) ? body.paperIds : []
        const scope = body.scope === 'paper' || (paperIds.length && body.scope !== 'library') ? 'paper' : 'library'
        const ids = scope === 'library' ? readIndex().map((record) => record.id) : paperIds
        const sections = Array.isArray(body.sections)
          ? body.sections.filter((key) => ['conclusion', 'innovation', 'limitations', 'takeaways'].includes(key))
          : []
        const mode = body.mode === 'cross' ? 'cross' : 'paper'
        const job = startAutoChainJob({
          paperIds: ids, sections, autoConfirm: Boolean(body.autoConfirm),
          mode, topic: String(body.topic || ''), maxPairs: Number(body.maxPairs) || 16,
        })
        if (!job) { json(res, 400, { ok: false, error: '没有可处理的论文' }); return }
        json(res, 200, { ok: true, job: publicAutoChainJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/auto/jobs',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (id) {
          const job = autoChainJobs.get(id)
          if (!job) { json(res, 404, { ok: false, error: '任务不存在' }); return }
          json(res, 200, { ok: true, job: publicAutoChainJob(job) })
          return
        }
        const list = [...autoChainJobs.values()]
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
          .slice(0, 20)
          .map((job) => publicAutoChainJob(job))
        json(res, 200, { ok: true, jobs: list })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/dedupe',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}')
        const themeId = String(body.themeId || '')
        if (!themeId) { json(res, 400, { ok: false, error: '缺少 themeId' }); return }
        const confirmed = themeChains(themeId).list.filter((chain) => chain.status === 'confirmed')
        const groups = new Map()
        for (const chain of confirmed) {
          const key = chain.provenance?.facetKey || `__${chain.id}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(chain)
        }
        let mergedGroups = 0
        let removed = 0
        for (const list of groups.values()) {
          if (list.length < 2) continue
          const ordered = list.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
          const target = ordered[0]
          const seen = new Set()
          const nodes = []
          for (const item of ordered) {
            for (const node of item.nodes || []) {
              if (!node?.evidenceId || seen.has(node.evidenceId)) continue
              seen.add(node.evidenceId)
              nodes.push(node)
              if (nodes.length >= 12) break
            }
          }
          saveChain({
            ...target, nodes,
            status: 'confirmed',
            review: { action: 'deduped', at: new Date().toISOString(), from: ordered.slice(1).map((item) => item.id) },
          })
          for (const item of ordered.slice(1)) {
            deleteChain(item.id)
            removed += 1
          }
          mergedGroups += 1
        }
        json(res, 200, { ok: true, groups: mergedGroups, removed })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/review/batch',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))]
          .filter((id) => /^c-[a-zA-Z0-9_-]+$/.test(id))
          .slice(0, 50)
        const action = body.action === 'reject' ? 'reject' : 'accept'
        if (!ids.length) { json(res, 400, { ok: false, error: '缺少链 id' }); return }
        const results = []
        for (const id of ids) {
          try {
            const chain = readChain(id)
            if (!chain) { results.push({ id, ok: false, error: '链不存在' }); continue }
            if (chain.status !== 'draft') { results.push({ id, ok: false, error: '不是草稿' }); continue }
            if (action === 'reject') {
              deleteChain(id)
              results.push({ id, ok: true })
            } else {
              saveChain({
                ...chain,
                status: 'confirmed',
                review: { action: 'accepted', at: new Date().toISOString() },
              })
              results.push({ id, ok: true })
            }
          } catch (error) {
            results.push({ id, ok: false, error: String(error?.message || error) })
          }
        }
        const succeeded = results.filter((item) => item.ok).length
        json(res, 200, {
          ok: true, action, succeeded,
          failed: results.length - succeeded,
          results,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/review',
    handler: async (req, res) => {
      try {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          const origin = queryParam(req, 'origin')
          const records = new Map(readIndex().map((record) => [record.id, record]))
        const chains = listChains()
          .filter((chain) => chain.status === 'draft')
          .filter((summary) => !origin || summary.origin === origin)
          .map((summary) => {
            const chain = readChain(summary.id)
            return chain ? {
              ...chain,
              paperTitle: records.get(chain.claim?.paperId)?.title || '',
              themeTitle: chain.provenance?.themeId ? (readTheme(chain.provenance.themeId)?.title || '') : '',
            } : null
          })
          .filter(Boolean)
          json(res, 200, { ok: true, chains, count: chains.length, origin: origin || 'all' })
          return
        }
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const id = String(body.id || '')
        const action = String(body.action || '')
        if (!id) { json(res, 400, { ok: false, error: '缺少链 id' }); return }
        if (action === 'reject') {
          const chain = readChain(id)
          if (!chain) { json(res, 404, { ok: false, error: '链不存在' }); return }
          deleteChain(id)
          json(res, 200, { ok: true, action, id })
          return
        }
        if (action === 'accept') {
          const chain = readChain(id)
          if (!chain) { json(res, 404, { ok: false, error: '链不存在' }); return }
          const facetKey = chain.provenance?.facetKey || ''
          const viewpointId = chain.provenance?.viewpointId || ''
          let primary = chain.provenance?.previousChainId ? readChain(chain.provenance.previousChainId) : null
          if (viewpointId) {
            // 观点链只和同一观点的 confirmed 合并，绝不并进 facet 主链。
            if (!primary || primary.status !== 'confirmed' || primary.provenance?.viewpointId !== viewpointId) {
              primary = themeChains(chain.provenance.themeId).list.find((item) => (
                item.id !== id && item.status === 'confirmed' && item.provenance?.viewpointId === viewpointId
              )) || null
            }
          } else if ((!primary || primary.status !== 'confirmed') && facetKey && chain.provenance?.themeId) {
            primary = themeChains(chain.provenance.themeId).list.find((item) => (
              item.id !== id && item.status === 'confirmed' && item.provenance?.facetKey === facetKey
            )) || null
          }
          if (primary && primary.id !== id && primary.provenance?.facetKey === facetKey
            && (!viewpointId || primary.provenance?.viewpointId === viewpointId)) {
            const seen = new Set()
            const nodes = []
            for (const node of [...(primary.nodes || []), ...(chain.nodes || [])]) {
              if (!node?.evidenceId || seen.has(node.evidenceId)) continue
              seen.add(node.evidenceId)
              nodes.push(node)
              if (nodes.length >= 12) break
            }
            const saved = saveChain({
              ...primary, nodes,
              status: 'confirmed',
              review: { action: 'merged', at: new Date().toISOString(), from: id },
            })
            deleteChain(id)
            json(res, 200, { ok: true, action: 'accept', merged: true, chain: saved })
            return
          }
          const saved = saveChain({
            ...chain, status: 'confirmed',
            review: { action: 'accepted', at: new Date().toISOString() },
          })
          json(res, 200, { ok: true, action, chain: saved })
          return
        }
        if (action === 'merge') {
          const targetId = String(body.targetId || '')
          if (!targetId || targetId === id) { json(res, 400, { ok: false, error: '请选择另一条目标链' }); return }
          const source = readChain(id)
          const target = readChain(targetId)
          if (!source || !target) { json(res, 404, { ok: false, error: '源链或目标链不存在' }); return }
          const seen = new Set()
          const nodes = []
          for (const node of [...(target.nodes || []), ...(source.nodes || [])]) {
            if (!node?.evidenceId || seen.has(node.evidenceId)) continue
            seen.add(node.evidenceId)
            nodes.push(node)
            if (nodes.length >= 12) break
          }
          const saved = saveChain({
            ...target, nodes, status: 'confirmed',
            review: { action: 'merged', at: new Date().toISOString(), from: id },
          })
          deleteChain(id)
          json(res, 200, { ok: true, action, chain: saved })
          return
        }
        json(res, 400, { ok: false, error: '未知审核动作' })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/save',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString('utf8'))
        const chain = saveChain(body)
        json(res, 200, { ok: true, chain })
      } catch (error) {
        const code = error?.code || 'invalid'
        json(res, code === 'not_found' ? 404 : 422, { ok: false, code, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/delete',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        if (!deleteChain(String(body.id || ''))) { json(res, 404, { ok: false, error: '链不存在' }); return }
        json(res, 200, { ok: true, id: String(body.id) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/chains/insert',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const chain = readChain(String(body.id || ''))
        if (!chain) { json(res, 404, { ok: false, error: '链不存在' }); return }
        if (body.append === true) {
          const result = appendChainToDraft({ chain, draftId: String(body.draftId || '') })
          json(res, 200, { ok: true, ...result })
          return
        }
        json(res, 200, { ok: true, ...chainParagraph(chain) })
      } catch (error) {
        json(res, error?.code === 'not_found' ? 404 : 422, {
          ok: false, code: error?.code || 'error', error: String(error?.message || error),
        })
      }
    },
  })


  /* ---------------- 研究工作台（P5） ---------------- */
  const themeJobs = new Map()
  let themeQueue = Promise.resolve()

  function publicThemeJob(job) {
    if (!job) return null
    return {
      id: job.id,
      themeId: job.themeId,
      status: job.status,
      step: job.step,
      total: job.total,
      done: job.done,
      created: job.created,
      failed: job.failed,
      gaps: job.gaps,
      items: job.items.slice(-80),
      errors: job.errors.slice(-20),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  }

  function themeErrorStatus(error) {
    const code = error?.code
    if (code === 'not_found') return 404
    if (['empty_title', 'facet_title_required', 'too_many_facets', 'bad_paper', 'no_facets', 'no_papers', 'no_analysis', 'no_failed_facets', 'bad_action', 'bad_mode'].includes(code)) return 422
    return 500
  }

  const themeJobDir = join(PATHS.cache, 'theme-jobs')
  function persistThemeJob(job, extra = {}) {
    try {
      if (!existsSync(themeJobDir)) mkdirSync(themeJobDir, { recursive: true })
      const payload = {
        id: job.id, themeId: job.themeId, status: job.status,
        facetKeys: job.facetKeys || [], createdAt: job.createdAt || new Date().toISOString(),
        ...extra,
      }
      writeFileSync(join(themeJobDir, `${job.id}.json`), JSON.stringify(payload), 'utf8')
    } catch { /* 持久化失败不影响任务 */ }
  }
  function clearPersistedJob(id) {
    try {
      const file = join(themeJobDir, `${id}.json`)
      if (existsSync(file)) unlinkSync(file)
    } catch { /* ignore */ }
  }

  function startThemeChainJob({ themeId, facetKeys = [] } = {}) {
    const theme = readTheme(themeId)
    if (!theme) throw Object.assign(new Error('研究不存在'), { code: 'not_found' })
    const enabled = theme.facets.filter((facet) => facet.enabled)
    if (!enabled.length) throw Object.assign(new Error('这条研究还没有细分描述'), { code: 'no_facets' })
    const wanted = Array.isArray(facetKeys) && facetKeys.length ? new Set(facetKeys) : null
    const targets = wanted ? enabled.filter((facet) => wanted.has(facet.key)) : enabled
    if (!targets.length) throw Object.assign(new Error('没有选中的细分描述'), { code: 'no_facets' })
    const job = {
      id: `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      themeId,
      status: 'queued', step: '排队中',
      total: targets.length, done: 0, created: 0, failed: 0,
      gaps: [], items: [], errors: [], facetKeys: wanted ? [...wanted] : [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(), finishedAt: null,
    }
    themeJobs.set(job.id, job)
    persistThemeJob(job)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const [id, item] of themeJobs) {
      if (item.status !== 'running' && item.status !== 'queued' && Date.parse(item.finishedAt || item.startedAt) < cutoff) themeJobs.delete(id)
    }
    themeQueue = themeQueue.then(() => runThemeChainJob(job, { facetKeys: wanted ? [...wanted] : [] })).catch(() => {})
    return job
  }

  async function runThemeChainJob(job, options) {
    job.status = 'running'
    job.step = '匹配细分描述'
    try {
      const theme = readTheme(job.themeId)
      if (!theme) throw Object.assign(new Error('研究不存在'), { code: 'not_found' })
      if (job.status === 'canceled') { job.step = '已取消'; job.finishedAt = new Date().toISOString(); return }
      const result = themeChainDrafts(theme, { facetKeys: options.facetKeys })
      if (job.status === 'canceled') { job.step = '已取消'; job.finishedAt = new Date().toISOString(); return }
      job.gaps = result.gaps
      recordThemeMatch(theme.id, aggregateThemePapers(result.results))
      for (const draft of result.drafts) {
        if (job.status === 'canceled') { job.step = '已取消'; job.finishedAt = new Date().toISOString(); return }
        job.step = `生成草稿：${draft.claim?.text || draft.title}`
        try {
          const chain = saveChain({ ...draft, id: draft.existingChainId, status: 'draft' })
          job.created += 1
          job.items.push({
            chainId: chain.id,
            facetKey: draft.provenance?.facetKey || '',
            title: chain.title,
            confidence: chain.confidence,
          })
        } catch (error) {
          job.failed += 1
          job.errors.push({
            facetKey: draft.provenance?.facetKey || '',
            message: String(error?.message || error),
            code: error?.code || 'error',
          })
        }
        job.done += 1
      }
      job.done = job.total
      markThemeRun(theme.id, { runId: result.runId, model: null })
      job.status = 'done'
      job.step = '完成'
      clearPersistedJob(job.id)
    } catch (error) {
      job.status = 'failed'
      clearPersistedJob(job.id)
      job.step = '失败'
      job.errors.push({ message: String(error?.message || error), code: error?.code || 'error' })
    } finally {
      job.finishedAt = new Date().toISOString()
    }
  }

  /* ---------------- 方向分析（v0.16.0） ---------------- */
  const analysisJobs = new Map()
  const lastAnalysisJob = new Map()
  let analysisQueue = Promise.resolve()

  function publicAnalysisJob(job) {
    if (!job) return null
    return {
      id: job.id,
      themeId: job.themeId,
      status: job.status,
      step: job.step,
      total: job.total,
      done: job.done,
      retryFailed: Boolean(job.retryFailed),
      papers: job.papers.slice(-80),
      facets: job.facets.slice(-20),
      errors: job.errors.slice(-20),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  }

  function startThemeAnalysisJob({ themeId, paperIds = [], facetKeys = [], retryFailed = false } = {}) {
    const theme = readTheme(themeId)
    if (!theme) throw Object.assign(new Error('研究不存在'), { code: 'not_found' })
    const enabled = theme.facets.filter((facet) => facet.enabled)
    if (!enabled.length) throw Object.assign(new Error('这条研究还没有细分描述'), { code: 'no_facets' })
    const wanted = Array.isArray(facetKeys) && facetKeys.length ? new Set(facetKeys) : null
    let facets = wanted ? enabled.filter((facet) => wanted.has(facet.key)) : enabled
    if (!facets.length) throw Object.assign(new Error('没有选中的细分描述'), { code: 'no_facets' })
    const existingAnalysis = readAnalysis(themeId)
    let records = []
    if (retryFailed) {
      if (!existingAnalysis) throw Object.assign(new Error('还没有方向分析，无法重试'), { code: 'no_analysis' })
      facets = facets.filter((facet) => !existingAnalysis.facets?.[facet.key])
      if (!facets.length) throw Object.assign(new Error('没有失败的细分描述需要重试'), { code: 'no_failed_facets' })
    } else {
      const all = analysisPapers(theme)
      const allowed = new Set(all.map((record) => record.id))
      const requested = Array.isArray(paperIds) ? paperIds.map((id) => String(id || '')).filter((id) => allowed.has(id)) : []
      records = requested.length ? all.filter((record) => requested.includes(record.id)) : all
      if (!records.length) throw Object.assign(new Error('没有可分析的论文（需要七段卡）'), { code: 'no_papers' })
    }
    const job = {
      id: `analysis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      themeId,
      status: 'queued',
      step: '排队中',
      total: records.length + facets.length,
      done: 0,
      papers: [],
      facets: [],
      errors: [],
      facetKeys: facets.map((facet) => facet.key),
      retryFailed,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    analysisJobs.set(job.id, job)
    lastAnalysisJob.set(themeId, job)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const [id, item] of analysisJobs) {
      if (item.status !== 'running' && item.status !== 'queued' && Date.parse(item.finishedAt || item.startedAt) < cutoff) analysisJobs.delete(id)
    }
    analysisQueue = analysisQueue.then(() => runThemeAnalysisJob(job, { records, facets, retryFailed })).catch(() => {})
    return job
  }

  async function runThemeAnalysisJob(job, { records, facets, retryFailed = false }) {
    if (job.status === 'cancelled') {
      job.finishedAt = new Date().toISOString()
      return
    }
    job.status = 'running'
    const theme = readTheme(job.themeId)
    if (!theme) {
      job.status = 'failed'
      job.step = '研究不存在'
      job.finishedAt = new Date().toISOString()
      return
    }
    const status = llmStatus(pluginCtx)
    if (!status.available || !status.route) {
      job.status = 'failed'
      job.step = '宿主未提供可用模型'
      job.errors.push({ code: 'no_model', message: '方向分析需要模型；请先在 DSH 设置模型' })
      job.finishedAt = new Date().toISOString()
      return
    }
    const analysis = readAnalysis(theme.id) || {
      version: 1,
      themeId: theme.id,
      runId: job.id,
      at: new Date().toISOString(),
      model: `${status.route.provider}/${status.route.model}`,
      papers: {},
      facets: {},
    }
    analysis.runId = job.id
    analysis.at = new Date().toISOString()
    analysis.model = `${status.route.provider}/${status.route.model}`
    analysis.papers = analysis.papers || {}
    analysis.facets = analysis.facets || {}
    for (const record of retryFailed ? [] : records) {
      if (job.status === 'cancelled') break
      job.step = `全文方向审查：${record.title || record.id}`
      try {
        const result = await extractPaperAnalysis({
          ctx: pluginCtx, route: status.route, theme, record,
          facetKeys: facets.map((facet) => facet.key),
        })
        analysis.papers[record.id] = result
        job.papers.push({ paperId: record.id, title: result.title, facets: result.facets })
      } catch (error) {
        job.errors.push({ paperId: record.id, code: error?.code || 'error', message: String(error?.message || error) })
      }
      analysis.stats = analysisStats(analysis)
      saveAnalysis(analysis)
      job.done += 1
    }
    for (const facet of facets) {
      if (job.status === 'cancelled') break
      job.step = `观点对比：${facet.title}`
      try {
        const result = await synthesizeFacet({
          ctx: pluginCtx, route: status.route, theme, facet,
          papers: Object.values(analysis.papers),
        })
        analysis.facets[facet.key] = result
        job.facets.push({ key: facet.key, title: facet.title, viewpoints: result.viewpoints.length, relevant: result.relevantCount })
      } catch (error) {
        job.errors.push({ facetKey: facet.key, code: error?.code || 'error', message: String(error?.message || error) })
      }
      analysis.stats = analysisStats(analysis)
      saveAnalysis(analysis)
      job.done += 1
    }
    analysis.stats = analysisStats(analysis)
    saveAnalysis(analysis)
    if (job.status !== 'cancelled') {
      job.status = Object.keys(analysis.papers).length ? 'done' : 'failed'
      job.step = job.status === 'done' ? '完成' : '没有论文完成分析'
    } else {
      job.step = '已取消'
    }
    job.finishedAt = new Date().toISOString()
    lastAnalysisJob.set(theme.id, job)
  }

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/analyze',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const job = startThemeAnalysisJob({
          themeId: String(body.id || ''),
          paperIds: Array.isArray(body.paperIds) ? body.paperIds.map(String) : [],
          facetKeys: Array.isArray(body.facetKeys) ? body.facetKeys.map(String) : [],
          retryFailed: body.retryFailed === true,
        })
        json(res, 202, { ok: true, job: publicAnalysisJob(job) })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/analysis',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        const theme = readTheme(id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const analysis = readAnalysis(theme.id)
        const job = lastAnalysisJob.get(theme.id) || null
        json(res, 200, {
          ok: true,
          analysis,
          stats: analysisStats(analysis),
          job: publicAnalysisJob(job),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/analysis/cancel',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        const job = analysisJobs.get(String(body.id || ''))
        if (!job) { json(res, 404, { ok: false, error: '分析任务不存在' }); return }
        if (job.status === 'queued' || job.status === 'running') {
          job.status = 'cancelled'
          job.step = '已取消'
          job.finishedAt = new Date().toISOString()
        }
        json(res, 200, { ok: true, job: publicAnalysisJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/analysis/chain',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const chain = createViewpointChain({
          themeId: String(body.id || ''),
          facetKey: String(body.facetKey || ''),
          viewpointId: String(body.viewpointId || ''),
        })
        json(res, 200, { ok: true, chain })
      } catch (error) {
        const code = error?.code
        const status = code === 'not_found' ? 404 : code === 'no_analysis' || code === 'no_evidence' ? 422 : 500
        json(res, status, { ok: false, code: code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes',
    handler: async (req, res) => {
      try {
        json(res, 200, { ok: true, themes: listThemes() })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/read',
    handler: async (req, res) => {
      try {
        const theme = readTheme(queryParam(req, 'id'))
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const chains = themeChains(theme.id)
        const facetChains = theme.facets.map((facet) => {
          const chain = chains.byFacet.get(facet.key) || null
          return {
            facetKey: facet.key,
            chain: chain ? {
              id: chain.id, status: chain.status, confidence: chain.confidence,
              nodes: (chain.nodes || []).length, title: chain.title,
            } : null,
          }
        })
        const draft = theme.draftId ? readDraft(theme.draftId) : null
        const parsed = draft ? draftCitations(draft.id) : null
        const draftInfo = draft ? {
          id: draft.id,
          title: draft.title,
          chars: String(draft.body || '').length,
          citations: parsed?.citations?.length || 0,
          missing: parsed?.missing?.length || 0,
          updated: draft.updated,
        } : null
        json(res, 200, {
          ok: true,
          theme,
          chains: chains.list,
          facetChains,
          stats: themeStats(theme, chains.list),
          papers: themePapers(theme, chains.list),
          summaryState: summaryState(theme, chains.list),
          draft: draftInfo,
        })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/save',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const theme = saveTheme(body)
        json(res, 200, { ok: true, theme })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/delete',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const id = String(body.id || '')
        const theme = readTheme(id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const chains = themeChains(id).list.length
        deleteTheme(id)
        json(res, 200, {
          ok: true, id,
          chainsKept: chains,
          draftKept: theme.draftId || '',
          note: chains ? '关联证据链与文稿已保留，可在图谱/写作里继续使用' : '',
        })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/match',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const theme = readTheme(body.id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const facetKeys = Array.isArray(body.facetKeys) ? body.facetKeys.map(String) : []
        const result = matchTheme(theme, { facetKeys })
        if (body.persist) recordThemeMatch(theme.id, result.papers)
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/chain',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const job = startThemeChainJob({
          themeId: String(body.id || ''),
          facetKeys: Array.isArray(body.facetKeys) ? body.facetKeys.map(String) : [],
          retryFailed: body.retryFailed === true,
        })
        json(res, 200, { ok: true, job: publicThemeJob(job) })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/explore',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const theme = readTheme(body.id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const facetKeys = Array.isArray(body.facetKeys) ? body.facetKeys.map(String) : []
        const match = matchTheme(theme, { facetKeys })
        if (!match.results.length) { json(res, 422, { ok: false, code: 'no_facets', error: '这条研究还没有细分描述' }); return }
        recordThemeMatch(theme.id, match.papers)
        const job = startThemeChainJob({ themeId: theme.id, facetKeys })
        json(res, 200, {
          ok: true,
          match: { themeId: theme.id, results: match.results, papers: match.papers },
          job: publicThemeJob(job),
        })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/jobs/cancel',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}')
        const id = String(body.id || '')
        const job = themeJobs.get(id)
        if (!job) { json(res, 404, { ok: false, error: '任务不存在' }); return }
        if (job.status === 'queued' || job.status === 'running') {
          job.status = 'canceled'
          job.step = '已取消'
          job.finishedAt = new Date().toISOString()
          clearPersistedJob(job.id)
        }
        json(res, 200, { ok: true, job: publicThemeJob(job) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/jobs',
    handler: async (req, res) => {
      try {
        const id = queryParam(req, 'id')
        if (id) {
          const job = themeJobs.get(id)
          if (!job) { json(res, 404, { ok: false, error: '任务不存在' }); return }
          json(res, 200, { ok: true, job: publicThemeJob(job) })
          return
        }
        const list = [...themeJobs.values()]
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
          .slice(0, 20)
          .map((job) => publicThemeJob(job))
        json(res, 200, { ok: true, jobs: list })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/papers',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const action = ['include', 'exclude', 'restore'].includes(body.action) ? body.action : 'include'
        const theme = setThemePaper(String(body.id || ''), { paperId: String(body.paperId || ''), action })
        const chains = themeChains(theme.id)
        json(res, 200, {
          ok: true,
          action,
          theme,
          papers: themePapers(theme, chains.list),
          stats: themeStats(theme, chains.list),
        })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/outline',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const theme = readTheme(body.id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        const outline = buildThemeOutline(theme)
        const mode = ['append', 'replace', 'new'].includes(body.mode) ? body.mode : ''
        const warnings = []
        let draft = null
        if (!mode) {
          warnings.push(theme.draftId ? '已有绑定文稿，未写入；可选择追加、覆盖或新建' : '尚未绑定文稿')
        } else if (mode === 'append' && theme.draftId) {
          const current = readDraft(theme.draftId)
          if (!current) warnings.push('绑定的文稿已不存在，将新建')
          else draft = saveDraft(theme.draftId, { body: `${String(current.body || '').trimEnd()}\n\n${outline.markdown}` })
        } else if (mode === 'replace' && theme.draftId) {
          draft = saveDraft(theme.draftId, { body: outline.markdown })
        }
        if (mode && !draft && mode !== 'new') {
          draft = createDraft({ title: `${theme.title} · 初稿`, body: outline.markdown })
          bindThemeDraft(theme.id, draft.id)
        } else if (mode === 'new') {
          draft = createDraft({ title: `${theme.title} · 初稿`, body: outline.markdown })
          bindThemeDraft(theme.id, draft.id)
        }
        json(res, 200, {
          ok: true,
          markdown: outline.markdown,
          citations: outline.citations,
          missing: outline.missing,
          chains: outline.chains,
          draft: draft ? { id: draft.id, title: draft.title, chars: String(draft.body || '').length } : null,
          warnings,
        })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/summary',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const theme = readTheme(body.id)
        if (!theme) { json(res, 404, { ok: false, error: '研究不存在' }); return }
        if (typeof body.text === 'string') {
          const summary = updateThemeSummary(theme.id, { text: body.text, model: null })
          json(res, 200, { ok: true, summary })
          return
        }
        const generated = buildThemeSummary(theme)
        json(res, 200, { ok: true, summary: generated })
      } catch (error) {
        json(res, themeErrorStatus(error), { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/themes/suggest',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const title = String(body.title || '').trim()
        const description = String(body.description || '').trim()
        if (!title) { json(res, 422, { ok: false, code: 'empty_title', error: '先写研究标题' }); return }
        const status = llmStatus(pluginCtx)
        if (status.available && status.route) {
          try {
            const system = '你是文献研究助理。只输出 JSON，不要解释。'
            const user = [
              `研究标题：${title}`,
              description ? `研究描述：${description}` : '',
              '请把这个研究主题拆成 3-6 条可分别检索文献的细分描述（研究问题的一个侧面）。',
              '每条给 title（不超过 30 字）、description（具体要论证什么）、keywords（0-4 个检索词，中英文均可）。',
              '输出格式：{"facets":[{"title":"...","description":"...","keywords":["..."]}]}',
            ].filter(Boolean).join('\n')
            const result = await callModel(pluginCtx, status.route, system, user, null, { maxTokens: 4096, reasoningEffort: 'off' })
            const parsed = parseModelJson(result.text)
            const list = Array.isArray(parsed?.facets) ? parsed.facets : []
            const facets = list
              .filter((item) => item && String(item.title || '').trim())
              .slice(0, 6)
              .map((item, index) => ({
                key: `f${index + 1}`,
                title: String(item.title).trim().slice(0, 80),
                description: String(item.description || '').trim().slice(0, 500),
                keywords: Array.isArray(item.keywords) ? item.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 4) : [],
                mode: 'compare',
                enabled: true,
              }))
            if (facets.length) {
              json(res, 200, { ok: true, facets, source: 'model', model: `${status.route.provider}/${status.route.model}`, note: '' })
              return
            }
          } catch (error) {
            // 模型失败退回模板，不阻塞新建研究
          }
        }
        const template = ['研究背景与问题', '方法与技术路线', '数据与实验设置', '主要结果与指标', '局限与失败模式']
        const facets = template.map((name, index) => ({
          key: `f${index + 1}`,
          title: name,
          description: '',
          keywords: [],
          mode: 'compare',
          enabled: true,
        }))
        json(res, 200, { ok: true, facets, source: 'template', model: null, note: '模型不可用或输出无效，已用模板' })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  // 重启续跑：上次进程中断时留下的 running/queued 主题任务，重新入队。
  try {
    if (existsSync(themeJobDir)) {
      for (const name of readdirSync(themeJobDir)) {
        if (!name.endsWith('.json')) continue
        const file = join(themeJobDir, name)
        try {
          const data = JSON.parse(readFileSync(file, 'utf8'))
          if (data?.themeId && (data.status === 'running' || data.status === 'queued')) {
            startThemeChainJob({ themeId: data.themeId, facetKeys: data.facetKeys || [] })
          }
        } catch { /* 坏文件跳过 */ }
        try { unlinkSync(file) } catch { /* ignore */ }
      }
    }
  } catch { /* 没有缓存目录 */ }

  /* ---------------- 写作（P4.7） ---------------- */
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts',
    handler: async (req, res) => {
      try {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'GET') {
          json(res, 200, { ok: true, drafts: listDrafts() })
          return
        }
        if (method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
        const draft = createDraft({ title: body.title, type: body.type, body: body.body })
        json(res, 201, { ok: true, draft })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/read',
    handler: async (req, res) => {
      try {
        const draft = readDraft(queryParam(req, 'id'))
        if (!draft) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
        json(res, 200, { ok: true, draft, citations: draftCitations(draft.id) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/save',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'))
        const draft = saveDraft(String(body.id || ''), body)
        if (!draft) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
        json(res, 200, { ok: true, draft, citations: draftCitations(draft.id) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/delete',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
        const id = String(body.id || '')
        if (!deleteDraft(id)) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
        json(res, 200, { ok: true, id })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/export',
    handler: async (req, res) => {
      try {
        const format = queryParam(req, 'format') || 'md'
        if (format === 'vault') {
          const buffer = buildVaultZip()
          res.writeHead(200, {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="litkb-vault.zip"',
            'cache-control': 'no-store',
          })
          res.end(buffer)
          return
        }
        const id = queryParam(req, 'id')
        if (!id) { json(res, 400, { ok: false, error: '缺少 id' }); return }
        if (format === 'docx') {
          const draft = readDraft(id)
          if (!draft) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
          const references = draftCitations(id)?.references || []
          const buffer = await draftToDocx(draft, references)
          res.writeHead(200, {
            'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'content-disposition': `attachment; filename="${id}.docx"`,
            'cache-control': 'no-store',
          })
          res.end(buffer)
          return
        }
        const data = exportDraft(id)
        if (data === null) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="${id}.md"`,
          'cache-control': 'no-store',
        })
        res.end(data)
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/citations',
    handler: async (req, res) => {
      try {
        const data = draftCitations(queryParam(req, 'id'))
        if (!data) { json(res, 404, { ok: false, error: '文稿不存在' }); return }
        json(res, 200, { ok: true, ...data })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/search',
    handler: async (req, res) => {
      try {
        let body = {}
        let q = queryParam(req, 'q')
        if (String(req.method || 'GET').toUpperCase() === 'POST') {
          body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}')
          q = String(body.q || q || '')
        }
        const filters = {
          paperId: body.paperId || queryParam(req, 'paperId') || '',
          tag: body.tag || queryParam(req, 'tag') || '',
          yearFrom: body.yearFrom || queryParam(req, 'yearFrom') || '',
          yearTo: body.yearTo || queryParam(req, 'yearTo') || '',
        }
        const limit = Number(body.limit || queryParam(req, 'limit')) || 12
        const result = searchLibrary(q, { ...filters, limit })
        if (q.trim()) recordSearch({
          q, mode: 'evidence', filters, took: result.took,
          chains: result.chains.map((chain) => chain.id),
          evidence: result.evidence.map((item) => item.evidenceId),
        })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/search/answer',
    handler: async (req, res) => {
      try {
        let body = {}
        let q = queryParam(req, 'q')
        if (String(req.method || 'GET').toUpperCase() === 'POST') {
          body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || '{}')
          q = String(body.q || q || '')
        }
        const filters = {
          paperId: body.paperId || queryParam(req, 'paperId') || '',
          tag: body.tag || queryParam(req, 'tag') || '',
          yearFrom: body.yearFrom || queryParam(req, 'yearFrom') || '',
          yearTo: body.yearTo || queryParam(req, 'yearTo') || '',
        }
        const result = await answerQuestion({
          ctx: pluginCtx, question: q, filters,
          limit: Number(body.limit || queryParam(req, 'limit')) || 10,
        })
        if (q.trim()) recordSearch({
          q, mode: result.mode || 'chain-answer', filters, took: result.took,
          chains: (result.chains || []).map((chain) => chain.id),
          evidence: (result.citations || []).map((item) => item.evidenceId),
          citations: (result.citations || []).length,
        })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, error?.code === 'empty_question' ? 400 : 500, {
          ok: false, code: error?.code || 'error', error: String(error?.message || error),
        })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/search/history',
    handler: async (req, res) => {
      try {
        const limit = Number(queryParam(req, 'limit')) || 20
        json(res, 200, { ok: true, items: listSearchHistory(limit), limit: 50 })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/evidence/search',
    handler: async (req, res) => {
      try {
        const q = queryParam(req, 'q')
        json(res, 200, { ok: true, items: searchEvidence(q) })
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/drafts/assist',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
        const status = llmStatus(pluginCtx)
        if (!status.available || !status.route) {
          json(res, 503, { ok: false, code: 'no_model', error: '宿主未提供可用模型' })
          return
        }
        const result = await assistDraft({
          ctx: pluginCtx,
          draftId: String(body.id || ''),
          evidenceIds: Array.isArray(body.evidenceIds) ? body.evidenceIds : [],
          instruction: String(body.instruction || ''),
        })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, error?.code === 'no_evidence' ? 422 : error?.code === 'not_found' ? 404 : 500, {
          ok: false, code: error?.code || 'error', error: String(error?.message || error),
        })
      }
    },
  })

  webServer.register({
    kind: 'exact',
    path: '/api/litkb/diag',
    handler: async (req, res) => {
      const counts = quickLibraryCounts()
      json(res, 200, {
        ok: true,
        version: pkg.version,
        stage: 'P5',
        themes: counts.themes,
        llm: llmStatus(pluginCtx),
        jobs: [...jobs.values()].map(publicJob),
        graphJob: publicGraphJob(graphJobs.get(GRAPH_JOB_ID)),
        pendingConcepts: conceptOverview().pending.length,
        runtime: {
          node: process.version,
          platform: process.platform,
          startedAt: STARTED_AT,
        },
        library: {
          path: PATHS.root,
          ...libraryInfo(),
          counts,
        },
        backup: backupDirInfo(),
        ingest: listIngestJobs(5),
        time: new Date().toISOString(),
      })
    },
  })

  webServer.register({ kind: 'exact', path: '/api/litkb/tags/create', handler: createTag })
  webServer.register({ kind: 'exact', path: '/api/litkb/tags/delete', handler: deleteTag })
  webServer.register({ kind: 'exact', path: '/api/litkb/reclassify', handler: reclassify })
  webServer.register({ kind: 'exact', path: '/api/litkb/import', handler: importPdf })
  webServer.register({
    kind: 'exact',
    path: '/api/litkb/import/link',
    handler: async (req, res) => {
      try {
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}')
        const link = await resolveLink(String(body.value || ''), String(body.kind || 'auto'))
        const result = await importPdfBuffer(link.buffer, link.filename, 'link', { ...link.meta, url: link.url })
        if (result.duplicate) {
          json(res, 200, { ok: true, duplicate: true, code: 'duplicate_sha', paper: result.paper, sourceUrl: link.url })
          return
        }
        json(res, 200, {
          ok: true, paper: result.paper, sourceUrl: link.url,
          ingest: publicIngestJob(maybeStartIngest(result.paper)),
          warning: result.quality < 0.4 ? 'low_quality' : undefined,
          warningText: result.quality < 0.4 ? '解析质量偏低，建议人工核对' : undefined,
        })
      } catch (error) {
        const status = ['empty', 'bad_url', 'bad_doi', 'bad_arxiv', 'not_pdf'].includes(error?.code) ? 400
          : (error?.code === 'too_large' ? 413 : (['no_pdf', 'http_error', 'fetch_failed', 'timeout', 'parse_failed', 'encrypted'].includes(error?.code) ? 422 : 500))
        json(res, status, { ok: false, code: error?.code || 'error', error: String(error?.message || error) })
      }
    },
  })
  webServer.register({ kind: 'exact', path: '/api/litkb/update', handler: updatePaper })

  ctx.logger?.info?.('[dsh-litkb] routes: health / papers / tags / card / blocks / page / settings / pdf / graph / concepts / compare / ask / diag / import / update / reclassify')
}
