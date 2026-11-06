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
    const pages = doc.pages
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

