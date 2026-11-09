    /* ---------------- 个人工作台（v0.3.0：卡片 + 三栏研究视图） ---------------- */
    function spacer() { return h('span', { className: 'litkb-spacer' }) }

    function ThemePage({ papers = [], tags = [], onOpenPaper, onOpenChain, onOpenDraft }) {
      const [themes, setThemes] = useState([])
      const [selectedId, setSelectedId] = useState('')
      const [detail, setDetail] = useState(null)
      const [err, setErr] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [match, setMatch] = useState(null)
      const [job, setJob] = useState(null)
      const [editing, setEditing] = useState(null)
      const [summaryDraft, setSummaryDraft] = useState('')
      const [summaryEditing, setSummaryEditing] = useState(false)
      const [selectedFacet, setSelectedFacet] = useState('')
      const [selectedChain, setSelectedChain] = useState('')
      const [confirmDelete, setConfirmDelete] = useState(false)

      const refreshList = useCallback(async () => {
        try {
          const data = await api('/api/litkb/themes')
          setThemes(data.themes || [])
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      const openTheme = useCallback(async (id) => {
        if (!id) return
        setMatch(null)
        setErr('')
        try {
          const data = await api(`/api/litkb/themes/read?id=${encodeURIComponent(id)}`)
          const list = data.chains || []
          const first = list.find((chain) => chain.status === 'confirmed') || list[0] || null
          setDetail(data)
          setSelectedId(id)
          setSummaryDraft(data.theme.summary?.text || '')
          setSummaryEditing(false)
          setSelectedFacet(first?.provenance?.facetKey || data.theme.facets[0]?.key || '')
          setSelectedChain(first?.id || '')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      const backToCards = () => {
        setSelectedId('')
        setDetail(null)
        setJob(null)
        setMatch(null)
        setSelectedFacet('')
        setSelectedChain('')
      }

      useEffect(() => { refreshList() }, [refreshList])

      useEffect(() => {
        if (!job || !['queued', 'running'].includes(job.status)) return undefined
        const timer = setTimeout(async () => {
          try {
            const data = await api(`/api/litkb/themes/jobs?id=${encodeURIComponent(job.id)}`)
            setJob(data.job)
            if (data.job.status === 'done') {
              await refreshList()
              await openTheme(selectedId)
              setNotice(`生成完成：${data.job.created} 条草稿${data.job.gaps.length ? `，${data.job.gaps.length} 条缺口` : ''}`)
            }
            if (data.job.status === 'failed') {
              setNotice('生成失败：' + (data.job.errors[0]?.message || '未知错误'))
            }
          } catch (e) {
            setErr(String(e.message || e))
          }
        }, 700)
        return () => clearTimeout(timer)
      }, [job, selectedId, refreshList, openTheme])

      const post = (path, body) => api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })

      const startNew = () => setEditing({
        title: '', description: '', tags: '',
        facets: [{ title: '', description: '', keywords: '' }],
      })

      const startEdit = () => {
        const item = detail?.theme
        if (!item) return
        setEditing({
          id: item.id,
          title: item.title,
          description: item.description,
          tags: (item.tags || []).join('，'),
          facets: item.facets.map((facet) => ({
            key: facet.key,
            title: facet.title,
            description: facet.description,
            keywords: (facet.keywords || []).join('，'),
            mode: facet.mode,
            enabled: facet.enabled,
          })),
        })
      }

      const patchFacet = (index, patch) => {
        setEditing((current) => {
          if (!current) return current
          const facets = current.facets.map((facet, i) => (i === index ? { ...facet, ...patch } : facet))
          return { ...current, facets }
        })
      }

      const saveEditing = async () => {
        if (!editing || busy) return
        if (!String(editing.title || '').trim()) { setErr('研究标题不能为空'); return }
        setBusy('save')
        setErr('')
        try {
          const facets = editing.facets
            .filter((facet) => String(facet.title || '').trim())
            .map((facet) => ({
              key: facet.key || undefined,
              title: facet.title,
              description: facet.description,
              keywords: String(facet.keywords || '').split(/[,，;；、\s]+/).filter(Boolean),
              mode: facet.mode === 'verify' ? 'verify' : 'compare',
              enabled: facet.enabled !== false,
            }))
          const data = await post('/api/litkb/themes/save', {
            id: editing.id,
            title: editing.title,
            description: editing.description,
            tags: String(editing.tags || '').split(/[,，;；、]+/).map((tag) => tag.trim()).filter(Boolean),
            facets,
          })
          setEditing(null)
          await refreshList()
          await openTheme(data.theme.id)
          setNotice('已保存')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const suggestFacets = async () => {
        if (!editing) return
        try {
          const data = await post('/api/litkb/themes/suggest', { title: editing.title })
          setEditing({
            ...editing,
            facets: data.facets.map((facet) => ({
              key: facet.key, title: facet.title, description: facet.description,
              keywords: (facet.keywords || []).join('，'), mode: facet.mode, enabled: facet.enabled,
            })),
          })
          setNotice(data.source === 'template' ? '已填入模板，可继续修改' : 'AI 已拆分，可继续修改')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const runMatch = async () => {
        if (!selectedId || busy) return
        setBusy('match')
        setErr('')
        try {
          const data = await post('/api/litkb/themes/match', { id: selectedId })
          setMatch(data)
          setNotice(`匹配到 ${data.papers.length} 篇论文`)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const runChain = async (facetKeys) => {
        if (!selectedId || busy) return
        setBusy('chain')
        setErr('')
        try {
          const data = await post('/api/litkb/themes/chain', { id: selectedId, facetKeys: facetKeys || [] })
          setJob(data.job)
          setNotice('已开始生成草稿…')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const setPaper = async (paperId, action) => {
        try {
          const data = await post('/api/litkb/themes/papers', { id: selectedId, paperId, action })
          setDetail((current) => (current ? { ...current, theme: data.theme, papers: data.papers, stats: data.stats } : current))
          refreshList()
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const makeOutline = async () => {
        if (busy) return
        setBusy('outline')
        setErr('')
        try {
          const mode = detail?.draft ? 'append' : 'new'
          const data = await post('/api/litkb/themes/outline', { id: selectedId, mode })
          if (data.draft) {
            await openTheme(selectedId)
            setNotice('提纲已写入文稿；点「去写作」编辑')
          } else {
            setNotice(data.warnings[0] || '已生成提纲')
          }
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const reviewChain = async (chain, action) => {
        try {
          await post('/api/litkb/chains/review', { id: chain.id, action })
          await openTheme(selectedId)
          setSelectedChain(chain.id)
          await refreshList()
          setNotice(action === 'accept' ? '已确认，进入检索与图谱' : '已拒绝并删除草稿')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const insertChain = async (chain) => {
        try {
          const data = await post('/api/litkb/chains/insert', {
            id: chain.id, append: true, draftId: detail?.theme?.draftId || '',
          })
          const draftId = data.draft?.id || ''
          setNotice('已插入文稿')
          if (onOpenDraft) onOpenDraft({ themeId: selectedId, draftId })
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const generateSummary = async () => {
        try {
          const data = await post('/api/litkb/themes/summary', { id: selectedId })
          setSummaryDraft(data.summary.text || '')
          setSummaryEditing(true)
          setNotice(data.summary.text ? '已生成，可修改后保存' : '还没有已确认的链，先审核')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const saveSummary = async () => {
        try {
          const data = await post('/api/litkb/themes/summary', { id: selectedId, text: summaryDraft })
          setDetail((current) => (current ? { ...current, theme: { ...current.theme, summary: data.summary } } : current))
          setSummaryEditing(false)
          setNotice('结论已保存')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const removeTheme = async () => {
        try {
          const data = await post('/api/litkb/themes/delete', { id: selectedId })
          setConfirmDelete(false)
          backToCards()
          await refreshList()
          setNotice(data.chainsKept ? `已删除研究；${data.chainsKept} 条关联链保留` : '已删除研究')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const theme = detail?.theme || null
      const stats = detail?.stats || {}
      const papersInTheme = detail?.papers || []
      const chains = detail?.chains || []
      const facets = theme?.facets || []
      const chainById = new Map(chains.map((chain) => [chain.id, chain]))
      const groupChains = (facetKey) => chains.filter((chain) => (chain.provenance?.facetKey || '') === facetKey)
      const statusOfFacet = (facetKey) => {
        const list = groupChains(facetKey)
        if (list.some((chain) => chain.status === 'confirmed')) return { label: '已确认', tone: 'is-ok' }
        if (list.length) return { label: '草稿', tone: 'is-warn' }
        return { label: '未建链', tone: 'is-muted' }
      }
      const previewFor = (facetKey) => (match?.results || []).find((row) => row.facetKey === facetKey)
      const activeChain = chainById.get(selectedChain)
        || groupChains(selectedFacet)[0]
        || (selectedFacet ? null : chains[0])
        || null
      const visibleFacets = selectedFacet
        ? facets.filter((facet) => facet.key === selectedFacet)
        : facets

      const modal = editing ? h('div', { className: 'litkb-themeModalWrap', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'litkb-themeModal' },
          h('div', { className: 'litkb-themeModalHead' },
            h('span', { className: 'litkb-themeModalTitle' }, editing.id ? '编辑研究' : '新建研究'),
            h('button', { type: 'button', className: 'litkb-close', onClick: () => setEditing(null), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'litkb-themeModalBody' },
            h('label', { className: 'litkb-themeField' }, h('span', null, '研究标题'),
              h('input', {
                className: 'litkb-input', value: editing.title, placeholder: '例如：多模态大模型在医学影像诊断中的应用',
                onChange: (e) => setEditing({ ...editing, title: e.target.value }),
              })),
            h('label', { className: 'litkb-themeField' }, h('span', null, '描述（可选）'),
              h('textarea', {
                className: 'litkb-textarea', rows: 2, value: editing.description,
                placeholder: '用于哪一章、关注什么',
                onChange: (e) => setEditing({ ...editing, description: e.target.value }),
              })),
            h('label', { className: 'litkb-themeField' }, h('span', null, '绑定标签（可选，逗号分隔）'),
              h('input', {
                className: 'litkb-input', value: editing.tags, placeholder: '医学影像，多模态',
                onChange: (e) => setEditing({ ...editing, tags: e.target.value }),
              })),
            h('div', { className: 'litkb-themeFacetEdit' },
              h('div', { className: 'litkb-themeFacetEditHead' },
                h('span', null, '细分描述'),
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: suggestFacets }, 'AI 帮我拆')),
              editing.facets.map((facet, index) => h('div', { key: index, className: 'litkb-themeFacetRow' },
                h('input', {
                  className: 'litkb-input', value: facet.title, placeholder: `细分描述 ${index + 1}`,
                  onChange: (e) => patchFacet(index, { title: e.target.value }),
                }),
                h('input', {
                  className: 'litkb-input', value: facet.description, placeholder: '具体要论证什么（可选）',
                  onChange: (e) => patchFacet(index, { description: e.target.value }),
                }),
                h('input', {
                  className: 'litkb-input', value: facet.keywords, placeholder: '关键词（逗号分隔，可空）',
                  onChange: (e) => patchFacet(index, { keywords: e.target.value }),
                }),
                h('button', {
                  type: 'button', className: 'litkb-miniBtn', title: '删除这条',
                  onClick: () => setEditing({ ...editing, facets: editing.facets.filter((_, i) => i !== index) }),
                }, '删除')))),
            h('button', {
              type: 'button', className: 'litkb-btnGhost',
              onClick: () => setEditing({ ...editing, facets: [...editing.facets, { title: '', description: '', keywords: '' }] }),
            }, '＋ 加一条细分描述')),
          h('div', { className: 'litkb-themeModalFoot' },
            h('button', { type: 'button', className: 'litkb-btn', disabled: busy === 'save', onClick: saveEditing },
              busy === 'save' ? '保存中…' : '保存'),
            h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => setEditing(null) }, '取消'))))
        : null

      if (!theme) {
        return h('div', { className: 'litkb-wbPage' },
          h('div', { className: 'litkb-wbHead' },
            h('div', null,
              h('div', { className: 'litkb-wbTitle' }, '个人工作台'),
              h('div', { className: 'litkb-wbSub' }, '每个研究是一张卡片；点进去看研究总览、证据链与链详情。')),
            h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          err ? h('div', { className: 'litkb-error' }, err) : null,
          notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
          themes.length
            ? h('div', { className: 'litkb-themeCards' }, themes.map((item) => {
                const total = item.stats.facets || 0
                const done = item.stats.confirmed || 0
                const percent = total ? Math.round((done / total) * 100) : 0
                return h('button', {
                  key: item.id, type: 'button', className: 'litkb-themeCard',
                  onClick: () => openTheme(item.id),
                },
                  h('span', { className: 'litkb-themeCardTitle' }, item.title),
                  (item.tags || []).length
                    ? h('span', { className: 'litkb-chips' }, item.tags.map((tag) => h('span', { key: tag, className: 'litkb-chip' }, tag)))
                    : null,
                  h('span', { className: 'litkb-themeCardStats' },
                    `${item.stats.papers} 篇论文 · ${done}/${total} 条链 · ${item.stats.gaps} 缺口`),
                  h('span', { className: 'litkb-themeCardBar' },
                    h('span', { className: 'litkb-themeCardBarFill', style: { width: `${percent}%` } })),
                  h('span', { className: 'litkb-themeCardFoot' },
                    h('span', null, item.draftId ? '已有文稿' : '未开始写作'),
                    h('span', null, String(item.updatedAt || '').slice(0, 10))))
              }))
            : h('div', { className: 'litkb-themeEmpty' },
                h('div', { className: 'litkb-themeEmptyTitle' }, '还没有研究'),
                h('div', { className: 'litkb-themeEmptyText' },
                  '新建一个研究：写标题和 3–6 条细分描述，系统会去论文库里找匹配证据。'),
                h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          modal)
      }

      const leftPane = h('div', { className: 'litkb-wbPane litkb-wbLeft' },
        h('div', { className: 'litkb-wbPaneHead' },
          h('span', { className: 'litkb-wbPaneTitle' }, '研究总览'),
          h('span', { className: 'litkb-themeHint' }, `${stats.papers || 0} 篇 · ${stats.confirmed || 0} 已确认`)),
        theme.description ? h('div', { className: 'litkb-wbDesc' }, theme.description) : null,
        h('div', { className: 'litkb-wbActions' },
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'match', onClick: runMatch },
            busy === 'match' ? '匹配中…' : '匹配预览'),
          h('button', {
            type: 'button', className: 'litkb-miniBtn',
            disabled: busy === 'chain' || Boolean(job && ['queued', 'running'].includes(job.status)),
            onClick: () => runChain([]),
          }, '全部生成草稿')),
        job && ['queued', 'running'].includes(job.status)
          ? h('div', { className: 'litkb-themeHint' }, `任务 ${job.done}/${job.total} · ${job.step}`)
          : null,
        h('div', { className: 'litkb-wbGroupTitle' }, '细分描述'),
        h('div', { className: 'litkb-wbFacets' },
          facets.map((facet) => {
            const status = statusOfFacet(facet.key)
            const preview = previewFor(facet.key)
            const count = groupChains(facet.key).length
            return h('button', {
              key: facet.key, type: 'button',
              className: 'litkb-wbFacet' + (facet.key === selectedFacet ? ' is-on' : ''),
              onClick: () => { setSelectedFacet(facet.key); setSelectedChain(groupChains(facet.key)[0]?.id || '') },
            },
              h('span', { className: 'litkb-wbFacetTop' },
                h('span', { className: 'litkb-wbFacetTitle' }, facet.title),
                h('span', { className: 'litkb-badge ' + status.tone }, status.label)),
              h('span', { className: 'litkb-wbFacetMeta' },
                preview ? `${preview.hits.length} 条命中 · ` : '',
                count ? `${count} 条链` : '未建链'))
          })),
        h('div', { className: 'litkb-wbGroupTitle' }, `论文 ${papersInTheme.length}`),
        h('div', { className: 'litkb-wbPapers' },
          papersInTheme.slice(0, 8).map((row) => h('div', { key: row.paperId, className: 'litkb-wbPaperRow' },
            h('button', {
              type: 'button', className: 'litkb-wbPaper', title: row.title,
              onClick: () => onOpenPaper && onOpenPaper(row.paperId),
            },
              h('span', { className: 'litkb-wbPaperTitle' }, row.title),
              h('span', { className: 'litkb-wbPaperMeta' }, `${row.year || ''} · ${row.chainCount || 0} 链`)),
            h('button', {
              type: 'button', className: 'litkb-wbPaperDel', title: '移出这篇论文',
              onClick: () => setPaper(row.paperId, 'exclude'),
            }, '×'))),
        h('select', {
          className: 'litkb-input litkb-wbAddPaper', value: '',
          onChange: (e) => { if (e.target.value) setPaper(e.target.value, 'include') },
        },
          h('option', { value: '' }, '手动加入论文…'),
          papers.filter((paper) => !papersInTheme.some((row) => row.paperId === paper.id))
            .map((paper) => h('option', { key: paper.id, value: paper.id }, paper.title || paper.id)))),
        h('div', { className: 'litkb-wbGroupTitle' }, '综合结论'),
        summaryEditing
          ? h('div', { className: 'litkb-wbSummaryEdit' },
              h('textarea', {
                className: 'litkb-textarea', rows: 4, value: summaryDraft,
                onChange: (e) => setSummaryDraft(e.target.value),
              }),
              h('div', { className: 'litkb-wbActions' },
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: saveSummary }, '保存')))
          : h('div', { className: 'litkb-wbSummary' }, theme.summary?.text || '还没有结论。先确认链，再点「生成」。'),
        h('div', { className: 'litkb-wbActions' },
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: generateSummary }, '生成结论'),
          summaryEditing
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSummaryEditing(false) }, '取消编辑')
            : h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSummaryEditing(true) }, '编辑结论')))

      const middlePane = h('div', { className: 'litkb-wbPane litkb-wbMid' },
        h('div', { className: 'litkb-wbPaneHead' },
          h('span', { className: 'litkb-wbPaneTitle' }, '证据链'),
          h('span', { className: 'litkb-themeHint' }, `${chains.length} 条`),
          spacer(),
          selectedFacet
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => { setSelectedFacet(''); setSelectedChain('') } }, '看全部')
            : null),
        visibleFacets.map((facet) => {
          const list = groupChains(facet.key)
          return h('div', { key: facet.key, className: 'litkb-wbChainGroup' },
            h('div', { className: 'litkb-wbChainGroupHead' },
              h('span', { className: 'litkb-wbChainGroupTitle' }, facet.title),
              h('span', { className: 'litkb-badge ' + statusOfFacet(facet.key).tone }, statusOfFacet(facet.key).label)),
            list.length
              ? list.map((chain) => h('button', {
                  key: chain.id, type: 'button',
                  className: 'litkb-wbChain' + (chain.id === activeChain?.id ? ' is-on' : ''),
                  onClick: () => { setSelectedChain(chain.id); setSelectedFacet(facet.key) },
                },
                h('span', { className: 'litkb-wbChainClaim' }, chain.claim?.text || chain.title || ''),
                h('span', { className: 'litkb-wbChainMeta' },
                  `${(chain.nodes || []).length} 条证据 · 置信度 ${chain.confidence}`)))
              : h('div', { className: 'litkb-wbEmpty is-inline' }, '还没有链。点左侧「全部生成草稿」。'))
        }),
        chains.filter((chain) => !chain.provenance?.facetKey).length
          ? h('div', { className: 'litkb-wbChainGroup' },
              h('div', { className: 'litkb-wbChainGroupHead' }, h('span', { className: 'litkb-wbChainGroupTitle' }, '其他链')),
              chains.filter((chain) => !chain.provenance?.facetKey).map((chain) => h('button', {
                key: chain.id, type: 'button',
                className: 'litkb-wbChain' + (chain.id === activeChain?.id ? ' is-on' : ''),
                onClick: () => { setSelectedChain(chain.id); setSelectedFacet('') },
              },
              h('span', { className: 'litkb-wbChainClaim' }, chain.claim?.text || chain.title || ''),
              h('span', { className: 'litkb-wbChainMeta' }, `${(chain.nodes || []).length} 条证据`))))
          : null,
        !chains.length
          ? h('div', { className: 'litkb-wbEmpty' },
              h('div', { className: 'litkb-themeEmptyText' }, '还没有证据链。点左侧「全部生成草稿」，或先做一次匹配预览。'))
          : null)

      const rightPane = h('div', { className: 'litkb-wbPane litkb-wbRight' },
        h('div', { className: 'litkb-wbPaneHead' },
          h('span', { className: 'litkb-wbPaneTitle' }, '链详情'),
          activeChain
            ? h('span', { className: 'litkb-badge ' + (activeChain.status === 'confirmed' ? 'is-ok' : 'is-warn') },
                activeChain.status === 'confirmed' ? '已确认' : '草稿')
            : null,
          spacer(),
          activeChain && onOpenChain
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain(activeChain.id) }, '完整编辑')
            : null),
        activeChain
          ? h('div', { className: 'litkb-wbDetail' },
              h('div', { className: 'litkb-wbClaim' }, activeChain.claim?.text || activeChain.title || ''),
              h('div', { className: 'litkb-wbDetailMeta' },
                `${(activeChain.nodes || []).length} 条证据 · 置信度 ${activeChain.confidence}`,
                activeChain.provenance?.matcher ? ` · ${activeChain.provenance.matcher}` : ''),
              (activeChain.warnings || []).length
                ? h('div', { className: 'litkb-wbWarn' }, activeChain.warnings.join('；'))
                : null,
              h('div', { className: 'litkb-wbNodes' },
                (activeChain.nodes || []).map((node) => h('button', {
                  key: node.evidenceId, type: 'button', className: 'litkb-wbNode',
                  onClick: () => onOpenPaper && onOpenPaper(node.paperId, node.page, node.block),
                },
                  h('span', { className: 'litkb-wbNodeTop' },
                    h('span', { className: 'litkb-wbNodeTitle' }, node.title || node.paperId),
                    h('span', { className: 'litkb-wbNodePage' }, `p.${node.page}`)),
                  h('span', { className: 'litkb-wbNodeQuote' }, String(node.quote || '').slice(0, 160))))),
              h('div', { className: 'litkb-wbActions' },
                activeChain.status === 'draft'
                  ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => reviewChain(activeChain, 'accept') }, '确认这条链')
                  : null,
                activeChain.status === 'draft'
                  ? h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => reviewChain(activeChain, 'reject') }, '拒绝')
                  : null,
                activeChain.status === 'confirmed'
                  ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => insertChain(activeChain) }, '插入写作')
                  : null))
          : h('div', { className: 'litkb-wbEmpty' },
              h('div', { className: 'litkb-themeEmptyText' }, '从中间选一条链，看它的论点、证据与操作。')))

      return h('div', { className: 'litkb-wbPage is-detail' },
        h('div', { className: 'litkb-wbDetailHead' },
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: backToCards }, '← 全部研究'),
          h('span', { className: 'litkb-wbDetailTitle' }, theme.title),
          (theme.tags || []).length
            ? h('span', { className: 'litkb-chips' }, theme.tags.map((tag) => h('span', { key: tag, className: 'litkb-chip' }, tag)))
            : null,
          spacer(),
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'outline', onClick: makeOutline },
            busy === 'outline' ? '生成中…' : '生成提纲'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenDraft && onOpenDraft({ themeId: theme.id, draftId: detail.draft?.id || '' }) }, '去写作'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: startEdit }, '编辑'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setConfirmDelete(true) }, '删除')),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
        h('div', { className: 'litkb-wbSplit' }, leftPane, middlePane, rightPane),
        confirmDelete
          ? h('div', { className: 'litkb-themeModalWrap', role: 'dialog', 'aria-modal': 'true' },
              h('div', { className: 'litkb-themeModal is-small' },
                h('div', { className: 'litkb-themeModalHead' }, h('span', { className: 'litkb-themeModalTitle' }, '删除研究？')),
                h('div', { className: 'litkb-themeModalBody' },
                  h('div', { className: 'litkb-themeHint' }, '研究本身会被删除；已生成的证据链和文稿保留。')),
                h('div', { className: 'litkb-themeModalFoot' },
                  h('button', { type: 'button', className: 'litkb-btn', onClick: removeTheme }, '删除'),
                  h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => setConfirmDelete(false) }, '取消'))))
          : null,
        modal)
    }
