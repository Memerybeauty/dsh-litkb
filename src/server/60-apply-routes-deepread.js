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

