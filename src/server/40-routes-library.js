/* 论文库域路由：健康检查、论文列表、卡片、导入导出、备份、标签、删除。 */
function registerLibraryRoutes({ route }) {
  route('/api/litkb/health', async (req, res) => {
    json(res, 200, {
      ok: true, plugin: name, version: pkg.version, stage: 'P5',
      library: PATHS.root, stats: stats(readIndex()), time: new Date().toISOString(),
    })
  }, ['GET'])

  route('/api/litkb/papers', async (req, res) => {
    const rows = readIndex().sort((a, b) => String(b.added).localeCompare(String(a.added)))
    json(res, 200, { ok: true, papers: rows, stats: stats(rows), library: PATHS.root })
  }, ['GET'])

  route('/api/litkb/tags', async (req, res) => {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, tags: listTags(), types: TYPES })
      return
    }
    json(res, 405, { ok: false, error: 'method not allowed' })
  })

  // 读卡片：卡片本体 + 生成任务 + 模型可用性（前端据此决定按钮是否可点）
  route('/api/litkb/card', async (req, res) => {
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
  })

  // 生成七段卡：立即返回 202 + job，前端轮询 /api/litkb/card
  route('/api/litkb/card/generate', async (req, res) => {
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
  })

  // 保存某段正文（写回 card.json + md，旧版备份）
  route('/api/litkb/card/section', async (req, res) => {
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
  })

  // 追加批注
  route('/api/litkb/card/evidence', async (req, res) => {
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
  })

  route('/api/litkb/card/annotate', async (req, res) => {
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
  })

  route('/api/litkb/card/status', updateStatus)

  // 单段 / 整卡重生成
  route('/api/litkb/card/regenerate', async (req, res) => {
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
  })

  // 版本列表 / 回滚
  route('/api/litkb/card/versions', async (req, res) => {
    const id = queryParam(req, 'id')
    if (!id) {
      json(res, 400, { ok: false, error: '缺少 id' })
      return
    }
    json(res, 200, { ok: true, versions: listVersions(id) })
  })

  route('/api/litkb/card/restore', async (req, res) => {
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
  })

  // 原文 PDF：给卡片里的 p.N 跳转用（浏览器原生 #page=N）
  route('/api/litkb/pdf', async (req, res) => {
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
  })

  // 解析稿：块文档（读）
  route('/api/litkb/blocks', async (req, res) => {
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
  })

  // 解析稿：构建（同步；几页到几十页通常 1–5 秒）
  route('/api/litkb/blocks/build', async (req, res) => {
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
  })

  // 解析稿：导出 Markdown（带块锚点）
  route('/api/litkb/blocks.md', async (req, res) => {
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
  })

  // 页图：解析稿右侧的原文页面
  route('/api/litkb/page', async (req, res) => {
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
  })

  // 本地设置（PaddleOCR 令牌等；只回传是否已配置）
  route('/api/litkb/settings', async (req, res) => {
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
  })

  // 维护：索引重建 / 缓存清理
  route('/api/litkb/maintenance', async (req, res) => {
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
  })

  // 首次上手：按真实库计算里程碑，前端据此显示欢迎页/清单
  route('/api/litkb/onboarding', async (req, res) => {
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
  })

  // 删除论文：GET 影响面 / POST 执行（confirm=true）
  route('/api/litkb/delete', async (req, res) => {
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
  })

  // 入库自动管线：GET 查询任务 / POST 手动补全
  route('/api/litkb/ingest', async (req, res) => {
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
  })

  // 整库备份：下载 zip（不含 settings.json / cache）
  route('/api/litkb/backup', async (req, res) => {
    const { buffer, filename } = buildBackupZip({ version: pkg.version })
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': buffer.length,
      'cache-control': 'no-store',
    })
    res.end(buffer)
  })

  // 从备份恢复：覆盖前自动快照；必须显式 confirm=restore
  route('/api/litkb/restore', async (req, res) => {
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
  })

  // 术语表
  route('/api/litkb/glossary', async (req, res) => {
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
  })

  // 证据反链：被哪些卡片/草稿引用
  route('/api/litkb/evidence/backlinks', async (req, res) => {
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
  })

  // 证据导出：JSON / CSV
  route('/api/litkb/evidence/export', async (req, res) => {
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
  })

  // 翻译：读取 / 启动任务
  route('/api/litkb/translate', async (req, res) => {
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
  })


}
