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
    path: '/api/litkb/chains/review',
    handler: async (req, res) => {
      try {
        if (String(req.method || 'GET').toUpperCase() !== 'POST') {
          const records = new Map(readIndex().map((record) => [record.id, record]))
        const chains = listChains()
          .filter((chain) => chain.status === 'draft')
          .map((summary) => {
            const chain = readChain(summary.id)
            return chain ? {
              ...chain,
              paperTitle: records.get(chain.claim?.paperId)?.title || '',
            } : null
          })
          .filter(Boolean)
          json(res, 200, { ok: true, chains, count: chains.length })
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

