    /* ---------------- 个人工作台（v0.2.5：总览 + 三视图） ---------------- */
    function spacer() { return h('span', { className: 'litkb-spacer' }) }
    const MATCH_DEFAULTS = {
      minScore: 1.5, relative: 0.4, perPaper: 2, maxHits: 8, maxPapers: 6,
      keywordMode: 'require', tagMode: 'boost', yearFrom: 0, yearTo: 0, expand: true,
    }

    const RESEARCH_TEMPLATES = {
      review: {
        label: '综述',
        description: '梳理该方向的研究脉络、方法分类与趋势，形成可写的综述骨架。',
        facets: ['研究背景与问题', '主要技术路线', '代表性工作对比', '数据与评测指标', '开放挑战', '趋势与展望'],
      },
      proposal: {
        label: '开题',
        description: '围绕研究问题、现状缺口、技术路线与预期贡献组织开题材料。',
        facets: ['研究问题', '国内外现状', '现有缺口', '技术路线', '实验计划', '预期贡献'],
      },
      compare: {
        label: '方法对比',
        description: '按任务、方法、指标、结论对比不同工作，形成可比证据链。',
        facets: ['任务定义', '方法 A 的核心', '方法 B 的核心', '实验与指标差异', '适用边界与结论'],
      },
    }

    function templateFacets(names, keyword = '') {
      return names.map((title) => ({ title, description: '', keywords: keyword }))
    }

    function ThemePage({ papers = [], tags = [], paperActions = {}, paperCount = 0, guide = null, guideDismissed = false, guideForce = false, onOpenPaper, onOpenChain, onOpenDraft, onOpenLibrary, onOpenWriting, onDismissGuide, onImportPaper }) {
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
      const [matchOpen, setMatchOpen] = useState(false)
      const [matchForm, setMatchForm] = useState(null)
      const [matchDetail, setMatchDetail] = useState(null)
      const [picked, setPicked] = useState([])
      const [mergeOpen, setMergeOpen] = useState(null)
      const [showLegacy, setShowLegacy] = useState(false)
      const [showExcluded, setShowExcluded] = useState(false)
      const [analysis, setAnalysis] = useState(null)
      const [analysisJob, setAnalysisJob] = useState(null)
      const [analysisBusy, setAnalysisBusy] = useState(false)
      const [summaryBusy, setSummaryBusy] = useState('')

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
          setMatchOpen(false)
          setMatchDetail(null)
          setPicked([])
          setMergeOpen(null)
          setShowLegacy(false)
          setShowExcluded(false)
          if (!keepView) setDeepreadPaper(null)
          const analysisData = await api(`/api/litkb/themes/analysis?id=${encodeURIComponent(id)}`).catch(() => null)
          setAnalysis(analysisData?.analysis || null)
          setAnalysisJob(analysisData?.job || null)
          setAnalysisBusy(Boolean(analysisData?.job && ['queued', 'running'].includes(analysisData.job.status)))
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
        setAnalysis(null)
        setAnalysisJob(null)
        setAnalysisBusy(false)
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
        if (!analysisJob || !['queued', 'running'].includes(analysisJob.status) || !selectedId) return undefined
        const timer = setTimeout(async () => {
          try {
            const data = await api(`/api/litkb/themes/analysis?id=${encodeURIComponent(selectedId)}`)
            setAnalysis(data.analysis || null)
            setAnalysisJob(data.job || null)
            if (data.job && !['queued', 'running'].includes(data.job.status)) {
              setAnalysisBusy(false)
              await refreshList()
              setNotice(data.job.status === 'done' ? '方向分析完成' : '方向分析部分完成')
            }
          } catch (e) {
            setErr(String(e.message || e))
          }
        }, 1200)
        return () => clearTimeout(timer)
      }, [analysisJob, selectedId, refreshList])

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

      const startFromTag = (tag) => {
        const name = String(tag || '').trim()
        if (!name) return
        setEditing({
          title: `${name}研究`,
          description: `围绕标签「${name}」梳理现状、方法、数据与缺口。`,
          tags: name,
          facets: templateFacets(['研究背景与问题', '代表性方法', '数据与评测', '局限与趋势'], name),
        })
      }

      const applyTemplate = (key) => {
        const template = RESEARCH_TEMPLATES[key]
        if (!template) return
        setEditing((current) => current ? {
          ...current,
          description: String(current.description || '').trim() || template.description,
          facets: templateFacets(template.facets),
        } : current)
      }

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
          // 移出/恢复论文后，方向分析的矩阵与统计要跟着变，不能等下次进页面
          if (data.analysis !== undefined) setAnalysis(data.analysis || null)
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

      const runMatchDetail = async () => {
        if (!selectedId) return
        try {
          const data = await post('/api/litkb/themes/match', { id: selectedId })
          setMatchDetail(data)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const saveMatch = async () => {
        if (!selectedId || busy) return
        setBusy('matchsave')
        setErr('')
        try {
          await post('/api/litkb/themes/save', { id: selectedId, match: matchForm })
          setMatchOpen(false)
          await refreshList()
          await openTheme(selectedId, true)
          const data = await post('/api/litkb/themes/explore', { id: selectedId })
          setJob(data.job)
          setNotice('匹配设置已保存，正在重新探索…')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const togglePicked = (id) => {
        setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
      }

      const batchReview = async (action) => {
        if (!picked.length || busy) return
        setBusy('batch')
        setErr('')
        try {
          const data = await post('/api/litkb/chains/review/batch', { ids: picked, action })
          setPicked([])
          await openTheme(selectedId)
          await refreshList()
          setNotice(`批量${action === 'accept' ? '确认' : '拒绝'}：成功 ${data.succeeded} 条${data.failed ? `，失败 ${data.failed} 条` : ''}`)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const dedupeChains = async () => {
        if (!selectedId || busy) return
        setBusy('dedupe')
        setErr('')
        try {
          const data = await post('/api/litkb/chains/dedupe', { themeId: selectedId })
          await openTheme(selectedId)
          await refreshList()
          setNotice(`已合并 ${data.groups} 组重复链，移除 ${data.removed} 条`)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const confirmMerge = async () => {
        if (!mergeOpen?.sourceId || !mergeOpen?.targetId) return
        try {
          await post('/api/litkb/chains/review', {
            id: mergeOpen.sourceId, action: 'merge', targetId: mergeOpen.targetId,
          })
          setMergeOpen(null)
          setPicked([])
          await openTheme(selectedId)
          await refreshList()
          setNotice('已合并为一条链')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const cancelExplore = async () => {
        if (!job?.id) return
        try {
          const data = await post('/api/litkb/themes/jobs/cancel', { id: job.id })
          setJob(data.job)
          setNotice('已请求取消；已生成的草稿会保留')
        } catch (e) {
          setErr(String(e.message || e))
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
        if (summaryBusy) return
        setSummaryBusy('summary')
        try {
          const data = await post('/api/litkb/themes/summary', { id: selectedId })
          setSummaryDraft(data.summary.text || '')
          setSummaryEditing(true)
          const chars = String(data.summary.text || '').length
          setNotice(!chars
            ? '还没有已确认的链，先审核'
            : (data.summary.mode === 'model' ? `已润色为 ${chars} 字，可修改后保存` : `已生成摘要 ${chars} 字（未配置模型，未润色）`))
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSummaryBusy('')
        }
      }

      const generateReview = async () => {
        if (summaryBusy) return
        setSummaryBusy('review')
        try {
          const data = await post('/api/litkb/themes/review', { id: selectedId, mode: 'new' })
          if (!data.draft) {
            setNotice(data.warnings?.[0] || '已生成综述')
            return
          }
          setNotice(`研究综述已写入文稿：${data.draft.title}（${data.chars} 字 · ${data.citations} 条引用）`)
          await openTheme(selectedId)
          if (onOpenDraft) onOpenDraft({ themeId: selectedId, draftId: data.draft.id })
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSummaryBusy('')
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
      const summaryInfo = detail?.summaryState || null
      const confirmedGroups = new Map()
      for (const chain of chains) {
        if (chain.status !== 'confirmed') continue
        const key = chain.provenance?.facetKey || `__${chain.id}`
        confirmedGroups.set(key, (confirmedGroups.get(key) || 0) + 1)
      }
      const duplicateGroups = [...confirmedGroups.values()].filter((count) => count > 1).length
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
            !editing.id
              ? h('div', { className: 'litkb-templateRow' },
                  h('span', { className: 'litkb-muted' }, '模板'),
                  Object.entries(RESEARCH_TEMPLATES).map(([key, template]) => h('button', {
                    key, type: 'button', className: 'litkb-miniBtn',
                    onClick: () => applyTemplate(key),
                  }, template.label)))
              : null,
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
      const patchMatch = (patch) => setMatchForm((current) => ({ ...(current || MATCH_DEFAULTS), ...patch }))

      const matchModal = matchOpen && matchForm ? h('div', { className: 'litkb-themeModalWrap', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'litkb-themeModal' },
          h('div', { className: 'litkb-themeModalHead' },
            h('span', { className: 'litkb-themeModalTitle' }, '匹配设置'),
            h('button', { type: 'button', className: 'litkb-close', onClick: () => setMatchOpen(false), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'litkb-themeModalBody' },
            h('div', { className: 'litkb-matchGrid' },
              h('label', { className: 'litkb-themeField' }, h('span', null, '关键词'),
                h('select', {
                  className: 'litkb-input', value: matchForm.keywordMode,
                  onChange: (e) => patchMatch({ keywordMode: e.target.value }),
                },
                  h('option', { value: 'require' }, '必须命中'),
                  h('option', { value: 'off' }, '不强制'))),
              h('label', { className: 'litkb-themeField' }, h('span', null, '标签'),
                h('select', {
                  className: 'litkb-input', value: matchForm.tagMode,
                  onChange: (e) => patchMatch({ tagMode: e.target.value }),
                },
                  h('option', { value: 'boost' }, '只加分'),
                  h('option', { value: 'require' }, '必须命中'))),
              h('label', { className: 'litkb-themeField' }, h('span', null, '年份范围'),
                h('div', { className: 'litkb-yearRow' },
                  h('input', {
                    className: 'litkb-input', type: 'number', min: 0, max: 2100, value: matchForm.yearFrom || '',
                    placeholder: '起始', onChange: (e) => patchMatch({ yearFrom: Number(e.target.value) || 0 }),
                  }),
                  h('span', { className: 'litkb-themeHint' }, '–'),
                  h('input', {
                    className: 'litkb-input', type: 'number', min: 0, max: 2100, value: matchForm.yearTo || '',
                    placeholder: '结束', onChange: (e) => patchMatch({ yearTo: Number(e.target.value) || 0 }),
                  }))),
              h('label', { className: 'litkb-themeField' }, h('span', null, `最低分 ${matchForm.minScore}`),
                h('input', {
                  type: 'range', min: 0.5, max: 10, step: 0.5, value: matchForm.minScore,
                  onChange: (e) => patchMatch({ minScore: Number(e.target.value) }),
                })),
              h('label', { className: 'litkb-themeField' }, h('span', null, `相对阈值 ${matchForm.relative}`),
                h('input', {
                  type: 'range', min: 0.1, max: 0.9, step: 0.05, value: matchForm.relative,
                  onChange: (e) => patchMatch({ relative: Number(e.target.value) }),
                })),
              h('label', { className: 'litkb-themeField' }, h('span', null, '每篇上限'),
                h('select', {
                  className: 'litkb-input', value: matchForm.perPaper,
                  onChange: (e) => patchMatch({ perPaper: Number(e.target.value) }),
                }, [1, 2, 3].map((n) => h('option', { key: n, value: n }, `${n} 条`)))),
              h('label', { className: 'litkb-themeField' }, h('span', null, '结果上限'),
                h('select', {
                  className: 'litkb-input', value: matchForm.maxHits,
                  onChange: (e) => patchMatch({ maxHits: Number(e.target.value) }),
                }, [4, 6, 8, 10, 12].map((n) => h('option', { key: n, value: n }, `${n} 条`)))),
              h('label', { className: 'litkb-themeField' }, h('span', null, '论文上限'),
                h('select', {
                  className: 'litkb-input', value: matchForm.maxPapers,
                  onChange: (e) => patchMatch({ maxPapers: Number(e.target.value) }),
                }, [3, 5, 6, 8, 10].map((n) => h('option', { key: n, value: n }, `${n} 篇`)))),
              h('label', { className: 'litkb-themeCheck' },
                h('input', {
                  type: 'checkbox', checked: matchForm.expand !== false,
                  onChange: (e) => patchMatch({ expand: e.target.checked }),
                }),
                '启用同义/别名扩展（概念词表）'))),
          h('div', { className: 'litkb-themeModalFoot' },
            h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => setMatchForm({ ...MATCH_DEFAULTS }) }, '恢复默认'),
            h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => setMatchOpen(false) }, '取消'),
            h('button', { type: 'button', className: 'litkb-btn', disabled: busy === 'matchsave', onClick: saveMatch },
              busy === 'matchsave' ? '保存中…' : '保存并重新探索'))))
        : null

      const mergeModal = mergeOpen ? h('div', { className: 'litkb-themeModalWrap', role: 'dialog', 'aria-modal': 'true' },
        h('div', { className: 'litkb-themeModal is-small' },
          h('div', { className: 'litkb-themeModalHead' }, h('span', { className: 'litkb-themeModalTitle' }, '合并链')),
          h('div', { className: 'litkb-themeModalBody' },
            h('div', { className: 'litkb-themeHint' }, '合并后保留目标链，源链会被删除，不可撤销。'),
            h('label', { className: 'litkb-themeField' }, h('span', null, '保留哪条'),
              h('select', {
                className: 'litkb-input', value: mergeOpen.targetId,
                onChange: (e) => setMergeOpen({ ...mergeOpen, targetId: e.target.value }),
              },
                chains.filter((chain) => chain.id !== mergeOpen.sourceId).map((chain) => h('option', {
                  key: chain.id, value: chain.id,
                }, `${chain.claim?.text || chain.title || chain.id}（${chain.status === 'confirmed' ? '已确认' : '草稿'}）`)))),
            h('div', { className: 'litkb-matchMergePreview' },
              h('div', null, `源：${chainById.get(mergeOpen.sourceId)?.claim?.text || mergeOpen.sourceId}`),
              h('div', null, `目标：${chainById.get(mergeOpen.targetId)?.claim?.text || mergeOpen.targetId}`))),
          h('div', { className: 'litkb-themeModalFoot' },
            h('button', { type: 'button', className: 'litkb-btnGhost', onClick: () => setMergeOpen(null) }, '取消'),
            h('button', { type: 'button', className: 'litkb-btn', onClick: confirmMerge }, '确认合并'))))
        : null

      if (!theme) {
        return h('div', { className: 'litkb-wbPage' },
          h('div', { className: 'litkb-wbHead' },
            h('div', null,
              h('div', { className: 'litkb-wbTitle' }, '我的研究'),
              h('div', { className: 'litkb-wbSub' },
                `${themes.length} 个研究 · ${themes.reduce((n, item) => n + item.stats.papers, 0)} 篇论文 · ${themes.reduce((n, item) => n + item.stats.confirmed, 0)} 条已确认链${themes.reduce((n, item) => n + item.stats.gaps, 0) ? ` · ${themes.reduce((n, item) => n + item.stats.gaps, 0)} 个缺口` : ''}`)),
            tags.length
              ? h('details', { className: 'litkb-moreMenu' },
                  h('summary', { className: 'litkb-miniBtn' }, '从标签建 ▾'),
                  h('div', { className: 'litkb-moreList' },
                    tags.slice(0, 20).map((tag) => h('button', {
                      key: tag, type: 'button',
                      onClick: (event) => {
                        startFromTag(tag)
                        const details = event.currentTarget.closest('details')
                        if (details) details.open = false
                      },
                    }, tag))))
              : null,
            h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          err ? h('div', { className: 'litkb-error' }, err) : null,
          notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
          h(OnboardingPanel, {
            guide,
            dismissed: guideDismissed,
            force: guideForce,
            onDismiss: onDismissGuide,
            onImport: onImportPaper,
            onOpenLibrary,
            onOpenWriting,
            onCreateTheme: startNew,
          }),
          h('div', { className: 'litkb-statRow' },
            h('div', { className: 'litkb-statCard is-violet' },
              h('span', { className: 'litkb-statIcon', 'aria-hidden': 'true' }, '◧'),
              h('span', { className: 'litkb-statMain' },
                h('span', { className: 'litkb-statValue' }, String(themes.length)),
                h('span', { className: 'litkb-statLabel' }, '研究主题')),
              h('span', { className: 'litkb-statHint' }, '在研')),
            h('button', {
              type: 'button', className: 'litkb-statCard is-green',
              onClick: () => onOpenLibrary && onOpenLibrary(),
            },
              h('span', { className: 'litkb-statIcon', 'aria-hidden': 'true' }, '▤'),
              h('span', { className: 'litkb-statMain' },
                h('span', { className: 'litkb-statValue' }, String(paperCount)),
                h('span', { className: 'litkb-statLabel' }, '论文库')),
              h('span', { className: 'litkb-statHint' }, '全库论文 →')),
            h('button', {
              type: 'button', className: 'litkb-statCard is-blue',
              onClick: () => onOpenWriting && onOpenWriting(),
            },
              h('span', { className: 'litkb-statIcon', 'aria-hidden': 'true' }, '✎'),
              h('span', { className: 'litkb-statMain' },
                h('span', { className: 'litkb-statValue' }, String(themes.filter((item) => item.draftId).length)),
                h('span', { className: 'litkb-statLabel' }, '写作')),
              h('span', { className: 'litkb-statHint' }, '已绑定文稿 →'))),
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

      const startAnalysis = async (retryFailed = false) => {
        if (!selectedId) return
        setAnalysisBusy(true)
        setErr('')
        try {
          const data = await post('/api/litkb/themes/analyze', { id: selectedId, retryFailed })
          setAnalysisJob(data.job)
          setSection('analysis')
          setNotice(retryFailed ? '重试失败的研究内容' : '方向分析已开始：逐篇审查全文')
        } catch (e) {
          setAnalysisBusy(false)
          setErr(String(e.message || e))
        }
      }

      const stopAnalysis = async () => {
        if (!analysisJob?.id) return
        setErr('')
        try {
          const data = await post('/api/litkb/themes/analysis/cancel', { id: analysisJob.id })
          setAnalysisJob(data.job || null)
          setAnalysisBusy(false)
          setNotice('分析已停止')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const makeAnalysisChain = async (facetKey, viewpointId) => {
        if (!selectedId) return
        setErr('')
        try {
          const data = await post('/api/litkb/themes/analysis/chain', {
            id: selectedId, facetKey, viewpointId,
          })
          await openTheme(selectedId, true)
          setSection('chains')
          setSelectedChain(data.chain.id)
          setNotice('已生成观点链草稿，去「证据链」审核')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const views = h('div', { className: 'litkb-viewCards' },
        [
          ['papers', '▤', '参考论文', papersInTheme.length, '匹配论文'],
          ['chains', '☷', '证据链', chains.length, `${stats.confirmed || 0} 条已确认`],
          ['analysis', '◎', '方向分析', analysis?.stats?.papers || 0,
            analysis ? `${analysis.stats.viewpoints} 观点 / ${analysis.stats.gaps} 缺口` : '全文方向审查'],
          ['summary', '✎', '研究结论', confirmedChains.length, summaryInfo?.stale ? '结论过期' : '条支撑链'],
        ].map(([key, icon, label, value, hint]) => h('button', {
          key, type: 'button',
          className: 'litkb-viewCard' + (section === key ? ' is-on' : ''),
          onClick: () => setSection(key),
        },
          h('span', { className: 'litkb-viewIcon', 'aria-hidden': 'true' }, icon),
          h('span', { className: 'litkb-viewMain' },
            h('span', { className: 'litkb-viewValue' }, String(value)),
            h('span', { className: 'litkb-viewLabel' }, label)),
          h('span', { className: 'litkb-viewHint' }, hint))))

      const allPaperRows = papersInTheme
        .map((row) => ({ row, paper: papers.find((paper) => paper.id === row.paperId) }))
        .filter((item) => item.paper)
      const matchedPaperRows = allPaperRows.filter((item) => item.row.source !== 'chain')
      const legacyPaperRows = allPaperRows.filter((item) => item.row.source === 'chain')
      const filteredPapers = (showLegacy ? allPaperRows : matchedPaperRows)
        .filter((item) => !needle || String(item.paper.title || '').toLowerCase().includes(needle))
      const activePaper = filteredPapers.find((item) => item.paper.id === paperId)?.paper
        || matchedPaperRows[0]?.paper
        || null
      const scoreOf = (pid) => papersInTheme.find((row) => row.paperId === pid)?.score || 0
      const excludedPaperRows = (theme.papers?.exclude || [])
        .map((pid) => ({ id: pid, paper: papers.find((paper) => paper.id === pid) }))
        .filter((item) => item.paper)

      const papersView = h('div', { className: 'litkb-rp' },
        h('div', { className: 'litkb-rpList' },
          h('div', { className: 'litkb-rpHead' },
            h('span', { className: 'litkb-rpHeadTitle' }, `匹配论文 ${matchedPaperRows.length}`),
            h('span', { className: 'litkb-exHint' }, '只含本次匹配'),
            legacyPaperRows.length
              ? h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => setShowLegacy((value) => !value),
                }, showLegacy ? `隐藏旧链 ${legacyPaperRows.length}` : `显示旧链 ${legacyPaperRows.length}`)
              : null,
            excludedPaperRows.length
              ? h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => setShowExcluded((value) => !value),
                }, showExcluded ? `隐藏已移出 ${excludedPaperRows.length}` : `已移出 ${excludedPaperRows.length}`)
              : null,
            spacer(),
            h('button', {
              type: 'button', className: 'litkb-miniBtn',
              onClick: () => { setMatchForm({ ...(theme.match || MATCH_DEFAULTS) }); setMatchOpen(true) },
            }, '匹配设置'),
            h('button', { type: 'button', className: 'litkb-miniBtn', onClick: runMatchDetail }, '匹配明细'),
            h('select', {
              className: 'litkb-input litkb-rpAdd', value: '', title: '手动加入一篇论文',
              onChange: (e) => { if (e.target.value) setPaper(e.target.value, 'include') },
            },
              h('option', { value: '' }, '＋ 手动加入论文…'),
              papers.filter((paper) => !papersInTheme.some((row) => row.paperId === paper.id))
                .map((paper) => h('option', { key: paper.id, value: paper.id }, paper.title || paper.id)))),
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
                onClick: () => {
                  if (typeof window === 'undefined' || !window.confirm || window.confirm('从本研究中移出这篇论文？')) {
                    setPaper(item.paper.id, 'exclude')
                  }
                },
              }, '×'))))),
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
                needle
                  ? '没有匹配关键词的论文。清空搜索试试。'
                  : (excludedPaperRows.length && !matchedPaperRows.length
                    ? `本次没有可显示的论文；${excludedPaperRows.length} 篇已被移出，可点上方「已移出」恢复。`
                    : (legacyPaperRows.length
                      ? `本次匹配没有命中论文；另有 ${legacyPaperRows.length} 篇来自历史链，可点上方「显示旧链」查看。`
                      : '还没有匹配到论文。点右上角「开始探索」或调整「匹配设置」。')))))

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
          duplicateGroups
            ? h('div', { className: 'litkb-stale' },
                h('span', null, `有 ${duplicateGroups} 组细分存在多条已确认链`),
                h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'dedupe', onClick: dedupeChains },
                  busy === 'dedupe' ? '合并中…' : '合并重复'))
            : null,
          h('div', { className: 'litkb-batchBar' },
            h('span', { className: 'litkb-batchCount' }, `已选 ${picked.length}`),
            h('button', {
              type: 'button', className: 'litkb-miniBtn',
              onClick: () => setPicked(chains.filter((chain) => chain.status === 'draft').map((chain) => chain.id)),
            }, '全选草稿'),
            picked.length
              ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setPicked([]) }, '清空')
              : null,
            picked.length
              ? h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'batch', onClick: () => batchReview('accept') }, '批量确认')
              : null,
            picked.length
              ? h('button', { type: 'button', className: 'litkb-miniBtn', disabled: busy === 'batch', onClick: () => batchReview('reject') }, '批量拒绝')
              : null,
            picked.length === 2
              ? h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => setMergeOpen({ sourceId: picked[0], targetId: picked[1] }),
                }, '合并…')
              : null),
          facets.map((facet) => {
            const list = groupChains(facet.key)
            const status = statusOfFacet(facet.key)
            return h('div', { key: facet.key, className: 'litkb-exGroup' },
              h('div', { className: 'litkb-exGroupHead' },
                h('span', { className: 'litkb-exGroupTitle' }, facet.title),
                h('span', { className: 'litkb-badge ' + status.tone }, status.label)),
              list.length
                ? list.map((chain) => h('div', { key: chain.id, className: 'litkb-exChainRow' },
                    h('input', {
                      type: 'checkbox', className: 'litkb-chainCheck',
                      checked: picked.includes(chain.id),
                      'aria-label': `选择链 ${chain.claim?.text || chain.title || chain.id}`,
                      onChange: () => togglePicked(chain.id),
                    }),
                    h('button', {
                      type: 'button',
                      className: 'litkb-exChain is-' + chain.status + (activeChain?.id === chain.id ? ' is-on' : ''),
                      title: chain.claim?.text || chain.title || '',
                      onClick: () => setSelectedChain(chain.id),
                    },
                    h('span', { className: 'litkb-exChainClaim' }, chain.claim?.text || chain.title || ''),
                    h('span', { className: 'litkb-exChainMeta' },
                      `${(chain.nodes || []).length} 条证据 · 置信度 ${chain.confidence}`))))
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
            h('button', {
              type: 'button', className: 'litkb-miniBtn', disabled: Boolean(summaryBusy), onClick: generateSummary,
            }, summaryBusy === 'summary' ? '生成中…' : '生成'),
            h('button', {
              type: 'button', className: 'litkb-miniBtn', disabled: Boolean(summaryBusy) || !confirmedChains.length,
              title: '按研究内容分节，把已确认证据链写成一份完整的研究综述，写入文稿',
              onClick: generateReview,
            }, summaryBusy === 'review' ? '正在写综述…' : '生成综述'),
            summaryEditing
              ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: saveSummary }, '保存')
              : h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSummaryEditing(true) }, '编辑')),
          summaryInfo?.stale
            ? h('div', { className: 'litkb-stale' },
                h('span', null, `结论可能过期：${summaryInfo.reason || '已确认链有变化'}`),
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: generateSummary }, '重新生成'))
            : null,
          summaryInfo?.legacy
            ? h('div', { className: 'litkb-stale is-legacy' }, '旧版结论，未记录依据；建议重新生成一次。')
            : null,
          summaryEditing
            ? h('textarea', {
                className: 'litkb-textarea', rows: 18, value: summaryDraft,
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
        : (section === 'chains'
          ? chainsView
          : (section === 'analysis'
            ? h(AnalysisView, {
                theme,
                analysis,
                job: analysisJob,
                busy: analysisBusy,
                onStart: () => startAnalysis(false),
                onStop: stopAnalysis,
                onRetry: () => startAnalysis(true),
                onChain: makeAnalysisChain,
              })
            : summaryView))

      const matchDrawer = matchDetail ? h('div', {
        className: 'litkb-drawerWrap',
        onMouseDown: (e) => { if (e.target === e.currentTarget) setMatchDetail(null) },
      },
        h('div', { className: 'litkb-drawer is-wide' },
          h('div', { className: 'litkb-drawerHead' },
            h('span', { className: 'litkb-blockTitle' }, '匹配明细'),
            h('span', { className: 'litkb-spacer' }),
            h('button', { type: 'button', className: 'litkb-close', onClick: () => setMatchDetail(null), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'litkb-drawerBody' },
            (matchDetail.results || []).map((result) => h('div', { key: result.facetKey, className: 'litkb-mdGroup' },
              h('div', { className: 'litkb-mdHead' },
                h('span', { className: 'litkb-mdTitle' }, result.facetTitle),
                h('span', { className: 'litkb-badge ' + (result.gap ? 'is-danger' : 'is-ok') },
                  result.gap ? '缺口' : `${result.hits.length} 条`)),
              result.gap
                ? h('div', { className: 'litkb-exGap' }, `${result.reason || '未匹配'}（${result.reasonCode || 'gap'}）`)
                : result.hits.map((hit) => h('div', { key: hit.evidenceId, className: 'litkb-mdHit' },
                    h('div', { className: 'litkb-mdHitTop' },
                      h('span', { className: 'litkb-mdPaper', title: recordOf(hit.paperId).title }, recordOf(hit.paperId).title),
                      h('span', { className: 'litkb-mdScore' }, String(hit.score))),
                    h('div', { className: 'litkb-mdQuote' }, String(hit.quote || hit.text || '').slice(0, 140)),
                    h('div', { className: 'litkb-mdParts' },
                      `${hit.parts?.bm25 ?? '-'} BM25 + ${hit.parts?.tag ?? '-'} 标签 + ${hit.parts?.concept ?? '-'} 概念`),
                    (hit.matched || []).length
                      ? h('div', { className: 'litkb-mdTerms' }, `命中：${hit.matched.slice(0, 6).join(' / ')}`)
                      : null,
                    (hit.expandedBy || []).length
                      ? h('div', { className: 'litkb-mdTerms is-expanded' }, `扩展：${hit.expandedBy.join(' / ')}`)
                      : null,
                    h('div', { className: 'litkb-mdOps' },
                      h('button', {
                        type: 'button', className: 'litkb-miniBtn',
                        onClick: () => { setMatchDetail(null); runChain([result.facetKey]) },
                      }, '只跑这条'),
                      h('button', {
                        type: 'button', className: 'litkb-miniBtn',
                        onClick: () => onOpenPaper && onOpenPaper(hit.paperId, hit.page, hit.block),
                      }, '原文')))))))))
        : null

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
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenDraft && onOpenDraft({ themeId: theme.id, draftId: detail.draft?.id || '' }) }, '去写作'),
          h('details', { className: 'litkb-moreMenu' },
            h('summary', { className: 'litkb-miniBtn' }, '更多 ▾'),
            h('div', { className: 'litkb-moreList' },
              h('button', { type: 'button', onClick: startEdit }, '编辑研究'),
              h('button', { type: 'button', className: 'is-danger', onClick: () => setConfirmDelete(true) }, '删除研究')))),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
        running
          ? h('div', { className: 'litkb-exProgress' },
              `探索中 · 已生成 ${job.created || 0} 条 · ${job.step || ''}`,
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: cancelExplore }, '取消'))
          : null,
        (job?.errors || []).length
          ? h('div', { className: 'litkb-error' },
              job.errors.map((item, index) => h('div', { key: index }, `${item.facetKey || ''} ${item.message || ''}`)))
          : null,
        views,
        h('div', { className: 'litkb-wbBody' }, body),
        matchDrawer,
        deepreadDrawer,
        matchModal,
        mergeModal,
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
