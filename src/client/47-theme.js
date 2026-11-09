    /* ---------------- 个人工作台（v0.2.5：总览 + 三视图） ---------------- */
    function spacer() { return h('span', { className: 'litkb-spacer' }) }

    function ThemePage({ papers = [], tags = [], paperActions = {}, onOpenPaper, onOpenChain, onOpenDraft }) {
      const [themes, setThemes] = useState([])
      const [selectedId, setSelectedId] = useState('')
      const [detail, setDetail] = useState(null)
      const [err, setErr] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [job, setJob] = useState(null)
      const [editing, setEditing] = useState(null)
      const [summaryDraft, setSummaryDraft] = useState('')
      const [summaryEditing, setSummaryEditing] = useState(false)
      const [selectedChain, setSelectedChain] = useState('')
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [deepreadPaper, setDeepreadPaper] = useState(null)
      const [section, setSection] = useState('papers')
      const [paperId, setPaperId] = useState('')
      const [paperQuery, setPaperQuery] = useState('')
      const [chainFilter, setChainFilter] = useState('all')

      const refreshList = useCallback(async () => {
        try {
          const data = await api('/api/litkb/themes')
          setThemes(data.themes || [])
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      const openTheme = useCallback(async (id, keepView = false) => {
        if (!id) return
        setErr('')
        try {
          const data = await api(`/api/litkb/themes/read?id=${encodeURIComponent(id)}`)
          const list = data.chains || []
          const first = list.find((chain) => chain.status === 'confirmed') || list[0] || null
          setDetail(data)
          setSelectedId(id)
          setSummaryDraft(data.theme.summary?.text || '')
          setSummaryEditing(false)
          setSelectedChain(first?.id || '')
          setSection((current) => (keepView ? current : 'papers'))
          setPaperId((current) => (keepView && current ? current : (data.papers?.[0]?.paperId || '')))
          if (!keepView) setDeepreadPaper(null)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      const backToCards = () => {
        setSelectedId('')
        setDetail(null)
        setJob(null)
        setSelectedChain('')
        setSection('papers')
        setPaperId('')
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
              await openTheme(selectedId, true)
              setNotice(`探索完成：${data.job.created} 条证据链${data.job.gaps.length ? `，${data.job.gaps.length} 条缺口` : ''}`)
            }
            if (data.job.status === 'failed') {
              setNotice('探索失败：' + (data.job.errors[0]?.message || '未知错误'))
            }
          } catch (e) {
            setErr(String(e.message || e))
          }
        }, 700)
        return () => clearTimeout(timer)
      }, [job, selectedId, refreshList, openTheme])

      useEffect(() => {
        if (chainFilter === 'all') return
        const list = (detail?.chains || []).filter((chain) => chain.status === chainFilter)
        if (list.length && !list.some((chain) => chain.id === selectedChain)) setSelectedChain(list[0].id)
      }, [chainFilter, detail, selectedChain])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (deepreadPaper) setDeepreadPaper(null)
          else if (editing) setEditing(null)
          else if (confirmDelete) setConfirmDelete(false)
          else if (selectedChain) setSelectedChain('')
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [deepreadPaper, editing, confirmDelete, selectedChain])

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

      const runExplore = async () => {
        if (!selectedId || busy) return
        setBusy('explore')
        setErr('')
        try {
          const data = await post('/api/litkb/themes/explore', { id: selectedId })
          setJob(data.job)
          setNotice(`探索中：匹配 ${data.match.papers.length} 篇论文，正在建链…`)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const setPaper = async (pid, action) => {
        try {
          const data = await post('/api/litkb/themes/papers', { id: selectedId, paperId: pid, action })
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
            setSection('summary')
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
          setSection('chains')
          setSelectedChain(action === 'accept' ? chain.id : '')
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
      const visibleChains = chainFilter === 'all' ? chains : chains.filter((chain) => chain.status === chainFilter)
      const facetChainsAll = (facetKey) => chains.filter((chain) => (chain.provenance?.facetKey || '') === facetKey)
      const groupChains = (facetKey) => visibleChains.filter((chain) => (chain.provenance?.facetKey || '') === facetKey)
      const statusOfFacet = (facetKey) => {
        const list = facetChainsAll(facetKey)
        if (list.some((chain) => chain.status === 'confirmed')) return { label: '✓ 已确认', tone: 'is-ok' }
        if (list.length) return { label: '草稿', tone: 'is-warn' }
        return { label: '! 缺口', tone: 'is-danger' }
      }
      const confirmedChains = chains.filter((chain) => chain.status === 'confirmed')
      const progress = facets.length ? Math.round(((stats.confirmed || 0) / facets.length) * 100) : 0
      const needle = paperQuery.trim().toLowerCase()
      const activeChain = chainById.get(selectedChain) || confirmedChains[0] || chains[0] || null
      const recordOf = (pid) => papers.find((paper) => paper.id === pid) || { id: pid, title: pid, authors: '', year: '' }
      const openDeepRead = (pid) => setDeepreadPaper(recordOf(pid))
      const running = Boolean(job && ['queued', 'running'].includes(job.status))
      const facetTitle = (key) => (facets.find((facet) => facet.key === key)?.title) || ''

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
              h('div', { className: 'litkb-wbTitle' }, '我的研究'),
              h('div', { className: 'litkb-wbSub' },
                `${themes.length} 个研究 · ${themes.reduce((n, item) => n + item.stats.papers, 0)} 篇论文 · ${themes.reduce((n, item) => n + item.stats.confirmed, 0)} 条已确认链${themes.reduce((n, item) => n + item.stats.gaps, 0) ? ` · ${themes.reduce((n, item) => n + item.stats.gaps, 0)} 个缺口` : ''}`)),
            h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          err ? h('div', { className: 'litkb-error' }, err) : null,
          notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
          themes.length
            ? h('div', { className: 'litkb-themeCards' }, themes.map((item) => {
                const total = item.stats.facets || 0
                const done = item.stats.confirmed || 0
                const percent = total ? Math.round((done / total) * 100) : 0
                const tone = item.stats.gaps ? 'is-warn' : (total && done === total ? 'is-ok' : 'is-muted')
                const stateLabel = item.stats.gaps ? `⚠ ${item.stats.gaps} 个缺口` : (total && done === total ? '✓ 已确认完' : '进行中')
                return h('button', {
                  key: item.id, type: 'button', className: 'litkb-themeCard',
                  onClick: () => openTheme(item.id),
                },
                  h('span', { className: 'litkb-themeCardTop' },
                    h('span', { className: 'litkb-themeCardTitle' }, item.title),
                    h('span', { className: 'litkb-badge ' + tone }, stateLabel)),
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
                  '新建一个研究：写标题和 3–6 条细分描述，点「开始探索」自动匹配论文、建立证据链。'),
                h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          modal)
      }

      const overview = h('div', { className: 'litkb-wbOverview' },
        h('div', { className: 'litkb-wbOverviewHead' },
          h('span', { className: 'litkb-wbOverviewTitle' }, '研究总览'),
          h('span', { className: 'litkb-wbOverviewStats' },
            `论文 ${stats.papers || 0} · 已确认 ${stats.confirmed || 0}/${stats.facets || 0} · 草稿 ${stats.drafts || 0} · 缺口 ${stats.gaps || 0}`),
          spacer(),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: startEdit }, '编辑'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setConfirmDelete(true) }, '删除')),
        theme.description ? h('div', { className: 'litkb-wbDesc' }, theme.description) : null,
        h('div', { className: 'litkb-wbOverviewFacets' },
          facets.map((facet) => {
            const state = statusOfFacet(facet.key)
            return h('button', {
              key: facet.key, type: 'button',
              className: 'litkb-chip ' + state.tone + (facet.enabled ? '' : ' is-off'),
              title: facet.description || facet.title,
              onClick: () => {
                setSection('chains')
                const first = facetChainsAll(facet.key)[0]
                if (first) setSelectedChain(first.id)
              },
            }, facet.title)
          })),
        h('div', { className: 'litkb-wbDonut', title: `完成度 ${progress}%` },
          h('svg', { width: 66, height: 66, viewBox: '0 0 66 66', 'aria-hidden': 'true' },
            h('circle', { cx: 33, cy: 33, r: 27, fill: 'none', stroke: 'var(--litkb-fill-2)', strokeWidth: 7 }),
            h('circle', {
              cx: 33, cy: 33, r: 27, fill: 'none', stroke: 'var(--litkb-accent)', strokeWidth: 7,
              strokeLinecap: 'round', transform: 'rotate(-90 33 33)',
              strokeDasharray: `${Math.round((progress / 100) * 169.6 * 10) / 10} 169.6`,
            })),
          h('span', { className: 'litkb-wbDonutText' }, `${progress}%`),
          h('span', { className: 'litkb-wbDonutLabel' }, '完成度')))

      const seg = h('div', { className: 'litkb-wbSeg', role: 'tablist' },
        [['papers', `▤ 参考论文 ${papersInTheme.length}`], ['chains', `☷ 证据链 ${chains.length}`], ['summary', '✎ 研究结论']]
          .map(([key, label]) => h('button', {
            key, type: 'button', role: 'tab', 'aria-selected': section === key,
            className: 'litkb-wbSegBtn' + (section === key ? ' is-on' : ''),
            onClick: () => setSection(key),
          }, label)))

      const filteredPapers = papersInTheme
        .map((row) => ({ row, paper: papers.find((paper) => paper.id === row.paperId) }))
        .filter((item) => item.paper)
        .filter((item) => !needle || String(item.paper.title || '').toLowerCase().includes(needle))
      const activePaper = filteredPapers.find((item) => item.paper.id === paperId)?.paper
        || filteredPapers[0]?.paper
        || null
      const scoreOf = (pid) => papersInTheme.find((row) => row.paperId === pid)?.score || 0

      const papersView = h('div', { className: 'litkb-rp' },
        h('div', { className: 'litkb-rpList' },
          h('div', { className: 'litkb-rpHead' },
            h('span', { className: 'litkb-rpHeadTitle' }, `本研究论文 ${filteredPapers.length}`),
            h('span', { className: 'litkb-exHint' }, '只含匹配到的论文')),
          h('input', {
            className: 'litkb-input litkb-rpSearch', type: 'search', value: paperQuery,
            placeholder: '在本研究论文里搜…', 'aria-label': '搜索本研究论文',
            onChange: (e) => setPaperQuery(e.target.value),
          }),
          h('div', { className: 'litkb-rpItems' },
            filteredPapers.map((item) => h('div', {
              key: item.paper.id,
              className: 'litkb-rpItem' + (item.paper.id === activePaper?.id ? ' is-on' : ''),
            },
              h('button', {
                type: 'button', className: 'litkb-rpMain', title: item.paper.title,
                onClick: () => setPaperId(item.paper.id),
              },
                h('span', { className: 'litkb-rpTitle' }, item.paper.title),
                h('span', { className: 'litkb-rpMeta' },
                  [item.paper.year, item.paper.venue].filter(Boolean).join(' · ') || '元数据缺失',
                  ` · 匹配 ${scoreOf(item.paper.id) || '—'}`)),
              h('button', {
                type: 'button', className: 'litkb-rpDel', title: '从本研究中移出',
                onClick: () => setPaper(item.paper.id, 'exclude'),
              }, '×')))),
          h('select', {
            className: 'litkb-input litkb-rpAdd', value: '',
            onChange: (e) => { if (e.target.value) setPaper(e.target.value, 'include') },
          },
            h('option', { value: '' }, '手动加入论文…'),
            papers.filter((paper) => !papersInTheme.some((row) => row.paperId === paper.id))
              .map((paper) => h('option', { key: paper.id, value: paper.id }, paper.title || paper.id)))),
        h('div', { className: 'litkb-rpDetail' },
          activePaper
            ? h(Detail, {
                key: activePaper.id,
                paper: activePaper,
                tags: paperActions.tags || tags,
                types: paperActions.types || [],
                inline: true,
                initialView: 'deep',
                onClose: () => {},
                onSaved: paperActions.onSaved,
                onRefresh: paperActions.refresh,
                onOpenPdf: (page, blockId) => paperActions.onOpenPdf
                  ? paperActions.onOpenPdf(activePaper.id, page, blockId)
                  : onOpenPaper && onOpenPaper(activePaper.id, page, blockId),
                onCite: paperActions.onCite,
                onBuildChain: paperActions.onBuildChain,
                cardRevision: paperActions.cardRevision || 0,
              })
            : h('div', { className: 'litkb-exEmpty' },
                papersInTheme.length ? '没有匹配关键词的论文。清空搜索试试。' : '还没有匹配到论文。点右上角「开始探索」。')))

      const chainDetail = (chain) => h('div', { className: 'litkb-cd' },
        h('div', { className: 'litkb-cdTop' },
          h('span', { className: 'litkb-badge ' + (chain.status === 'confirmed' ? 'is-ok' : 'is-warn') },
            chain.status === 'confirmed' ? '已确认' : '草稿'),
          facetTitle(chain.provenance?.facetKey)
            ? h('span', { className: 'litkb-cdFacet' }, facetTitle(chain.provenance.facetKey))
            : null,
          spacer(),
          onOpenChain
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain(chain.id) }, '完整编辑')
            : null),
        h('div', { className: 'litkb-wbClaim' }, chain.claim?.text || chain.title || ''),
        h('div', { className: 'litkb-wbDetailMeta' },
          `${(chain.nodes || []).length} 条证据 · 置信度 ${chain.confidence}`,
          chain.provenance?.matcher ? ` · ${chain.provenance.matcher}` : ''),
        (chain.warnings || []).length
          ? h('div', { className: 'litkb-wbWarn' }, chain.warnings.join('；'))
          : null,
        h('div', { className: 'litkb-exNodes' },
          (chain.nodes || []).map((node) => h('div', { key: node.evidenceId, className: 'litkb-exNode' },
            h('div', { className: 'litkb-exNodeTop' },
              h('span', { className: 'litkb-exNodeTitle' }, node.title || node.paperId),
              h('span', { className: 'litkb-exNodePage' }, `p.${node.page}`)),
            h('div', { className: 'litkb-exNodeQuote' }, String(node.quote || '').slice(0, 200)),
            h('div', { className: 'litkb-exNodeOps' },
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => openDeepRead(node.paperId) }, '精读'),
              h('button', {
                type: 'button', className: 'litkb-miniBtn',
                onClick: () => onOpenPaper && onOpenPaper(node.paperId, node.page, node.block),
              }, '原文'))))),
        h('div', { className: 'litkb-wbActions' },
          chain.status === 'draft'
            ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => reviewChain(chain, 'accept') }, '确认这条链')
            : null,
          chain.status === 'draft'
            ? h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => reviewChain(chain, 'reject') }, '拒绝')
            : null,
          chain.status === 'confirmed'
            ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => insertChain(chain) }, '插入写作')
            : null))

      const chainsView = h('div', { className: 'litkb-cols' },
        h('div', { className: 'litkb-col is-narrow' },
          h('div', { className: 'litkb-colHead' },
            h('span', { className: 'litkb-colTitle' }, '证据链'),
            spacer(),
            [['all', `全部 ${chains.length}`], ['draft', `草稿 ${stats.drafts || 0}`], ['confirmed', `已确认 ${stats.confirmed || 0}`]].map(([key, label]) => h('button', {
              key, type: 'button',
              className: 'litkb-miniBtn' + (chainFilter === key ? ' is-on' : ''),
              onClick: () => setChainFilter(key),
            }, label))),
          facets.map((facet) => {
            const list = groupChains(facet.key)
            const status = statusOfFacet(facet.key)
            return h('div', { key: facet.key, className: 'litkb-exGroup' },
              h('div', { className: 'litkb-exGroupHead' },
                h('span', { className: 'litkb-exGroupTitle' }, facet.title),
                h('span', { className: 'litkb-badge ' + status.tone }, status.label)),
              list.length
                ? list.map((chain) => h('button', {
                    key: chain.id, type: 'button',
                    className: 'litkb-exChain is-' + chain.status + (activeChain?.id === chain.id ? ' is-on' : ''),
                    title: chain.claim?.text || chain.title || '',
                    onClick: () => setSelectedChain(chain.id),
                  },
                  h('span', { className: 'litkb-exChainClaim' }, chain.claim?.text || chain.title || ''),
                  h('span', { className: 'litkb-exChainMeta' },
                    `${(chain.nodes || []).length} 条证据 · 置信度 ${chain.confidence}`)))
                : h('div', { className: 'litkb-exGap' }, '未匹配到证据'))
          }),
          !chains.length
            ? h('div', { className: 'litkb-exEmpty' },
                h('span', null, '还没有证据链。'),
                h('button', { type: 'button', className: 'litkb-miniBtn', disabled: running, onClick: runExplore }, '▶ 开始探索'))
            : (visibleChains.length ? null : h('div', { className: 'litkb-exEmpty' }, '当前筛选下没有链。'))),
        h('div', { className: 'litkb-col' },
          activeChain
            ? chainDetail(activeChain)
            : h('div', { className: 'litkb-exEmpty' }, '从左边选一条链，看它的论点与证据。')))

      const summaryView = h('div', { className: 'litkb-cols' },
        h('div', { className: 'litkb-col' },
          h('div', { className: 'litkb-colHead' },
            h('span', { className: 'litkb-colTitle' }, '研究结论'),
            spacer(),
            h('button', { type: 'button', className: 'litkb-miniBtn', onClick: generateSummary }, '生成'),
            summaryEditing
              ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: saveSummary }, '保存')
              : h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSummaryEditing(true) }, '编辑')),
          summaryEditing
            ? h('textarea', {
                className: 'litkb-textarea', rows: 10, value: summaryDraft,
                placeholder: '点「生成」汇总已确认链，或直接写',
                onChange: (e) => setSummaryDraft(e.target.value),
              })
            : h('div', { className: 'litkb-cdSummary' }, theme.summary?.text || '还没有结论。确认几条链后，点「生成」。')),
        h('div', { className: 'litkb-col' },
          h('div', { className: 'litkb-colHead' },
            h('span', { className: 'litkb-colTitle' }, '支撑结论的证据链'),
            h('span', { className: 'litkb-exHint' }, `${confirmedChains.length} 条已确认`)),
          confirmedChains.length
            ? confirmedChains.map((chain) => h('div', { key: chain.id, className: 'litkb-cdChain' },
                h('div', { className: 'litkb-cdChainTop' },
                  h('span', { className: 'litkb-cdFacet' }, facetTitle(chain.provenance?.facetKey) || '其他'),
                  spacer(),
                  h('button', {
                    type: 'button', className: 'litkb-miniBtn',
                    onClick: () => { setSection('chains'); setSelectedChain(chain.id) },
                  }, '在证据链中查看')),
                h('div', { className: 'litkb-cdChainClaim' }, chain.claim?.text || chain.title || ''),
                h('div', { className: 'litkb-wbDetailMeta' },
                  `${(chain.nodes || []).length} 条证据`,
                  chain.nodes?.length
                    ? ` · ${[...new Set(chain.nodes.map((node) => node.title || node.paperId))].slice(0, 2).join(' / ')}`
                    : '')))
            : h('div', { className: 'litkb-exEmpty' },
                h('span', null, '还没有已确认的链。'),
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSection('chains') }, '去确认链'))))

      const body = section === 'papers'
        ? papersView
        : (section === 'chains' ? chainsView : summaryView)

      const deepreadDrawer = deepreadPaper ? h('div', {
        className: 'litkb-drawerWrap',
        onMouseDown: (e) => { if (e.target === e.currentTarget) setDeepreadPaper(null) },
      },
        h('div', { className: 'litkb-drawer is-wide' },
          h('div', { className: 'litkb-drawerHead' },
            h('span', { className: 'litkb-blockTitle' }, `精读：${deepreadPaper.title || deepreadPaper.id}`),
            h('span', { className: 'litkb-spacer' }),
            h('button', { type: 'button', className: 'litkb-close', onClick: () => setDeepreadPaper(null), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'litkb-drawerBody' },
            h(DeepReadPanel, {
              key: deepreadPaper.id,
              paper: deepreadPaper,
              onOpenPdf: (page, blockId) => onOpenPaper && onOpenPaper(deepreadPaper.id, page, blockId),
            }))))
        : null

      return h('div', { className: 'litkb-wbPage is-detail' },
        h('div', { className: 'litkb-wbDetailHead' },
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: backToCards }, '← 全部研究'),
          h('span', { className: 'litkb-wbDetailTitle', title: theme.title }, theme.title),
          (theme.tags || []).length
            ? h('span', { className: 'litkb-chips' }, theme.tags.map((tag) => h('span', { key: tag, className: 'litkb-chip' }, tag)))
            : null,
          spacer(),
          h('button', { type: 'button', className: 'litkb-btn', disabled: busy === 'explore' || running, onClick: runExplore },
            running ? '探索中…' : (chains.length ? '↻ 重新探索' : '▶ 开始探索')),
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'outline', onClick: makeOutline },
            busy === 'outline' ? '生成中…' : '✎ 生成提纲'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenDraft && onOpenDraft({ themeId: theme.id, draftId: detail.draft?.id || '' }) }, '去写作')),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
        running
          ? h('div', { className: 'litkb-exProgress' }, `探索中 · 已生成 ${job.created || 0} 条 · ${job.step || ''}`)
          : null,
        overview,
        seg,
        h('div', { className: 'litkb-wbBody' }, body),
        deepreadDrawer,
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
