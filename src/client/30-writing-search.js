    function SearchPage({ onOpenPaper, onOpenChain, onOpenPdf, onSaveAnswer, papers = [], tags = [] }) {
      const [query, setQuery] = useState('')
      const [mode, setMode] = useState('answer')
      const [loading, setLoading] = useState(false)
      const [data, setData] = useState(null)
      const [history, setHistory] = useState([])
      const [filters, setFilters] = useState({ paperId: '', tag: '', yearFrom: '', yearTo: '' })
      const [notice, setNotice] = useState('')
      const [saving, setSaving] = useState(false)
      const [err, setErr] = useState('')

      const loadHistory = useCallback(async () => {
        try {
          const payload = await api('/api/litkb/search/history?limit=10')
          setHistory(payload.items || [])
        } catch { /* history is optional */ }
      }, [])

      useEffect(() => { loadHistory() }, [loadHistory])

      const run = async (override) => {
        const q = String(override ?? query).trim()
        if (override !== undefined) setQuery(q)
        if (!q) { setErr('先输入一个问题或关键词'); return }
        setLoading(true)
        setErr('')
        try {
          const path = mode === 'answer' ? '/api/litkb/search/answer' : '/api/litkb/search'
          const payload = await api(path, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ q, limit: 10, ...filters }),
          })
          setData(payload)
          loadHistory()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }

      const copyAnswer = async () => {
        if (!data?.answer) return
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(data.answer)
          setNotice('已复制答案')
        } catch {
          setNotice('复制失败，请手动选择')
        }
      }

      const saveAnswer = async () => {
        if (!data?.answer || !onSaveAnswer || saving) return
        setSaving(true)
        setNotice('正在打开写作…')
        try {
          await onSaveAnswer(data.answer, data.question || query)
        } catch (e) {
          setNotice(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      const openCitation = (item) => {
        if (onOpenPdf) onOpenPdf(item.paperId, item.page, item.block)
        else if (onOpenPaper) onOpenPaper(item.paperId, item.page, item.block)
      }

      return h('div', { className: 'litkb-searchPage' },
        h('div', { className: 'litkb-searchHero' },
          h('div', { className: 'litkb-searchTitle' }, '证据链检索'),
          h('div', { className: 'litkb-searchSub' }, '先按链检索，再生成带 q-id 的答案；每条引用可点回原文。'),
          h('div', { className: 'litkb-searchBar' },
            h('input', {
              className: 'litkb-input litkb-searchInput',
              placeholder: '问一个问题，例如：极坐标对视盘边界有什么帮助？',
              value: query,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); run() } },
            }),
            h('button', { type: 'button', className: 'litkb-btn', disabled: loading, onClick: () => run() }, loading ? '检索中…' : '检索')),
          h('div', { className: 'litkb-searchModes' },
            h('button', { type: 'button', className: 'litkb-searchMode' + (mode === 'answer' ? ' is-on' : ''), onClick: () => setMode('answer') }, '链答案'),
            h('button', { type: 'button', className: 'litkb-searchMode' + (mode === 'evidence' ? ' is-on' : ''), onClick: () => setMode('evidence') }, '只看证据'),
            h('span', { className: 'litkb-searchHint' }, '无模型时自动返回证据摘录；不会编造引用。')),
          h('div', { className: 'litkb-searchFilters' },
            h('select', {
              className: 'litkb-input litkb-searchFilter', value: filters.paperId,
              onChange: (e) => setFilters({ ...filters, paperId: e.target.value }),
            }, h('option', { value: '' }, '全部论文'), papers.map((paper) => h('option', { key: paper.id, value: paper.id }, paper.title || paper.id))),
            h('select', {
              className: 'litkb-input litkb-searchFilter', value: filters.tag,
              onChange: (e) => setFilters({ ...filters, tag: e.target.value }),
            }, h('option', { value: '' }, '全部标签'), tags.map((tag) => {
              const name = typeof tag === 'string' ? tag : tag.name
              return h('option', { key: name, value: name }, name)
            })),
            h('input', {
              className: 'litkb-input litkb-searchFilter', type: 'number', placeholder: '起始年',
              value: filters.yearFrom, onChange: (e) => setFilters({ ...filters, yearFrom: e.target.value }),
            }),
            h('input', {
              className: 'litkb-input litkb-searchFilter', type: 'number', placeholder: '截止年',
              value: filters.yearTo, onChange: (e) => setFilters({ ...filters, yearTo: e.target.value }),
            })),
          history.length
            ? h('div', { className: 'litkb-searchHistory' },
                h('span', { className: 'litkb-searchHistoryLabel' }, '最近检索'),
                history.slice(0, 10).map((item, index) => h('button', {
                  key: item.at + '-' + index, type: 'button', className: 'litkb-searchHistoryItem',
                  title: item.mode,
                  onClick: () => run(item.q),
                }, item.q)))
            : null),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
        !data
          ? h('div', { className: 'litkb-searchEmpty' },
              h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '⌕'),
              h('div', { className: 'litkb-emptyTitle' }, '从证据链里找答案'),
              h('p', { className: 'litkb-emptyText' }, '问题会先命中链，再回到链上的 q-id 证据；没有证据就明确说不足。'))
          : h('div', { className: 'litkb-searchResult' },
              h('div', { className: 'litkb-searchResultHead' },
                h('span', { className: 'litkb-searchResultTitle' }, mode === 'answer' ? '答案' : '证据'),
                h('span', { className: 'litkb-chip is-type' }, data.mode === 'extractive' ? '抽取式' : (data.mode || '检索')),
                h('span', { className: 'litkb-muted' }, `${data.took ?? 0}ms · ${data.chains?.length || 0} 条链 · ${data.evidence?.length || 0} 条证据`),
                h('span', { className: 'litkb-spacer' }),
                data.answer ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: copyAnswer }, '复制答案') : null,
                data.answer && onSaveAnswer ? h('button', { type: 'button', className: 'litkb-miniBtn', disabled: saving, onClick: saveAnswer }, saving ? '保存中…' : '存为文稿') : null),
              data.warnings?.length ? h('div', { className: 'litkb-searchWarn' }, data.warnings.join('；')) : null,
              data.answer
                ? h('div', { className: 'litkb-searchAnswer' }, renderMarkdown(data.answer, {
                    onOpenPaper: (paperId, page) => (onOpenPaper ? onOpenPaper(paperId, page) : null),
                    onOpenPage: (page, paperId) => (onOpenPaper ? onOpenPaper(paperId, page) : null),
                  }))
                : null,
              data.citations?.length
                ? h('div', { className: 'litkb-searchBlock' },
                    h('div', { className: 'litkb-searchBlockTitle' }, `引用 ${data.citations.length}`),
                    h('div', { className: 'litkb-searchCites' }, data.citations.map((item, index) => h('button', {
                      key: item.evidenceId + '-' + index, type: 'button', className: 'litkb-searchCite',
                      onClick: () => openCitation(item),
                    },
                    h('span', { className: 'litkb-evPage' }, `p.${item.page}`),
                    h('span', { className: 'litkb-searchCiteTitle' }, item.title || item.paperId),
                    h('span', { className: 'litkb-searchCiteQuote' }, item.quote || ''),
                    h('span', { className: 'litkb-muted' }, `${item.authors || ''} ${item.year || ''} · ${item.evidenceId}`)))))
                : null,
              data.chains?.length
                ? h('div', { className: 'litkb-searchBlock' },
                    h('div', { className: 'litkb-searchBlockTitle' }, `命中链 ${data.chains.length}`),
                    data.chains.map((chain) => h('button', {
                      key: chain.id, type: 'button', className: 'litkb-searchChain',
                      onClick: () => onOpenChain && onOpenChain(chain.id),
                    },
                    h('span', { className: 'litkb-searchChainTitle' }, chain.claim || chain.title),
                    h('span', { className: 'litkb-muted' }, `${chain.id} · ${chain.citations?.length || 0} 条证据${chain.confidence < 1 ? ` · 置信度 ${Math.round((chain.confidence || 0) * 100)}%` : ''}`))))
                : null,
              data.evidence?.length && mode === 'evidence'
                ? h('div', { className: 'litkb-searchBlock' },
                    h('div', { className: 'litkb-searchBlockTitle' }, `证据 ${data.evidence.length}`),
                    data.evidence.map((item) => h('button', {
                      key: item.evidenceId, type: 'button', className: 'litkb-searchCite',
                      onClick: () => openCitation(item),
                    },
                    h('span', { className: 'litkb-evPage' }, `p.${item.page}`),
                    h('span', { className: 'litkb-searchCiteTitle' }, item.title || item.paperId),
                    h('span', { className: 'litkb-searchCiteQuote' }, item.quote || ''),
                    h('span', { className: 'litkb-muted' }, `${item.evidenceId} · 分数 ${item.score}`))))
                : null,
              data.trace?.length
                ? h('details', { className: 'litkb-searchTrace' },
                    h('summary', null, '为什么是这些证据'),
                    h('div', { className: 'litkb-muted' }, data.trace.slice(0, 12).map((item, index) => h('div', { key: index },
                      `${item.chainId || '未入链'} · ${item.evidenceId || ''} · 分数 ${item.score} · 命中 ${(item.matched || []).join(' / ')}`))))
                : null))
    }

    function WritingPage({ insertRequest, onConsumed, onOpenPaper, focus = null }) {
      const [drafts, setDrafts] = useState([])
      const [activeId, setActiveId] = useState('')
      const [draft, setDraft] = useState(null)
      const [title, setTitle] = useState('')
      const [body, setBody] = useState('')
      const [mode, setMode] = useState('split')
      const [saving, setSaving] = useState(false)
      const [status, setStatus] = useState('')
      const [err, setErr] = useState('')
      const [notice, setNotice] = useState('')
      const [query, setQuery] = useState('')
      const [results, setResults] = useState([])
      const [searching, setSearching] = useState(false)
      const [rightTab, setRightTab] = useState('citations')
      const [citationInfo, setCitationInfo] = useState(null)
      const [assistBusy, setAssistBusy] = useState('')
      const [assistIntent, setAssistIntent] = useState('')
      const [focusMode, setFocusMode] = useState(false)
      const [draftWidth, setDraftWidth] = useState(() => storedWidth('litkb.writeDraftWidth', 250))
      const [railWidth, setRailWidth] = useState(() => storedWidth('litkb.writeRailWidth', 330))
      const [splitRatio, setSplitRatio] = useState(() => Math.min(75, Math.max(25, storedWidth('litkb.writeSplit', 50))))
      const [researchFilter, setResearchFilter] = useState('')
      const [themes, setThemes] = useState([])
      const dirtyRef = useRef(false)
      const writeRef = useRef(null)
      const paneRef = useRef(null)
      const pendingRef = useRef(null)
      const pendingTextRef = useRef(null)
      const pendingAssistRef = useRef(null)
      const textRef = useRef(null)

      const loadList = useCallback(async () => {
        const data = await api('/api/litkb/drafts')
        const next = data.drafts || []
        setDrafts(next)
        setActiveId((current) => current || next[0]?.id || '')
        return next
      }, [])

      const loadDraft = useCallback(async (id) => {
        const data = await api('/api/litkb/drafts/read?id=' + encodeURIComponent(id))
        setDraft(data.draft)
        setTitle(data.draft.title || '')
        setBody(data.draft.body || '')
        setCitationInfo(data.citations || null)
        dirtyRef.current = false
        setStatus('已保存')
        setErr('')
      }, [])

      useEffect(() => { loadList().catch((e) => setErr(String(e.message || e))) }, [loadList])
      useEffect(() => {
        api('/api/litkb/themes')
          .then((data) => setThemes(data.themes || []))
          .catch(() => { /* 研究列表不可用时写作照常 */ })
      }, [])
      useEffect(() => {
        if (!focus) return
        if (focus.themeId) setResearchFilter(focus.themeId)
        if (focus.draftId) setActiveId(focus.draftId)
      }, [focus])
      useEffect(() => { if (activeId) loadDraft(activeId).catch((e) => setErr(String(e.message || e))) }, [activeId, loadDraft])

      const saveNow = useCallback(async () => {
        if (!draft) return null
        setSaving(true)
        setErr('')
        try {
          const data = await api('/api/litkb/drafts/save', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: draft.id, title, body }),
          })
          setDraft(data.draft)
          setCitationInfo(data.citations || null)
          dirtyRef.current = false
          setStatus('已保存 ' + formatLocal(new Date()).slice(11, 16))
          await loadList()
          return data.draft
        } catch (e) {
          setErr(String(e.message || e))
          return null
        } finally {
          setSaving(false)
        }
      }, [draft, title, body, loadList])

      useEffect(() => {
        if (!draft || !dirtyRef.current) return undefined
        const timer = setTimeout(() => { saveNow() }, 1200)
        return () => clearTimeout(timer)
      }, [title, body, draft, saveNow])

      const create = async () => {
        setErr('')
        setNotice('')
        try {
          const data = await api('/api/litkb/drafts', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: '未命名文稿', type: '综述' }),
          })
          await loadList()
          setActiveId(data.draft.id)
          setNotice('已新建文稿')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const ensureDraft = async () => {
        if (activeId) return activeId
        const data = await api('/api/litkb/drafts', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: '未命名文稿', type: '综述' }),
        })
        await loadList()
        setActiveId(data.draft.id)
        return data.draft.id
      }

      const formatInline = (prefix, suffix = '', placeholder = '') => {
        const element = textRef.current
        const start = element?.selectionStart ?? body.length
        const end = element?.selectionEnd ?? body.length
        const selected = body.slice(start, end) || placeholder
        const next = body.slice(0, start) + prefix + selected + suffix + body.slice(end)
        setBody(next)
        dirtyRef.current = true
        setStatus('未保存')
        requestAnimationFrame(() => {
          if (!element) return
          element.focus()
          const cursor = start + prefix.length + selected.length + suffix.length
          element.setSelectionRange(cursor, cursor)
        })
      }

      const tidy = () => {
        if (!window.confirm('按 Markdown 块补换行？只改当前文稿，不改论文数据。')) return
        const next = body
          .replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n$2')
          .replace(/([^\n])\s*((?:^|\s)[-*+]\s+)/g, '$1\n$2')
          .replace(/([^\n])\s*(>\s+)/g, '$1\n$2')
        setBody(next)
        dirtyRef.current = true
        setStatus('未保存')
        setMode('split')
      }

      const formatBlock = (prefix) => {
        const element = textRef.current
        const start = element?.selectionStart ?? body.length
        const atLineStart = start === 0 || body[start - 1] === '\n'
        const insertion = atLineStart ? prefix : `\n${prefix}`
        const next = body.slice(0, start) + insertion + body.slice(start)
        setBody(next)
        dirtyRef.current = true
        setStatus('未保存')
        requestAnimationFrame(() => {
          if (!element) return
          element.focus()
          const cursor = start + insertion.length
          element.setSelectionRange(cursor, cursor)
        })
      }

      const citationMarkup = (request) => {
        const page = Number(request.page) || 1
        const label = request.label || `p.${page}`
        return ` [[${request.paperId}#^${request.evidenceId}|${label}]] `
      }

      const insertText = (text) => {
        const element = textRef.current
        const start = element?.selectionStart ?? body.length
        const end = element?.selectionEnd ?? body.length
        const next = body.slice(0, start) + text + body.slice(end)
        setBody(next)
        dirtyRef.current = true
        setStatus('未保存')
        setMode((current) => (current === 'preview' ? 'split' : current))
        requestAnimationFrame(() => {
          if (!element) return
          element.focus()
          const cursor = start + text.length
          element.setSelectionRange(cursor, cursor)
        })
      }

      const queueInsert = (text) => {
        if (draft) { insertText(text); return }
        pendingTextRef.current = text
        ensureDraft().catch((e) => setErr(String(e.message || e)))
      }

      useEffect(() => {
        if (!draft) return
        if (pendingTextRef.current) {
          const text = pendingTextRef.current
          pendingTextRef.current = null
          insertText(text)
        }
        if (pendingAssistRef.current) {
          const item = pendingAssistRef.current
          pendingAssistRef.current = null
          assist(item)
        }
      }, [draft])

      useEffect(() => {
        if (!insertRequest) return
        if (draft) {
          insertText(citationMarkup(insertRequest))
          setNotice('引用已插入文稿')
          if (onConsumed) onConsumed()
        } else {
          pendingRef.current = insertRequest
          ensureDraft().catch((e) => setErr(String(e.message || e)))
        }
      }, [insertRequest])

      useEffect(() => {
        if (!draft || !pendingRef.current) return
        const request = pendingRef.current
        pendingRef.current = null
        insertText(citationMarkup(request))
        setNotice('引用已插入文稿')
        if (onConsumed) onConsumed()
      }, [draft])

      useEffect(() => {
        let alive = true
        const timer = setTimeout(async () => {
          setSearching(true)
          try {
            const data = await api('/api/litkb/evidence/search?q=' + encodeURIComponent(query.trim()))
            if (alive) setResults(data.items || [])
          } catch (e) {
            if (alive) setErr(String(e.message || e))
          } finally {
            if (alive) setSearching(false)
          }
        }, 260)
        return () => { alive = false; clearTimeout(timer) }
      }, [query])

      const insertEvidence = (item) => {
        queueInsert(` [[${item.paperId}#^${item.evidenceId}|${shortAuthors(item.authors)} ${item.year || ''}, p.${item.page}]] `)
        setNotice('引用已插入')
      }

      const assist = async (item) => {
        if (assistBusy) return
        if (!draft) {
          pendingAssistRef.current = item
          await ensureDraft().catch((e) => setErr(String(e.message || e)))
          return
        }
        setAssistBusy(item.evidenceId)
        setErr('')
        setNotice('')
        try {
          const id = await ensureDraft()
          const data = await api('/api/litkb/drafts/assist', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, evidenceIds: [item.evidenceId], instruction: assistIntent.trim() || '写一段与研究现状相关的正文' }),
          })
          insertText(`\n${data.text}\n`)
          setNotice((data.warnings || []).length ? data.warnings.join('；') : 'AI 草稿已插入，请核对')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setAssistBusy('')
        }
      }

      const startWriteResize = (side, event) => {
        event.preventDefault()
        const rect = writeRef.current?.getBoundingClientRect()
        const total = rect?.width || 1120
        const startX = event.clientX
        const startDraft = draftWidth
        const startRail = railWidth
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX
          if (side === 'draft') {
            const max = Math.max(180, Math.min(360, total - startRail - 380))
            const next = Math.max(180, Math.min(max, startDraft + delta))
            setDraftWidth(next)
            try { window.localStorage?.setItem('litkb.writeDraftWidth', String(Math.round(next))) } catch { /* ignore */ }
          } else {
            const max = Math.max(260, Math.min(520, total - startDraft - 380))
            const next = Math.max(260, Math.min(max, startRail - delta))
            setRailWidth(next)
            try { window.localStorage?.setItem('litkb.writeRailWidth', String(Math.round(next))) } catch { /* ignore */ }
          }
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }

      const startSplitResize = (event) => {
        event.preventDefault()
        const rect = paneRef.current?.getBoundingClientRect()
        if (!rect) return
        const onMove = (moveEvent) => {
          const ratio = Math.max(25, Math.min(75, ((moveEvent.clientX - rect.left) / rect.width) * 100))
          setSplitRatio(ratio)
          try { window.localStorage?.setItem('litkb.writeSplit', String(Math.round(ratio))) } catch { /* ignore */ }
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }

      const selectDraft = async (id) => {
        if (id === activeId) return
        if (dirtyRef.current) await saveNow()
        setActiveId(id)
      }

      const removeDraft = async (item) => {
        if (!window.confirm(`删除文稿「${item.title}」？文件会从 drafts/ 删除，不可恢复。`)) return
        setErr('')
        try {
          await api('/api/litkb/drafts/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          })
          dirtyRef.current = false
          if (item.id === activeId) {
            setDraft(null)
            setTitle('')
            setBody('')
            setCitationInfo(null)
            setStatus('')
            setActiveId('')
          }
          const next = await loadList()
          if (item.id === activeId) setActiveId(next[0]?.id || '')
          setNotice('文稿已删除')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const openCitation = async (paperId, page) => {
        if (dirtyRef.current) await saveNow()
        if (onOpenPaper) onOpenPaper(paperId, page)
      }

      const citations = citationInfo?.citations || []
      const references = citationInfo?.references || []
      const missing = citationInfo?.missing || []
      const chars = body.length
      const themeByDraft = new Map(themes.filter((item) => item.draftId).map((item) => [item.draftId, item]))
      const filteredDrafts = researchFilter ? drafts.filter((item) => themeByDraft.get(item.id)?.id === researchFilter) : drafts

      useEffect(() => {
        if (!researchFilter || !drafts.length) return
        if (!filteredDrafts.some((item) => item.id === activeId)) setActiveId(filteredDrafts[0]?.id || '')
      }, [researchFilter, drafts, activeId])

      const searchRow = (item) => h('div', { key: item.evidenceId, className: 'litkb-writeEv' },
        h('div', { className: 'litkb-writeEvTop' },
          h('span', { className: 'litkb-writeEvTitle', title: item.title }, item.title),
          h('span', { className: 'litkb-evPage' }, `p.${item.page}`)),
        h('div', { className: 'litkb-writeEvQuote' }, item.quote),
        h('div', { className: 'litkb-writeEvActions' },
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => insertEvidence(item) }, '插入引用'),
          h('button', {
            type: 'button', className: 'litkb-miniBtn',
            disabled: Boolean(assistBusy), onClick: () => assist(item),
          }, assistBusy === item.evidenceId ? '扩写中…' : 'AI 扩写')))

      return h('div', {
        className: 'litkb-writing' + (focusMode ? ' is-focus' : ''),
        ref: writeRef,
        style: { '--litkb-write-draft': `${draftWidth}px`, '--litkb-write-rail': `${railWidth}px` },
      },
        h('aside', { className: 'litkb-draftList' },
          h('div', { className: 'litkb-draftHead' },
            h('span', { className: 'litkb-blockTitle' }, '文稿'),
            h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: create }, '＋ 新建')),
          h('div', { className: 'litkb-writingFilterRow' },
            h('select', {
              className: 'litkb-input litkb-writingFilter',
              value: researchFilter,
              onChange: (e) => setResearchFilter(e.target.value),
              title: '按研究筛选文稿',
            },
              h('option', { value: '' }, '全部文稿'),
              themes.filter((item) => item.draftId).map((item) => h('option', { key: item.id, value: item.id }, item.title)))),
          filteredDrafts.length
            ? filteredDrafts.map((item) => h('div', {
                key: item.id, role: 'button', tabIndex: 0,
                className: 'litkb-draftRow' + (item.id === activeId ? ' is-active' : ''),
                onClick: () => selectDraft(item.id),
                onKeyDown: (e) => { if (e.key === 'Enter') selectDraft(item.id) },
              },
              h('span', { className: 'litkb-draftRowMain' },
                h('span', { className: 'litkb-draftTitle' }, item.title),
                h('span', { className: 'litkb-draftMeta' }, `${item.chars || 0} 字 · ${item.citations || 0} 引用`),
                themeByDraft.get(item.id)
                  ? h('span', { className: 'litkb-draftMeta is-research', title: themeByDraft.get(item.id).title }, `研究：${themeByDraft.get(item.id).title}`)
                  : null),
              h('button', {
                type: 'button', className: 'litkb-draftDel', title: '删除文稿',
                'aria-label': `删除文稿 ${item.title}`,
                onClick: (e) => { e.stopPropagation(); removeDraft(item) },
              }, '×')))
            : h('div', { className: 'litkb-muted', style: { padding: '10px 6px' } }, researchFilter ? '这个研究还没有绑定文稿' : '还没有文稿')),
        h('div', {
          className: 'litkb-resizer litkb-writeResizer', role: 'separator', 'aria-orientation': 'vertical',
          title: '拖动调整文稿列表宽度', onMouseDown: (event) => startWriteResize('draft', event),
        }),
        h('section', { className: 'litkb-writeMain' },
          draft
            ? h('div', { className: 'litkb-writeShell' },
                h('div', { className: 'litkb-writeBar' },
                  h('input', {
                    className: 'litkb-input litkb-writeTitle', value: title,
                    onChange: (e) => { setTitle(e.target.value); dirtyRef.current = true; setStatus('未保存') },
                  }),
                  h('span', { className: 'litkb-muted' }, saving ? '保存中…' : status),
                  h('span', { className: 'litkb-spacer' }),
                  h('div', { className: 'litkb-writeModes' },
                    [['edit', '编辑'], ['split', '分栏'], ['preview', '预览']].map(([key, label]) => h('button', {
                      key, type: 'button', className: 'litkb-miniBtn' + (mode === key ? ' is-on' : ''),
                      onClick: () => setMode(key),
                    }, label))),
                  h('button', { type: 'button', className: 'litkb-miniBtn', disabled: saving, onClick: saveNow }, '保存'),
                  h('a', {
                    className: 'litkb-miniBtn',
                    href: '/api/litkb/drafts/export?id=' + encodeURIComponent(draft.id),
                    download: draft.id + '.md',
                  }, '导出 MD')),
                notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
                err ? h('div', { className: 'litkb-error' }, err) : null,
                h('div', { className: 'litkb-writeTools' },
                  h('div', { className: 'litkb-toolGroup' },
                    h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => formatBlock('## ') }, 'H2'),
                    h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => formatInline('**', '**', '重点') }, 'B'),
                    h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => formatBlock('- ') }, '• 列表'),
                    h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => formatBlock('> ') }, '❝ 引用')),
                  h('span', { className: 'litkb-toolSep' }),
                  h('div', { className: 'litkb-toolGroup' },
                    h('button', { type: 'button', className: 'litkb-miniBtn', onClick: tidy }, '整理'),
                    h('button', {
                      type: 'button', className: 'litkb-miniBtn' + (focusMode ? ' is-on' : ''),
                      onClick: () => setFocusMode((value) => !value),
                    }, focusMode ? '退出专注' : '专注')),
                  h('span', { className: 'litkb-muted' }, 'Markdown · 预览中的引用是可点标记')),
                h('div', {
                  className: 'litkb-writePanes is-' + mode,
                  ref: paneRef,
                  style: mode === 'split' ? { gridTemplateColumns: `${splitRatio}% 6px minmax(0,1fr)` } : undefined,
                },
                  mode !== 'preview'
                    ? h('textarea', {
                        ref: textRef, className: 'litkb-input litkb-writeArea',
                        value: body, placeholder: '从这里开始写。\n\n右栏搜索证据 → 插入引用；也可以在论文证据旁点「引用」。',
                        onChange: (e) => { setBody(e.target.value); dirtyRef.current = true; setStatus('未保存') },
                      })
                    : null,
                  mode === 'split'
                    ? h('div', {
                        className: 'litkb-resizer litkb-writeSplitter', role: 'separator', 'aria-orientation': 'vertical',
                        title: '拖动调整编辑 / 预览宽度', onMouseDown: startSplitResize,
                      })
                    : null,
                  mode !== 'edit'
                    ? h('div', { className: 'litkb-mdPreview' },
                        body.trim()
                          ? renderMarkdown(body, { onOpenPaper: openCitation })
                          : h('span', { className: 'litkb-muted' }, '（空文稿）'))
                    : null),
                h('div', { className: 'litkb-writeFoot' },
                  h('span', { className: 'litkb-muted' }, `${chars} 字 · ${citations.length} 引用`),
                  h('span', { className: 'litkb-spacer' }),
                  h('span', { className: 'litkb-muted' }, draft.id)))
            : h('div', { className: 'litkb-writeEmpty' },
                h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '✎'),
                h('div', { className: 'litkb-emptyTitle' }, '还没有文稿'),
                h('p', { className: 'litkb-emptyText' }, '新建一篇，写研究现状；从右栏或论文证据插入引用。'),
                err ? h('div', { className: 'litkb-error' }, err) : null,
                notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
                h('button', { type: 'button', className: 'litkb-btn', onClick: create }, '新建文稿'))),
        h('div', {
          className: 'litkb-resizer litkb-writeResizer', role: 'separator', 'aria-orientation': 'vertical',
          title: '拖动调整引用栏宽度', onMouseDown: (event) => startWriteResize('rail', event),
        }),
        h('aside', { className: 'litkb-writeRail' },
          h('div', { className: 'litkb-writeTabs' },
            h('button', {
              type: 'button', className: 'litkb-writeTab' + (rightTab === 'citations' ? ' is-on' : ''),
              onClick: () => setRightTab('citations'),
            }, '引用库'),
            h('button', {
              type: 'button', className: 'litkb-writeTab' + (rightTab === 'refs' ? ' is-on' : ''),
              onClick: () => setRightTab('refs'),
            }, `参考文献 ${references.length}`)),
          rightTab === 'citations'
            ? h('div', { className: 'litkb-writeRailBody' },
                h('input', {
                  className: 'litkb-input', placeholder: '搜引文 / 论文标题…',
                  value: query, onChange: (e) => setQuery(e.target.value),
                }),
                h('input', {
                  className: 'litkb-input', placeholder: 'AI 扩写意图（可选）…',
                  value: assistIntent, onChange: (e) => setAssistIntent(e.target.value),
                }),
                h('div', { className: 'litkb-railHint' }, '选中一条证据 →「AI 扩写」会按上面的意图生成，并插入正文。'),
                searching ? h('div', { className: 'litkb-muted' }, '搜索中…') : null,
                results.length
                  ? results.map(searchRow)
                  : h('div', { className: 'litkb-muted' }, query ? '没有匹配证据' : '暂无可引用证据'))
            : h('div', { className: 'litkb-writeRailBody' },
                  missing.length
                    ? h('div', { className: 'litkb-error' }, `缺失证据 ${missing.length} 条`)
                    : null,
                  references.length
                    ? references.map((ref) => h('div', { key: ref.paperId, className: 'litkb-refRow' },
                        h('span', { className: 'litkb-refNo' }, `[${ref.index}]`),
                        h('span', { className: 'litkb-refText' }, ref.text)))
                    : h('div', { className: 'litkb-muted' }, '正文还没有引用'))))
    }

    /* ---------------- 证据链弹窗（P4.10 / v0.17.0） ---------------- */
