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
      json(res, 200, {
        ok: true,
        version: pkg.version,
        stage: 'P5',
        themes: listThemes().length,
        llm: llmStatus(pluginCtx),
        jobs: [...jobs.values()].map(publicJob),
        graphJob: publicGraphJob(graphJobs.get(GRAPH_JOB_ID)),
        pendingConcepts: conceptOverview().pending.length,
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
