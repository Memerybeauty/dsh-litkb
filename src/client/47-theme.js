    /* ---------------- 研究工作台（v0.2.1：左列表 + 右工作区） ---------------- */
    function spacer() { return h('span', { className: 'litkb-spacer' }) }

    function ThemePage({ papers = [], tags = [], onOpenPaper, onOpenChain, onOpenDraft, onOpenWriting }) {
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
      const [outline, setOutline] = useState(null)
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
        setOutline(null)
        setErr('')
        try {
          const data = await api(`/api/litkb/themes/read?id=${encodeURIComponent(id)}`)
          setDetail(data)
          setSelectedId(id)
          setSummaryDraft(data.theme.summary?.text || '')
          setSummaryEditing(false)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

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

      const makeOutline = async (mode) => {
        if (busy) return
        setBusy('outline')
        setErr('')
        try {
          const data = await post('/api/litkb/themes/outline', { id: selectedId, mode: mode || '' })
          if (data.draft) {
            await openTheme(selectedId)
            setNotice('提纲已写入文稿')
          } else {
            setNotice(data.warnings[0] || '已生成提纲')
          }
          setOutline(data)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const reviewChain = async (id, action) => {
        try {
          await post('/api/litkb/chains/review', { id, action })
          await openTheme(selectedId)
          await refreshList()
          setNotice(action === 'accept' ? '已确认，进入检索与图谱' : '已拒绝并删除草稿')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const removeTheme = async () => {
        try {
          const data = await post('/api/litkb/themes/delete', { id: selectedId })
          setConfirmDelete(false)
          setDetail(null)
          setSelectedId('')
          await refreshList()
          setNotice(data.chainsKept ? `已删除研究；${data.chainsKept} 条关联链保留` : '已删除研究')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const chainForFacet = (facetKey) => {
        const item = (detail?.facetChains || []).find((row) => row.facetKey === facetKey)
        return item?.chain || null
      }

      const fullChainForFacet = (facetKey) => {
        const chains = (detail?.chains || []).filter((chain) => chain.provenance?.facetKey === facetKey)
        return chains.find((chain) => chain.status === 'confirmed') || chains[0] || null
      }

      const statusOfFacet = (facetKey) => {
        const chain = chainForFacet(facetKey)
        if (!chain) return { label: '未匹配', tone: 'is-muted' }
        if (chain.status === 'confirmed') return { label: '已确认', tone: 'is-ok' }
        return { label: '草稿', tone: 'is-warn' }
      }

      const theme = detail?.theme || null
      const stats = detail?.stats || {}
      const papersInTheme = detail?.papers || []
      const themeDrafts = (detail?.chains || []).filter((chain) => chain.status === 'draft')
      const matchFor = (facetKey) => (match?.results || []).find((row) => row.facetKey === facetKey)
      const sumFacets = themes.reduce((n, item) => n + item.stats.facets, 0)
      const sumConfirmed = themes.reduce((n, item) => n + item.stats.confirmed, 0)

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

      const sidebar = h('aside', { className: 'litkb-themeSide' },
        h('div', { className: 'litkb-themeSideHead' },
          h('span', { className: 'litkb-themeSideTitle' }, '研究'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: startNew, title: '新建研究' }, '＋')),
        h('div', { className: 'litkb-themeSideList' },
          themes.length
            ? themes.map((item) => h('button', {
                key: item.id, type: 'button',
                className: 'litkb-themeSideItem' + (item.id === selectedId ? ' is-on' : ''),
                onClick: () => openTheme(item.id),
              },
              h('span', { className: 'litkb-themeSideName' }, item.title),
              h('span', { className: 'litkb-themeSideMeta' },
                `${item.stats.papers} 论文 · ${item.stats.confirmed}/${item.stats.facets} 链`,
                item.stats.gaps ? ` · ${item.stats.gaps} 缺口` : ''),
              h('span', { className: 'litkb-themeSideState' }, item.draftId ? '有文稿' : '未开始')))
            : h('div', { className: 'litkb-themeSideEmpty' }, '还没有研究')),
        h('div', { className: 'litkb-themeSideMore' },
          h('button', {
            type: 'button', className: 'litkb-themeSideItem',
            onClick: () => onOpenWriting && onOpenWriting(),
          },
            h('span', { className: 'litkb-themeSideName' }, '全部文稿'),
            h('span', { className: 'litkb-themeSideMeta' }, '写作页 · 按研究筛选'))),
        h('div', { className: 'litkb-themeSideFoot' },
          `${themes.length} 个研究 · ${sumFacets} 条细分 · ${sumConfirmed} 条已确认`))

      const emptyContent = h('div', { className: 'litkb-themeEmpty' },
        h('div', { className: 'litkb-themeEmptyTitle' }, themes.length ? '从左栏选一个研究' : '从一个研究开始'),
        h('div', { className: 'litkb-themeEmptyText' },
          '研究 = 你的研究主题 + 几条细分描述。流程是：先看匹配到的论文，再为每条细分生成证据链，最后去写作页写成稿。'),
        h('div', { className: 'litkb-themeSteps' },
          ['1 新建研究，写 3–6 条细分描述', '2 匹配预览，确认论文是否切题', '3 生成草稿链，逐条审核', '4 生成提纲，去写作页写']
            .map((line) => h('span', { key: line, className: 'litkb-themeStep' }, line))),
        h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究'))

      if (!theme) {
        return h('div', { className: 'litkb-themeWorkbench' },
          sidebar,
          h('section', { className: 'litkb-themeMain' },
            err ? h('div', { className: 'litkb-error' }, err) : null,
            notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
            emptyContent),
          modal)
      }

      const header = h('div', { className: 'litkb-themeDetailHead' },
        h('div', { className: 'litkb-themeDetailTitleRow' },
          h('span', { className: 'litkb-themeDetailTitle' }, theme.title),
          (theme.tags || []).length
            ? h('span', { className: 'litkb-chips' }, theme.tags.map((tag) => h('span', { key: tag, className: 'litkb-chip' }, tag)))
            : null,
          spacer(),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: startEdit }, '编辑'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setConfirmDelete(true) }, '删除')),
        h('div', { className: 'litkb-themeStats' },
          `论文 ${stats.papers || 0} · 细分 ${stats.facets || 0} · 已确认 ${stats.confirmed || 0} · 草稿 ${stats.drafts || 0} · 缺口 ${stats.gaps || 0}`))

      const matchPanel = match ? h('div', { className: 'litkb-themeBlock' },
        h('div', { className: 'litkb-themeBlockHead' },
          h('span', { className: 'litkb-themeBlockTitle' }, '匹配预览'),
          h('span', { className: 'litkb-themeHint' }, `${match.papers.length} 篇论文命中`),
          spacer(),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setMatch(null) }, '收起')),
        match.results.map((row) => h('div', { key: row.facetKey, className: 'litkb-matchRow' },
          h('div', { className: 'litkb-matchHead' },
            h('span', { className: 'litkb-matchFacet' }, row.facetTitle),
            h('span', { className: 'litkb-themeHint' }, row.gap ? '缺口' : `${row.hits.length} 条证据`),
            spacer(),
            h('button', {
              type: 'button', className: 'litkb-miniBtn',
              onClick: () => runChain([row.facetKey]),
            }, '只跑这条')),
          row.gap
            ? h('div', { className: 'litkb-facetGap' }, row.reason || '没有匹配到证据')
            : row.hits.slice(0, 3).map((hit) => h('button', {
                key: hit.evidenceId, type: 'button', className: 'litkb-facetHit',
                onClick: () => onOpenPaper && onOpenPaper(hit.paperId, hit.page, hit.block),
              },
              h('span', { className: 'litkb-facetHitQuote' }, String(hit.quote || hit.text || '').slice(0, 96)),
              h('span', { className: 'litkb-facetHitMeta' }, `${hit.score} · p.${hit.page}`))))))
        : null

      const papersSection = h('div', { className: 'litkb-themeSection' },
        h('div', { className: 'litkb-themeSectionHead' },
          h('span', { className: 'litkb-themeSectionTitle' }, `论文 ${papersInTheme.length}`),
          h('span', { className: 'litkb-themeHint' }, '先确认这些论文是否切题，再生成链'),
          spacer(),
          h('button', { type: 'button', className: 'litkb-btn', disabled: busy === 'match', onClick: runMatch },
            busy === 'match' ? '匹配中…' : '匹配预览'),
          h('select', {
            className: 'litkb-input litkb-themeAddPaper', value: '',
            onChange: (e) => { if (e.target.value) setPaper(e.target.value, 'include') },
          },
            h('option', { value: '' }, '手动加入论文…'),
            papers.filter((paper) => !papersInTheme.some((row) => row.paperId === paper.id))
              .map((paper) => h('option', { key: paper.id, value: paper.id }, paper.title || paper.id)))),
        matchPanel,
        papersInTheme.length
          ? h('div', { className: 'litkb-themeTable is-papers' },
              h('div', { className: 'litkb-themeRow is-head' },
                ['论文', '年份', '匹配分', '命中细分', '证据', '链', '操作'].map((label) => h('span', { key: label }, label))),
              papersInTheme.map((row) => h('div', { key: row.paperId, className: 'litkb-themeRow' },
                h('button', {
                  type: 'button', className: 'litkb-themeRowTitle is-link',
                  onClick: () => onOpenPaper && onOpenPaper(row.paperId),
                }, row.title),
                h('span', null, row.year || '—'),
                h('span', null, row.score || '—'),
                h('span', { className: 'litkb-themeRowFacets' }, (row.facets || []).map((key) => {
                  const facet = theme.facets.find((item) => item.key === key)
                  return facet ? facet.title : key
                }).join(' / ') || '—'),
                h('span', null, row.evidence || 0),
                h('span', null, row.chainCount || 0),
                h('span', { className: 'litkb-themeRowOps' },
                  row.source === 'manual'
                    ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setPaper(row.paperId, 'restore') }, '移除加入')
                    : h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setPaper(row.paperId, 'exclude') }, '移出')))))
          : h('div', { className: 'litkb-themeEmpty is-inline' },
              h('div', { className: 'litkb-themeEmptyText' }, '还没有符合条件的论文。点「匹配预览」，或手动加入论文。')))

      const evidenceSection = h('div', { className: 'litkb-themeSection' },
        h('div', { className: 'litkb-themeSectionHead' },
          h('span', { className: 'litkb-themeSectionTitle' }, '证据链'),
          h('span', { className: 'litkb-themeHint' }, '一条细分描述一条链，确认后进检索与图谱'),
          spacer(),
          job && ['queued', 'running'].includes(job.status)
            ? h('span', { className: 'litkb-themeHint' }, `任务 ${job.done}/${job.total} · ${job.step}`)
            : null,
          h('button', {
            type: 'button', className: 'litkb-btn',
            disabled: busy === 'chain' || Boolean(job && ['queued', 'running'].includes(job.status)),
            onClick: () => runChain([]),
          }, busy === 'chain' ? '生成中…' : '全部生成草稿')),
        theme.facets.map((facet) => {
          const status = statusOfFacet(facet.key)
          const chain = chainForFacet(facet.key)
          const preview = matchFor(facet.key)
          return h('div', { key: facet.key, className: 'litkb-facetCard' },
            h('div', { className: 'litkb-facetHead' },
              h('span', { className: 'litkb-facetTitle' }, facet.title),
              h('span', { className: 'litkb-badge ' + status.tone }, status.label),
              spacer(),
              h('span', { className: 'litkb-facetMeta' },
                `${(preview?.hits || []).length || chain?.nodes || 0} 条证据`,
                chain ? ` · 置信度 ${chain.confidence}` : '')),
            facet.description ? h('div', { className: 'litkb-facetDesc' }, facet.description) : null,
            (facet.keywords || []).length
              ? h('div', { className: 'litkb-chips' }, facet.keywords.map((keyword) => h('span', { key: keyword, className: 'litkb-chip' }, keyword)))
              : null,
            preview && !preview.gap
              ? h('div', { className: 'litkb-facetPreview' }, preview.hits.slice(0, 3).map((hit) => h('button', {
                  key: hit.evidenceId, type: 'button', className: 'litkb-facetHit',
                  onClick: () => onOpenPaper && onOpenPaper(hit.paperId, hit.page, hit.block),
                },
                h('span', { className: 'litkb-facetHitQuote' }, String(hit.quote || hit.text || '').slice(0, 96)),
                h('span', { className: 'litkb-facetHitMeta' }, `${hit.score} · p.${hit.page}`))))
              : null,
            h('div', { className: 'litkb-facetActions' },
              chain
                ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain && onOpenChain(chain.id) }, '看链')
                : null,
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => runChain([facet.key]) }, '只跑这条')))
        }),
        h('div', { className: 'litkb-themeBlock' },
          h('div', { className: 'litkb-themeBlockHead' },
            h('span', { className: 'litkb-themeBlockTitle' }, '综合结论'),
            h('span', { className: 'litkb-themeHint' }, `基于 ${stats.confirmed || 0} 条已确认链`),
            spacer(),
            h('button', { type: 'button', className: 'litkb-miniBtn', onClick: generateSummary }, '生成'),
            summaryEditing
              ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: saveSummary }, '保存')
              : h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setSummaryEditing(true) }, '编辑')),
          summaryEditing
            ? h('textarea', {
                className: 'litkb-textarea', rows: 5, value: summaryDraft,
                placeholder: '点「生成」汇总已确认链，或直接写',
                onChange: (e) => setSummaryDraft(e.target.value),
              })
            : h('div', { className: 'litkb-themeSummary' }, theme.summary?.text || '还没有结论。先确认链，再点「生成」。')),
        papersInTheme.length && theme.facets.length
          ? h('div', { className: 'litkb-themeBlock' },
              h('div', { className: 'litkb-themeBlockHead' },
                h('span', { className: 'litkb-themeBlockTitle' }, '覆盖矩阵'),
                h('span', { className: 'litkb-themeHint' }, '● 有证据 · 空 缺口')),
              h('div', { className: 'litkb-matrix' },
                h('div', { className: 'litkb-matrixRow is-head' },
                  h('span', { className: 'litkb-matrixFacet' }, '细分 \\\\ 论文'),
                  papersInTheme.slice(0, 8).map((row) => h('span', { key: row.paperId, className: 'litkb-matrixPaper', title: row.title }, String(row.title || row.paperId).slice(0, 6)))),
                theme.facets.filter((facet) => facet.enabled).map((facet) => {
                  const chain = fullChainForFacet(facet.key)
                  return h('div', { key: facet.key, className: 'litkb-matrixRow' },
                    h('span', { className: 'litkb-matrixFacet', title: facet.title }, facet.title),
                    papersInTheme.slice(0, 8).map((row) => {
                      const hit = Boolean(chain && (chain.nodes || []).some((node) => node.paperId === row.paperId))
                      return h('span', { key: row.paperId, className: 'litkb-matrixCell' + (hit ? ' is-hit' : '') }, hit ? '●' : '·')
                    }))
                })))
          : null,
        theme.facets.some((facet) => !chainForFacet(facet.key))
          ? h('div', { className: 'litkb-themeGaps' },
              h('div', { className: 'litkb-themeGapsTitle' }, '缺口'),
              theme.facets.filter((facet) => !chainForFacet(facet.key)).map((facet) => h('div', { key: facet.key, className: 'litkb-themeGapItem' }, facet.title)))
          : null,
        themeDrafts.length
          ? h('div', { className: 'litkb-themeBlock' },
              h('div', { className: 'litkb-themeBlockHead' },
                h('span', { className: 'litkb-themeBlockTitle' }, `待审草稿 ${themeDrafts.length}`),
                h('span', { className: 'litkb-themeHint' }, '确认后才进入检索与知识库图')),
              themeDrafts.map((chain) => h('div', { key: chain.id, className: 'litkb-themeReviewRow' },
                h('span', { className: 'litkb-themeReviewClaim' }, chain.claim?.text || chain.title || ''),
                h('span', { className: 'litkb-themeHint' }, `${(chain.nodes || []).length} 条证据 · 置信度 ${chain.confidence}`),
                h('span', { className: 'litkb-themeReviewOps' },
                  h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain && onOpenChain(chain.id) }, '看链'),
                  h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => reviewChain(chain.id, 'accept') }, '确认'),
                  h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => reviewChain(chain.id, 'reject') }, '拒绝')))))
          : null)

      const writingSection = h('div', { className: 'litkb-themeSection' },
        h('div', { className: 'litkb-themeSectionHead' },
          h('span', { className: 'litkb-themeSectionTitle' }, '写作'),
          h('span', { className: 'litkb-themeHint' }, '文稿在「写作」页统一管理，这里只负责生成与跳转')),
        h('div', { className: 'litkb-themeBlock' },
          detail.draft
            ? h('div', { className: 'litkb-themeDraftRow' },
                h('span', { className: 'litkb-themeDraftTitle' }, detail.draft.title),
                h('span', { className: 'litkb-themeHint' }, `${detail.draft.chars} 字 · ${detail.draft.citations} 条引用`),
                spacer(),
                h('button', { type: 'button', className: 'litkb-btn', onClick: () => onOpenDraft && onOpenDraft({ themeId: theme.id, draftId: detail.draft.id }) }, '打开写作页'),
                h('a', { className: 'litkb-miniBtn', href: `/api/litkb/drafts/export?id=${encodeURIComponent(detail.draft.id)}`, target: '_blank', rel: 'noreferrer' }, '导出'))
            : h('div', { className: 'litkb-themeDraftRow' },
                h('span', { className: 'litkb-themeHint' }, '还没有文稿。生成提纲会创建并绑定一份，之后在写作页里改。'),
                spacer(),
                h('button', { type: 'button', className: 'litkb-btn', disabled: busy === 'outline', onClick: () => makeOutline('new') }, '生成提纲')),
          detail.draft
            ? h('div', { className: 'litkb-themeActions' },
                h('button', { type: 'button', className: 'litkb-btnGhost', disabled: busy === 'outline', onClick: () => makeOutline('append') }, '追加提纲到文稿'),
                h('button', { type: 'button', className: 'litkb-btnGhost', disabled: busy === 'outline', onClick: () => makeOutline('replace') }, '用提纲覆盖文稿'))
            : null,
          outline
            ? h('pre', { className: 'litkb-themeOutline' }, outline.markdown)
            : null))

      return h('div', { className: 'litkb-themeWorkbench' },
        sidebar,
        h('section', { className: 'litkb-themeMain' },
          err ? h('div', { className: 'litkb-error' }, err) : null,
          notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
          header,
          papersSection,
          evidenceSection,
          writingSection),
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
