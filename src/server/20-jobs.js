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

