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
    if (['empty_title', 'facet_title_required', 'too_many_facets', 'bad_paper', 'no_facets', 'no_papers', 'bad_action', 'bad_mode'].includes(code)) return 422
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
      papers: job.papers.slice(-80),
      facets: job.facets.slice(-20),
      errors: job.errors.slice(-20),
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  }

  function startThemeAnalysisJob({ themeId, paperIds = [], facetKeys = [] } = {}) {
    const theme = readTheme(themeId)
    if (!theme) throw Object.assign(new Error('研究不存在'), { code: 'not_found' })
    const enabled = theme.facets.filter((facet) => facet.enabled)
    if (!enabled.length) throw Object.assign(new Error('这条研究还没有细分描述'), { code: 'no_facets' })
    const wanted = Array.isArray(facetKeys) && facetKeys.length ? new Set(facetKeys) : null
    const facets = wanted ? enabled.filter((facet) => wanted.has(facet.key)) : enabled
    if (!facets.length) throw Object.assign(new Error('没有选中的细分描述'), { code: 'no_facets' })
    const all = analysisPapers(theme)
    const allowed = new Set(all.map((record) => record.id))
    const requested = Array.isArray(paperIds) ? paperIds.map((id) => String(id || '')).filter((id) => allowed.has(id)) : []
    const records = requested.length ? all.filter((record) => requested.includes(record.id)) : all
    if (!records.length) throw Object.assign(new Error('没有可分析的论文（需要七段卡）'), { code: 'no_papers' })
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
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    analysisJobs.set(job.id, job)
    lastAnalysisJob.set(themeId, job)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const [id, item] of analysisJobs) {
      if (item.status !== 'running' && item.status !== 'queued' && Date.parse(item.finishedAt || item.startedAt) < cutoff) analysisJobs.delete(id)
    }
    analysisQueue = analysisQueue.then(() => runThemeAnalysisJob(job, { records, facets })).catch(() => {})
    return job
  }

  async function runThemeAnalysisJob(job, { records, facets }) {
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
    for (const record of records) {
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
