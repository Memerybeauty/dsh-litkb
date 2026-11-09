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

