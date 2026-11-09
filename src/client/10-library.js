    function Entry() {
      const open = useOpen()
      return h('button', {
        type: 'button',
        className: 'litkb-entry' + (open ? ' is-on' : ''),
        title: '文献工作台',
        onClick: () => setOpen(!open),
      },
      h('span', { className: 'litkb-entryIcon', 'aria-hidden': 'true' }, '▤'),
      h('span', { className: 'litkb-entryText' }, '文献工作台'))
    }

    function LitkbIcon({ size = 18, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 2 : 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', style: { display: 'block' },
      },
      h('path', { d: 'M5 4.5A2.5 2.5 0 0 1 7.5 2H20v20H7.5A2.5 2.5 0 0 1 5 19.5v-15Z' }),
      h('path', { d: 'M9 2v20' }),
      h('path', { d: 'M13 6h4M13 10h4M13 14h4' }))
    }

    function LibraryPage() {
      return h(Workspace, { embedded: true })
    }

    function LitkbSettings({ initial = null }) {
      const [snapshot, setSnapshot] = useState(initial)
      const [token, setToken] = useState('')
      const [model, setModel] = useState('PaddleOCR-VL-1.6')
      const [enabled, setEnabled] = useState(true)
      const [saving, setSaving] = useState(false)
      const [err, setErr] = useState('')
      const [notice, setNotice] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await api('/api/litkb/settings')
          setSnapshot(data)
          setModel(data.settings?.paddle?.model || 'PaddleOCR-VL-1.6')
          setEnabled(data.settings?.paddle?.enabled !== false)
          setErr('')
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      useEffect(() => { load() }, [load])

      const save = async () => {
        setSaving(true)
        setErr('')
        setNotice('')
        try {
          const paddle = { model: model.trim() || 'PaddleOCR-VL-1.6', enabled }
          if (token.trim()) paddle.token = token.trim()
          const data = await api('/api/litkb/settings', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paddle }),
          })
          setSnapshot((prev) => ({ ...prev, settings: data.settings, llm: data.llm || prev?.llm }))
          setToken('')
          setNotice('已保存')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      if (!snapshot) {
        return h('div', { className: 'litkb-settingsPage' },
          err ? h('div', { className: 'litkb-error' }, err) : h('div', { className: 'litkb-muted' }, '加载中…'))
      }

      const settings = snapshot.settings || {}
      const paddle = settings.paddle || {}
      const llm = snapshot.llm || {}
      const route = llm.route
      return h('div', { className: 'litkb-settingsPage' },
        h('section', { className: 'litkb-settingsSection' },
          h('div', { className: 'litkb-settingsTitle' }, '文献工作台'),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '库路径'),
            h('code', { className: 'litkb-settingsCode' }, settings.library || '—')),
          h('div', { className: 'litkb-settingsHint' },
            '修改库路径请设置环境变量 LITKB_LIBRARY 后重启 DSH；P4 暂不做运行中切库。')),
        h('section', { className: 'litkb-settingsSection' },
          h('div', { className: 'litkb-settingsTitle' }, 'PaddleOCR'),
          h('div', { className: 'litkb-settingsHint' },
            '用于版面块解析；令牌只存本地库 settings.json（0600），不回传。',
            h('a', {
              className: 'litkb-link', href: 'https://aistudio.baidu.com/paddleocr',
              target: '_blank', rel: 'noreferrer',
            }, ' 获取令牌')),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '访问令牌'),
            h('input', {
              className: 'litkb-input', type: 'password', autoComplete: 'off',
              placeholder: paddle.configured ? '已配置，留空则不修改' : '粘贴 PaddleOCR access token',
              value: token, onChange: (e) => setToken(e.target.value),
            })),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '模型'),
            h('input', {
              className: 'litkb-input', value: model,
              placeholder: 'PaddleOCR-VL-1.6',
              onChange: (e) => setModel(e.target.value),
            })),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '启用'),
            h('label', { className: 'litkb-settingsCheck' },
              h('input', { type: 'checkbox', checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
              enabled ? ' 已启用' : ' 已停用（改用 pdf.js 兜底）')),
          h('div', { className: 'litkb-settingsHint' },
            paddle.source === 'env' ? '当前令牌来自环境变量 PADDLEOCR_ACCESS_TOKEN，页面写入不会覆盖它。' : '')),
        h('section', { className: 'litkb-settingsSection' },
          h('div', { className: 'litkb-settingsTitle' }, '模型'),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '当前模型'),
            h('span', { className: 'litkb-settingsValue' },
              route ? `${route.provider} / ${route.model}` : (llm.available ? '宿主未选择默认模型' : '宿主未提供模型服务'))),
          h('div', { className: 'litkb-settingsHint' },
            '分类、七段卡、翻译、追问都走宿主默认模型；在 DSH「设置 → 模型」里更换。')),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        h('div', { className: 'litkb-settingsActions' },
          h('button', { type: 'button', className: 'litkb-btn', disabled: saving, onClick: save },
            saving ? '保存中…' : '保存设置'),
          notice ? h('span', { className: 'litkb-glossNotice' }, notice) : null))
    }

    function Workspace({ embedded = false }) {
      const open = useOpen()
      const active = embedded || open
      const [tab, setTab] = useState('个人工作台')
      const [filter, setFilter] = useState('全部')
      const [query, setQuery] = useState('')
      const [papers, setPapers] = useState([])
      const [stats, setStats] = useState({ total: 0, untagged: 0 })
      const [library, setLibrary] = useState('')
      const [tags, setTags] = useState([])
      const [types, setTypes] = useState([])
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(null)
      const [selected, setSelected] = useState(null)
      const [pdfView, setPdfView] = useState(null)
      const [askSelection, setAskSelection] = useState(null)
      const [cardRevision, setCardRevision] = useState(0)
      const [insertRequest, setInsertRequest] = useState(null)
      const [writingFocus, setWritingFocus] = useState(null)
      const [libraryView, setLibraryView] = useState('论文')
      const [autoChain, setAutoChain] = useState(null)
      const [linkOpen, setLinkOpen] = useState(false)
      const [linkValue, setLinkValue] = useState('')
      const [linkKind, setLinkKind] = useState('auto')
      const [linkBusy, setLinkBusy] = useState(false)
      const [linkError, setLinkError] = useState('')
      const [chainDialog, setChainDialog] = useState(null)
      const [chainRevision, setChainRevision] = useState(0)
      const [managing, setManaging] = useState(false)
      const [results, setResults] = useState(null)
      const [showResults, setShowResults] = useState(false)
      const [toast, setToast] = useState(null)
      const [dragging, setDragging] = useState(false)
      const [panelWidth, setPanelWidth] = useState(0)
      const [hostTheme, setHostTheme] = useState('light')
      const [railDrawer, setRailDrawer] = useState(false)
      const [listDrawer, setListDrawer] = useState(false)
      const [leftWidth, setLeftWidth] = useState(() => storedWidth('litkb.listWidth', 320))
      const [rightWidth, setRightWidth] = useState(() => {
        const saved = storedWidth('litkb.pdfWidth', 520)
        return saved < 460 ? 520 : saved
      })
      const fileRef = useRef(null)
      const splitRef = useRef(null)

      const load = useCallback(async () => {
        setLoading(true)
        try {
          const [data, tagData] = await Promise.all([api('/api/litkb/papers'), api('/api/litkb/tags')])
          setPapers(data.papers || [])
          setStats(data.stats || {})
          setLibrary(data.library || '')
          setTags(tagData.tags || [])
          setTypes(tagData.types || [])
          setError('')
        } catch (err) {
          setError(String(err.message || err))
        } finally {
          setLoading(false)
        }
      }, [])

      const refreshCard = useCallback(() => {
        setCardRevision((value) => value + 1)
        load()
      }, [load])

      useEffect(() => { if (active) load() }, [active, load])

      useEffect(() => {
        if (!active) return undefined
        const onKey = (e) => {
          if (e.key !== 'Escape') return
          if (linkOpen) setLinkOpen(false)
          else if (listDrawer) setListDrawer(false)
          else if (railDrawer) setRailDrawer(false)
          else if (pdfView) setPdfView(null)
          else if (selected) setSelected(null)
          else if (managing) setManaging(false)
          else if (!embedded) setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [active, embedded, selected, managing, pdfView, railDrawer, listDrawer, linkOpen])

      useEffect(() => {
        if (!selected) { setPdfView(null); return }
        setPdfView((prev) => (prev?.paper?.id === selected.id
          ? prev
          : { paper: selected, page: 1, blockId: null, nonce: Date.now() }))
      }, [selected])

      useEffect(() => { setAskSelection(null); setRailDrawer(false); setListDrawer(false) }, [selected?.id])

      useEffect(() => {
        const element = splitRef.current
        if (!element) return undefined
        if (typeof ResizeObserver === 'undefined') {
          setPanelWidth(window.innerWidth || 0)
          return undefined
        }
        const observer = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect?.width || 0
          if (width) setPanelWidth(width)
        })
        observer.observe(element)
        return () => observer.disconnect()
      }, [tab])

      const startResize = (side, event) => {
        event.preventDefault()
        const startX = event.clientX
        const startLeft = leftWidth
        const startRight = rightWidth
        const total = splitRef.current?.clientWidth || window.innerWidth || 1200
        let last = side === 'left' ? startLeft : startRight
        const move = (e) => {
          const delta = e.clientX - startX
          if (side === 'left') {
            const max = Math.max(240, Math.min(420, total - startRight - 400))
            last = Math.max(240, Math.min(max, startLeft + delta))
            setLeftWidth(last)
          } else {
            const max = Math.max(320, Math.min(820, total - startLeft - 400))
            last = Math.max(320, Math.min(max, startRight - delta))
            setRightWidth(last)
          }
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          try {
            window.localStorage?.setItem(side === 'left' ? 'litkb.listWidth' : 'litkb.pdfWidth', String(Math.round(last)))
          } catch { /* 本地存储不可用时忽略 */ }
        }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      const importOne = useCallback(async (file) => {
        const base = { key: `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, file, name: file.name }
        try {
          const buffer = await file.arrayBuffer()
          const res = await fetch('/api/litkb/import', {
            method: 'POST',
            headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent(file.name) },
            body: buffer,
          })
          const body = await res.json().catch(() => ({}))
          if (body.ok && body.duplicate) {
            return { ...base, status: 'duplicate', paper: body.paper, reason: '文件已在库中，未重复入库' }
          }
          if (body.ok) {
            return { ...base, status: 'added', paper: body.paper, warning: body.warning, reason: body.warningText || '' }
          }
          return { ...base, status: 'failed', code: body.code || 'server_error', reason: body.error || '导入失败' }
        } catch (e) {
          return { ...base, status: 'failed', code: 'network', reason: '网络或服务异常' }
        }
      }, [])

      const runImport = useCallback(async (fileList) => {
        const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name))
        if (!files.length) {
          setToast({ kind: 'warn', title: '没有可导入的文件', detail: '只支持 .pdf' })
          return
        }
        setBusy({ done: 0, total: files.length })
        const items = []
        for (let i = 0; i < files.length; i += 1) {
          items.push(await importOne(files[i]))
          setBusy({ done: i + 1, total: files.length })
        }
        setBusy(null)
        setResults(items)
        const added = items.filter((x) => x.status === 'added').length
        const dup = items.filter((x) => x.status === 'duplicate').length
        const failed = items.filter((x) => x.status === 'failed').length
        if (files.length === 1) {
          const it = items[0]
          if (it.status === 'added') {
            setToast({ kind: it.warning ? 'warn' : 'ok', title: it.warning ? '已导入（质量偏低）' : '已导入', detail: it.paper?.title || it.name, action: 'open', paper: it.paper })
          } else if (it.status === 'duplicate') {
            setToast({ kind: 'warn', title: '已在库中', detail: `${it.paper?.title || it.name} · 未重复入库`, action: 'open', paper: it.paper })
          } else {
            setToast({ kind: 'err', title: '导入失败', detail: it.reason, action: 'results' })
          }
        } else {
          setToast({
            kind: failed ? 'err' : dup ? 'warn' : 'ok',
            title: `成功 ${added} · 重复 ${dup} · 失败 ${failed}`,
            detail: failed ? '点「查看」看失败原因' : '',
            action: 'results',
          })
        }
        await load()
        setFilter('全部')
        goLibrary()
      }, [importOne, load])

      const retryItem = useCallback(async (item) => {
        const next = await importOne(item.file)
        setResults((prev) => (prev || []).map((x) => (x.key === item.key ? next : x)))
        if (next.status === 'failed') setToast({ kind: 'err', title: '仍然失败', detail: next.reason, action: 'results' })
        else setToast({ kind: 'ok', title: '重试成功', detail: next.paper?.title || next.name, action: 'open', paper: next.paper })
        await load()
      }, [importOne, load])

      const onDrop = useCallback((e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer?.files?.length) runImport(e.dataTransfer.files)
      }, [runImport])

      useEffect(() => {
        if (!toast) return undefined
        const t = setTimeout(() => setToast(null), 8000)
        return () => clearTimeout(t)
      }, [toast])

      useEffect(() => {
        const readLuminance = (value) => {
          const parts = String(value || '').match(/\d+(?:\.\d+)?/g)
          if (!parts || parts.length < 3) return null
          if (parts.length >= 4 && Number(parts[3]) === 0) return null
          return (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255
        }
        const detect = () => {
          try {
            const body = document.body
            const root = document.documentElement
            let luminance = readLuminance(getComputedStyle(body).backgroundColor)
            if (luminance === null) luminance = readLuminance(getComputedStyle(root).backgroundColor)
            if (luminance !== null) { setHostTheme(luminance > 0.55 ? 'light' : 'dark'); return }
            const textLuminance = readLuminance(getComputedStyle(body).color)
            if (textLuminance !== null) setHostTheme(textLuminance > 0.55 ? 'dark' : 'light')
          } catch { /* keep default light */ }
        }
        detect()
        let observer = null
        if (typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(detect)
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
          if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        }
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
        if (media?.addEventListener) media.addEventListener('change', detect)
        return () => {
          if (observer) observer.disconnect()
          if (media?.removeEventListener) media.removeEventListener('change', detect)
        }
      }, [])

      if (!active) return null

      const needle = query.trim().toLowerCase()
      const searched = needle
        ? papers.filter((p) => `${p.title || ''} ${p.authors || ''} ${p.venue || ''} ${(p.topics || []).join(' ')} ${p.doi || ''}`.toLowerCase().includes(needle))
        : papers
      const untagged = searched.filter((p) => !(p.topics || []).length)
      const filterCounts = { 全部: papers.length, 未归类: papers.filter((p) => !(p.topics || []).length).length }
      for (const status of STATUS) filterCounts[status] = papers.filter((p) => (p.status || '待读') === status).length
      const shown = filter === '全部'
        ? searched
        : filter === '未归类'
          ? untagged
          : searched.filter((p) => (p.status || '待读') === filter)
      const tagNames = tags.map((t) => t.name)
      const splitTab = tab === '论文库' && libraryView === '论文'
      const showList = !splitTab || !panelWidth || panelWidth >= 1260
      const narrow = splitTab && panelWidth > 0 && panelWidth < 980
      const reader = selected && shown.some((p) => p.id === selected.id) ? selected : null
      const showRail = Boolean(reader) && !narrow
      const listView = h(PaperList, {
        papers: shown, loading, filter, onFilter: setFilter, filterCounts,
        emptyText: needle ? `没有匹配「${query.trim()}」的论文` : (filter === '全部' ? '还没有论文，点右上角导入或把 PDF 拖进来' : `没有「${filter}」论文`),
        emptyDesc: needle ? '换个关键词，或清空搜索。' : (filter === '全部' ? '支持多选；中文 PDF 与扫描件会做质量评分。' : '换个筛选条件，或导入新论文。'),
        onOpen: (paper) => { setSelected(paper); setManaging(false); setListDrawer(false) }, onImport: () => fileRef.current?.click(),
        onAutoChain: (paper) => setAutoChain({ paperId: paper.id, paperTitle: paper.title || '', reviewOnly: false }),
        onReview: () => setAutoChain({ paperId: '', paperTitle: '', reviewOnly: true }),
        onManage: () => setManaging(true),
        toolbar: true,
        selectedId: reader?.id,
      })
      const openPdf = (paper, page, blockId, blockIds = []) => {
        setPdfView({ paper, page, blockId, blockIds, nonce: Date.now() })
        if (narrow) setRailDrawer(true)
      }
      const goLibrary = () => { setTab('论文库'); setLibraryView('论文') }
      const openWriting = (payload) => {
        setWritingFocus(payload || null)
        setTab('写作')
      }
      const paperActions = {
        tags: tagNames,
        types,
        cardRevision,
        onSaved: (paper) => { setSelected(paper); refreshCard() },
        refresh: refreshCard,
        onOpenPdf: (pid, page, blockId) => {
          const target = papers.find((paper) => paper.id === pid)
          if (!target) return
          setSelected(target)
          goLibrary()
          openPdf(target, page || 1, blockId)
        },
        onCite: (request) => { setInsertRequest(request); openWriting() },
        onBuildChain: (request) => setChainDialog({ ...request, nonce: Date.now() }),
      }
      const railPage = pdfView && pdfView.paper?.id === reader?.id ? pdfView.page : 1
      const railBlock = pdfView && pdfView.paper?.id === reader?.id ? pdfView.blockId : null
      const railBlockIds = pdfView && pdfView.paper?.id === reader?.id ? (pdfView.blockIds || []) : []
      const pdfWidth = showList
        ? rightWidth
        : Math.max(320, Math.min(rightWidth, (panelWidth || 1200) - 432))
      const splitStyle = {
        gridTemplateColumns: !showList
          ? (showRail ? `minmax(0,1fr) 6px ${pdfWidth}px` : 'minmax(0,1fr)')
          : (showRail ? `${leftWidth}px 6px minmax(0,1fr) 6px ${rightWidth}px` : `${leftWidth}px 6px minmax(0,1fr)`),
      }
      const railNode = showRail
        ? h(PdfRail, {
            paper: reader, page: railPage, blockId: railBlock, blockIds: railBlockIds, nonce: pdfView?.nonce,
            askSelection, onClearAsk: () => setAskSelection(null), cardRevision,
            chainRevision,
            onChanged: refreshCard,
            onBuildChain: (request) => setChainDialog({ ...request, nonce: Date.now() }),
            onOpenChain: (id) => setChainDialog({ chainId: id, paperId: reader.id, nonce: Date.now() }),
          })
        : null
      const splitView = h('div', { className: 'litkb-split', ref: splitRef, style: splitStyle },
        showList ? h('div', { className: 'litkb-listPane' }, listView) : null,
        showList ? h('div', {
          className: 'litkb-resizer', role: 'separator', 'aria-orientation': 'vertical',
          title: '拖动调整列表宽度', onMouseDown: (event) => startResize('left', event),
        }) : null,
        h('div', { className: 'litkb-readPane' },
          managing
            ? h(ManagePanel, { tags, onClose: () => setManaging(false), onChanged: load })
            : reader
              ? h(Detail, {
                  paper: reader, tags: tagNames, types, inline: true,
                  onClose: () => {},
                  onSaved: (paper) => { setSelected(paper); refreshCard() },
                  onRefresh: refreshCard,
                  onOpenPdf: (page, blockId, blockIds) => openPdf(reader, page, blockId, blockIds),
                  onAsk: (selection) => setAskSelection(selection),
                  onCite: (request) => { setManaging(false); setInsertRequest(request); openWriting() },
                  onBuildChain: (request) => {
                    setManaging(false)
                    setChainDialog({ ...request, nonce: Date.now() })
                  },
                  cardRevision,
                })
              : h(Empty, {
                  icon: '▤', title: '左边选一篇论文',
                  desc: '卡片、解析稿在中间，原文常驻在右侧；打开解析稿后默认平铺。',
                })),
        showRail
          ? h('div', {
              className: 'litkb-resizer', role: 'separator', 'aria-orientation': 'vertical',
              title: '拖动调整原文宽度', onMouseDown: (event) => startResize('right', event),
            })
          : null,
        railNode)

      const importLink = async () => {
        const value = linkValue.trim()
        if (!value) { setLinkError('请输入链接、DOI 或 arXiv ID'); return }
        setLinkBusy(true)
        setLinkError('')
        try {
          const data = await api('/api/litkb/import/link', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value, kind: linkKind }),
          })
          await load()
          setLinkOpen(false)
          setLinkValue('')
          if (data.paper) setSelected(data.paper)
          setToast({
            kind: data.duplicate ? 'warn' : (data.warning ? 'warn' : 'ok'),
            title: data.duplicate ? '已在库中' : (data.warning ? '已导入（质量偏低）' : '已导入'),
            detail: data.paper?.title || value,
            action: 'open', paper: data.paper,
          })
        } catch (e) {
          setLinkError(String(e.message || e))
        } finally {
          setLinkBusy(false)
        }
      }

      const kpiChip = (tone, value, label, onClick) => {
        const tag = onClick ? 'button' : 'span'
        return h(tag, {
          className: 'litkb-kpi ' + tone + (onClick ? ' is-clickable' : ''),
          type: onClick ? 'button' : undefined,
          onClick,
        }, h('b', {}, String(value)), ' ', label)
      }
      const navIcon = (kind) => {
        const base = {
          width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': 'true',
        }
        if (kind === 'home') {
          return h('svg', base,
            h('path', { d: 'M3 10.5 12 3l9 7.5' }),
            h('path', { d: 'M5 9.5V21h14V9.5' }),
            h('path', { d: 'M9.5 21v-6h5v6' }))
        }
        if (kind === 'library') {
          return h('svg', base,
            h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
            h('path', { d: 'M3 9h18' }),
            h('path', { d: 'M8 13h8' }),
            h('path', { d: 'M8 16.5h5' }))
        }
        return h('svg', base,
          h('path', { d: 'M12 20h9' }),
          h('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }))
      }
      const allTagsCount = Object.keys(stats.byTag || {}).length || tags.length
      const allUntagged = papers.filter((p) => !(p.topics || []).length).length

      return h('div', {
        className: (embedded ? 'litkb-panel' : 'litkb-overlay') + ' litkb-theme-' + hostTheme,
        role: embedded ? 'region' : 'dialog',
        'aria-modal': embedded ? undefined : 'true',
        'aria-label': '文献工作台',
        onMouseDown: embedded ? undefined : (e) => { if (e.target === e.currentTarget) setOpen(false) },
      },
      h('div', {
        className: 'litkb-window litkb-theme-' + hostTheme + (embedded ? ' is-embedded' : '') + (dragging ? ' is-drag' : ''),
        onDragOver: (e) => { e.preventDefault(); setDragging(true) },
        onDragLeave: (e) => { if (e.target === e.currentTarget) setDragging(false) },
        onDrop,
      },
      h('header', { className: 'litkb-head' },
        h('div', { className: 'litkb-headTop' },
          h('div', { className: 'litkb-pageTitle' },
            h('span', { className: 'litkb-brandMark', 'aria-hidden': 'true' }, '文'),
            h('span', { className: 'litkb-title' }, tab === '个人工作台' ? '文献工作台' : tab),
            tab !== '个人工作台'
              ? h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => { setTab('个人工作台'); setWritingFocus(null) },
                }, '← 工作台')
              : null),
          splitTab
            ? h('div', { className: 'litkb-headSearch' },
                h('input', {
                  className: 'litkb-input', type: 'search',
                  placeholder: '搜论文 / 作者 / 标签…', value: query,
                  'aria-label': '搜索论文',
                  onChange: (e) => setQuery(e.target.value),
                }))
            : null,
          h('span', { className: 'litkb-spacer' }),
          splitTab
            ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => fileRef.current?.click() }, '＋ 导入 PDF')
            : null,
          splitTab
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => { setLinkError(''); setLinkOpen(true) } }, '链接 / DOI')
            : null,
          embedded ? null : h('button', {
            type: 'button', className: 'litkb-close', title: '关闭（Esc）', 'aria-label': '关闭',
            onClick: () => setOpen(false),
          }, '×')),
        h('div', { className: 'litkb-headBottom' },
          tab === '论文库'
            ? h('div', { className: 'litkb-subtabs', role: 'tablist' },
                ['论文', '横向精读', '图谱', '检索'].map((view) => h('button', {
                  key: view, type: 'button', role: 'tab', 'aria-selected': libraryView === view,
                  className: 'litkb-subtab' + (libraryView === view ? ' is-on' : ''),
                  onClick: () => { setLibraryView(view); setManaging(false) },
                }, view)))
            : null,
          splitTab && !showList
            ? h('button', {
                type: 'button', className: 'litkb-miniBtn',
                onClick: () => { setListDrawer(true); setRailDrawer(false) },
              }, '论文列表')
            : null,
          splitTab && narrow && reader
            ? h('button', {
                type: 'button', className: 'litkb-miniBtn',
                onClick: () => { setRailDrawer(true); setListDrawer(false) },
              }, '原文与证据')
            : null,
          h('span', { className: 'litkb-spacer' }),
          splitTab
            ? h('div', { className: 'litkb-headKpis' },
                kpiChip('is-blue', stats.total ?? papers.length, '论文', () => setFilter('全部')),
                kpiChip('is-green', stats.cards ?? papers.filter((p) => p.card).length, '卡片'),
                kpiChip('is-amber', stats.untagged ?? allUntagged, '未归类', () => setFilter('未归类')),
                kpiChip('is-violet', allTagsCount, '标签', () => setManaging(true)),
                h('span', { className: 'litkb-kpi is-neutral', title: library }, library ? '库已连接' : '库未初始化'))
            : h('span', { className: 'litkb-headHint' },
                tab === '个人工作台'
                  ? '研究卡片 · 研究总览 / 证据链 / 链详情'
                  : tab === '写作'
                  ? '文稿 · 引用 · 参考文献'
                  : (libraryView === '检索' ? '链优先检索 · 引用可追溯'
                    : (libraryView === '横向精读' ? '跨论文并排 · 差异对比'
                      : (libraryView === '图谱' ? '证据链知识库' : '论文 / 卡片 / 原文')))),
          splitTab && !showList
            ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setManaging(true) }, '标签与术语')
            : null,
          splitTab && !showList
            ? h('select', {
                className: 'litkb-input litkb-filterPick',
                value: filter,
                onChange: (e) => { setFilter(e.target.value); setSelected(null) },
                title: '筛选',
              }, FILTERS.map((name) => h('option', { key: name, value: name }, name)))
            : null,
          splitTab && !showList
            ? h('select', {
                className: 'litkb-input litkb-paperPick',
                value: shown.some((p) => p.id === selected?.id) ? selected.id : '',
                onChange: (e) => { setManaging(false); setSelected(papers.find((p) => p.id === e.target.value) || null) },
                title: '选择论文',
              },
              h('option', { value: '' }, '选择论文'),
              shown.map((p) => h('option', { key: p.id, value: p.id }, p.title || p.id)))
            : null)),
      h('main', { className: 'litkb-body' + (splitTab ? ' is-split' : '') + (tab === '写作' ? ' is-writing' : '') },
        busy ? h('div', { className: 'litkb-progress' }, `正在解析 ${busy.done}/${busy.total} …`) : null,
        error ? h('div', { className: 'litkb-error' }, error) : null,
        h('div', { className: 'litkb-module' + (tab === '个人工作台' ? '' : ' is-hidden') },
          h(ThemePage, {
            papers,
            tags,
            paperActions,
            onOpenPaper: (paperId, page, blockId) => {
              const target = papers.find((paper) => paper.id === paperId)
              if (!target) return
              setFilter('全部')
              setSelected(target)
              goLibrary()
              if (page) openPdf(target, page, blockId)
            },
            onOpenChain: (id) => setChainDialog({ chainId: id, paperId: '', nonce: Date.now() }),
            onOpenDraft: (payload) => openWriting(payload),
            onOpenLibrary: () => goLibrary(),
            onOpenWriting: () => openWriting(null),
            paperCount: papers.length,
          })),
        h('div', { className: 'litkb-module' + (tab === '论文库' ? '' : ' is-hidden') },
          libraryView === '横向精读'
            ? h(ComparePanel, {
                papers,
                onOpenPaper: (paperId, page, blockId) => {
                  const target = papers.find((paper) => paper.id === paperId)
                  if (!target) return
                  setFilter('全部')
                  setSelected(target)
                  goLibrary()
                  if (page) openPdf(target, page, blockId)
                },
                onBuildCompareChain: ({ claim, evidenceIds, paperId, sectionKey }) => setChainDialog({
                  mode: 'evidence', claim, evidenceIds, paperId, sectionKey, nonce: Date.now(),
                }),
                onSaveCompare: async (text, title) => {
                  const data = await api('/api/litkb/drafts', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ title, body: text }),
                  })
                  openWriting({ draftId: data.draft?.id })
                },
              })
            : libraryView === '图谱'
            ? h(GraphPanel, {
                chainRevision,
                onOpenPaper: (id) => { setManaging(false); setFilter('全部'); setSelected(papers.find((p) => p.id === id) || null); goLibrary() },
                onOpenPdf: (paperId, page, blockId) => {
                  const target = papers.find((p) => p.id === paperId)
                  if (target) {
                    setSelected(target)
                    goLibrary()
                    openPdf(target, page, blockId)
                  }
                },
                onOpenChain: (id) => setChainDialog({ chainId: id, paperId: '', nonce: Date.now() }),
                onGoLibrary: goLibrary,
              })
            : libraryView === '检索'
            ? h(SearchPage, {
                papers,
                tags,
                onOpenPaper: (paperId, page, blockId) => {
                  const target = papers.find((paper) => paper.id === paperId)
                  if (!target) return
                  setFilter('全部')
                  setSelected(target)
                  goLibrary()
                  if (page) openPdf(target, page, blockId)
                },
                onOpenChain: (id) => setChainDialog({ chainId: id, paperId: '', nonce: Date.now() }),
                onSaveAnswer: async (text, question) => {
                  const data = await api('/api/litkb/drafts', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ title: `检索：${String(question || '').slice(0, 40)}`, body: text }),
                  })
                  openWriting({ draftId: data.draft?.id })
                  return data.draft
                },
              })
            : splitView),
        h('div', { className: 'litkb-module' + (tab === '写作' ? '' : ' is-hidden') },
          h(WritingPage, {
            insertRequest,
            focus: writingFocus,
            onConsumed: () => setInsertRequest(null),
            onOpenPaper: (paperId, page, blockId) => {
              const target = papers.find((paper) => paper.id === paperId)
              if (!target) return
              setFilter('全部')
              setSelected(target)
              goLibrary()
              if (page) openPdf(target, page, blockId)
            },
          }))),
      h('footer', { className: 'litkb-foot' },
        h('span', { className: 'litkb-dot ' + (error ? 'is-err' : 'is-ok'), 'aria-hidden': 'true' }),
        h('span', { className: 'litkb-health' },
          error ? `出错：${error}` : `库 ${library || '未初始化'} · ${stats.total ?? 0} 篇 · 未归类 ${stats.untagged ?? 0}`),
        h('button', { type: 'button', className: 'litkb-link', onClick: load }, '刷新')),
      h('input', {
        ref: fileRef, type: 'file', accept: 'application/pdf,.pdf', multiple: true,
        style: { display: 'none' },
        onChange: (e) => { runImport(e.target.files); e.target.value = '' },
      }),
      toast ? h(Toast, {
        toast,
        onClose: () => setToast(null),
        onOpen: (p) => { setSelected(p); setToast(null) },
        onResults: () => { setShowResults(true); setToast(null) },
      }) : null,
      showResults && results ? h(ResultsPanel, {
        items: results,
        onClose: () => setShowResults(false),
        onRetry: retryItem,
        onOpen: (p) => { setSelected(p); setShowResults(false) },
      }) : null,
      dragging ? h('div', { className: 'litkb-dropHint' }, '松开导入 PDF') : null,
      listDrawer && !showList
        ? h('div', {
            className: 'litkb-listDrawerWrap',
            role: 'dialog', 'aria-modal': 'true', 'aria-label': '论文列表',
            onMouseDown: (event) => { if (event.target === event.currentTarget) setListDrawer(false) },
          },
          h('aside', { className: 'litkb-listDrawer' },
            h('div', { className: 'litkb-railDrawerBar' },
              h('span', { className: 'litkb-detailTitle' }, '论文列表'),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-close', title: '关闭', onClick: () => setListDrawer(false) }, '×')),
            h('div', { className: 'litkb-listDrawerBody' }, listView)))
        : null,
      railDrawer && railNode
        ? h('div', {
            className: 'litkb-railDrawerWrap',
            role: 'dialog', 'aria-modal': 'true', 'aria-label': '原文与证据',
            onMouseDown: (event) => { if (event.target === event.currentTarget) setRailDrawer(false) },
          },
          h('aside', { className: 'litkb-railDrawer' },
            h('div', { className: 'litkb-railDrawerBar' },
              h('span', { className: 'litkb-detailTitle' }, reader?.title || '原文与证据'),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-close', title: '关闭', onClick: () => setRailDrawer(false) }, '×')),
            railNode))
        : null,
      autoChain
        ? h(AutoChainPanel, {
            contextPaperId: autoChain.paperId || '',
            contextPaperTitle: autoChain.paperTitle || '',
            onClose: () => setAutoChain(null),
            onChanged: () => { load(); setChainRevision((value) => value + 1) },
            onOpenChain: (id) => { setAutoChain(null); setChainDialog({ chainId: id, paperId: '', nonce: Date.now() }) },
          })
        : null,
      linkOpen
        ? h('div', { className: 'litkb-chainModal', onMouseDown: (event) => { if (event.target === event.currentTarget) setLinkOpen(false) } },
            h('div', { className: 'litkb-chainDialog litkb-linkDialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '链接导入' },
              h('div', { className: 'litkb-chainHead' },
                h('div', { className: 'litkb-chainTitle' }, '链接 / DOI 导入'),
                h('span', { className: 'litkb-spacer' }),
                h('button', { type: 'button', className: 'litkb-close', onClick: () => setLinkOpen(false) }, '×')),
              h('div', { className: 'litkb-linkBody' },
                h('div', { className: 'litkb-muted' }, '支持普通 PDF 链接、DOI、arXiv。只接受开放可访问的 PDF；拿不到 PDF 会明确报错。'),
                h('div', { className: 'litkb-linkKinds' },
                  [['auto', '自动识别'], ['url', 'PDF 链接'], ['doi', 'DOI'], ['arxiv', 'arXiv']].map(([value, label]) => h('button', {
                    key: value, type: 'button', className: 'litkb-searchMode' + (linkKind === value ? ' is-on' : ''),
                    onClick: () => setLinkKind(value),
                  }, label))),
                h('input', {
                  className: 'litkb-input', autoFocus: true,
                  placeholder: linkKind === 'doi' ? '10.1016/j.bspc.2026.110893' : (linkKind === 'arxiv' ? '2401.12345 或 arXiv 链接' : 'https://…/paper.pdf 或 DOI'),
                  value: linkValue,
                  onChange: (e) => setLinkValue(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); importLink() } },
                }),
                linkError ? h('div', { className: 'litkb-error' }, linkError) : null,
                h('div', { className: 'litkb-inline' },
                  h('button', { type: 'button', className: 'litkb-btn', disabled: linkBusy, onClick: importLink }, linkBusy ? '下载并解析…' : '导入'),
                  h('span', { className: 'litkb-muted' }, '会做 SHA 去重；解析质量偏低会提示')))),
          )
        : null,
      chainDialog
        ? h(ChainDialog, {
            key: chainDialog.nonce,
            seed: chainDialog,
            paper: reader || papers.find((paper) => paper.id === chainDialog.paperId) || null,
            onClose: () => setChainDialog(null),
            onSaved: () => { setChainRevision((value) => value + 1); refreshCard() },
            onEvidenceChanged: refreshCard,
            onDeleted: () => {
              setChainDialog(null)
              setChainRevision((value) => value + 1)
            },
            onOpenPdf: (paperId, page, blockId) => {
              const target = papers.find((paper) => paper.id === paperId) || reader
              setChainDialog(null)
              if (!target) return
              setSelected(target)
              openPdf(target, page, blockId)
            },
          })
        : null))
    }

    function SkeletonRows({ rows = 4 }) {
      return h('div', { className: 'litkb-skelList' },
        Array.from({ length: rows }, (_, index) => h('div', { key: index, className: 'litkb-skelRow' },
          h('div', { className: 'litkb-skelLine is-title' }),
          h('div', { className: 'litkb-skelLine is-meta' }),
          h('div', { className: 'litkb-skelLine is-tags' }))))
    }

    function PaperList({ papers, loading, emptyText, emptyDesc, onOpen, onImport, onManage, onAutoChain, onReview, toolbar, selectedId, filter = '全部', onFilter, filterCounts = {} }) {
      const rows = papers.map((p) => {
        const status = p.status || '待读'
        const topics = p.topics || []
        return h('div', {
          key: p.id,
          className: 'litkb-row' + (selectedId === p.id ? ' is-active' : ''),
          role: 'button', tabIndex: 0, 'aria-current': selectedId === p.id ? 'true' : undefined,
          onClick: () => onOpen(p),
          onKeyDown: (e) => { if (e.key === 'Enter') onOpen(p) },
        },
        h('div', { className: 'litkb-rowMain' },
          h('div', { className: 'litkb-rowTitleRow' },
            h('span', { className: 'litkb-rowDot', style: { background: STATUS_COLOR[status] || 'var(--litkb-text-3)' }, 'aria-hidden': 'true' }),
            h('span', { className: 'litkb-rowTitle' }, p.title || '(未命名)'),
            p.card
              ? h('span', {
                  className: 'litkb-rowCardMark',
                  title: `七段卡：${p.card.status === 'ready' ? '完整' : '部分'} · 证据 ${p.card.evidence || 0} 条`,
                })
              : null),
          h('div', { className: 'litkb-rowMeta' },
            [p.venue, p.year, p.authors].filter(Boolean).join(' · ') || '元数据缺失'),
          h('div', { className: 'litkb-rowTags' },
            h('span', { className: 'litkb-chip is-type' }, p.type || '学术期刊'),
            topics.slice(0, 2).map((t) => h('span', { key: t, className: 'litkb-chip is-tag tone-' + tagTone(t) }, t)),
            topics.length > 2 ? h('span', { className: 'litkb-rowMore' }, `+${topics.length - 2}`) : null)),
        h('div', { className: 'litkb-rowRight' },
          onAutoChain || onReview
            ? h('div', { className: 'litkb-rowActions' },
                onAutoChain ? h('button', {
                  type: 'button', className: 'litkb-rowAct',
                  onClick: (event) => { event.stopPropagation(); onAutoChain(p) },
                }, '自动建链') : null,
                onReview ? h('button', {
                  type: 'button', className: 'litkb-rowAct',
                  onClick: (event) => { event.stopPropagation(); onReview() },
                }, '审核') : null)
            : null,
          h('span', { className: 'litkb-statusPill', style: { color: STATUS_COLOR[status] || undefined } }, status)))
      })

      return h('div', { className: 'litkb-listWrap' },
        h('div', { className: 'litkb-filters', role: 'tablist' },
          FILTERS.map((name) => h('button', {
            key: name, type: 'button', role: 'tab', 'aria-selected': filter === name,
            className: 'litkb-filter' + (filter === name ? ' is-on' : ''),
            onClick: () => onFilter && onFilter(name),
          }, name, filterCounts[name] ? h('span', { className: 'litkb-filterCount' }, filterCounts[name]) : null))),
        toolbar ? h('div', { className: 'litkb-toolbar' },
          h('span', { className: 'litkb-muted' },
            `${papers.length} 篇 · ${papers.filter((p) => p.card).length} 张七段卡`),
          h('span', { className: 'litkb-spacer' }),
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: '/api/litkb/export?format=bibtex', download: 'litkb.bib',
          }, 'BibTeX'),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: onManage }, '标签与术语')) : null,
        loading && !papers.length
          ? h(SkeletonRows, { rows: 5 })
          : papers.length === 0
            ? h(Empty, { icon: '▤', title: emptyText, desc: emptyDesc })
            : h('div', { className: 'litkb-table' }, rows))
    }

    /* ---------------- 详情（资料 / 七段卡） ---------------- */
    function Detail({ paper, tags, types, onClose, onSaved, onRefresh, onOpenPdf, onAsk, onCite, onBuildChain, cardRevision = 0, inline = false, initialView = '' }) {
      const [view, setView] = useState(initialView || (inline ? 'card' : 'info'))
      const [form, setForm] = useState({
        title: paper.title || '',
        year: paper.year ?? '',
        type: paper.type || '学术期刊',
        topics: [...(paper.topics || [])],
      })
      const [newTag, setNewTag] = useState('')
      const [saving, setSaving] = useState(false)
      const [err, setErr] = useState('')

      useEffect(() => {
        setForm({
          title: paper.title || '',
          year: paper.year ?? '',
          type: paper.type || '学术期刊',
          topics: [...(paper.topics || [])],
        })
        setNewTag('')
        setErr('')
        if (initialView) setView(initialView)
      }, [paper.id, initialView])

      const toggle = (value) => setForm((f) => ({
        ...f,
        topics: f.topics.includes(value) ? f.topics.filter((v) => v !== value) : [...f.topics, value],
      }))

      const save = async (extraTopics) => {
        setSaving(true)
        setErr('')
        try {
          const patch = {
            title: form.title,
            year: form.year === '' ? null : Number(form.year),
            type: form.type,
            topics: extraTopics || form.topics,
            edited: true,
          }
          const body = { id: paper.id, patch }
          const res = await api('/api/litkb/update', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          })
          onSaved(res.paper)
          if (onRefresh) onRefresh()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      const createAndTag = async () => {
        const name = newTag.trim()
        if (!name) return
        try {
          await api('/api/litkb/tags/create', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, keywords: [] }),
          })
          const next = [...form.topics, name]
          setForm({ ...form, topics: next })
          setNewTag('')
          await save(next)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const allTags = [...new Set([...tags, ...form.topics])]
      const tab = (label, key) => h('button', {
        type: 'button', className: 'litkb-dtab' + (view === key ? ' is-on' : ''),
        onClick: () => setView(key),
      }, label)

      const infoBody = h('div', { className: 'litkb-drawerBody' },
        err ? h('div', { className: 'litkb-error' }, err) : null,
        field('标题', h('input', {
          className: 'litkb-input', value: form.title,
          onChange: (e) => setForm({ ...form, title: e.target.value }),
        })),
        h('div', { className: 'litkb-grid2' },
          field('年份', h('input', {
            className: 'litkb-input', type: 'number', value: form.year,
            onChange: (e) => setForm({ ...form, year: e.target.value }),
          })),
          field('大类', h('select', {
            className: 'litkb-input', value: form.type,
            onChange: (e) => setForm({ ...form, type: e.target.value }),
          }, types.map((t) => h('option', { key: t, value: t }, t))))),
        field('主题标签（可多选）', h('div', { className: 'litkb-chips' },
          allTags.map((t) => h('button', {
            key: t, type: 'button',
            className: 'litkb-chip is-select is-tag tone-' + tagTone(t) + (form.topics.includes(t) ? ' is-on' : ''),
            onClick: () => toggle(t),
          }, t)))),
        h('div', { className: 'litkb-inline' },
          h('input', {
            className: 'litkb-input', placeholder: '新建标签并打上…', value: newTag,
            onChange: (e) => setNewTag(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') createAndTag() },
          }),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: createAndTag }, '新建')),
        h('div', { className: 'litkb-metaBlock' },
          metaLine('DOI', paper.doi || '—'),
          metaLine('期刊/会议', paper.venue || '—'),
          metaLine('页数 / 字符', `${paper.pages ?? '—'} / ${paper.chars ?? '—'}`),
          metaLine('解析质量', String(paper.quality ?? '—')),
          metaLine('原始文件', paper.originalName || '—')))

      const head = h('div', { className: 'litkb-drawerHead litkb-detailHead' },
        h('div', { className: 'litkb-detailTop' },
          h('div', { className: 'litkb-detailHeadMain' },
            h('div', { className: 'litkb-detailTitle', title: paper.title }, paper.title || '文献详情'),
            h('div', { className: 'litkb-detailMeta' },
              [paper.authors, paper.year, paper.venue, paper.type].filter(Boolean).join(' · ') || '元数据缺失')),
          h('span', { className: 'litkb-spacer' }),
          h('span', { className: 'litkb-statusPill', style: { color: STATUS_COLOR[paper.status || '待读'] || undefined } }, paper.status || '待读'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenPdf && onOpenPdf(1) }, '打开原文'),
          inline ? null : h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
        h('div', { className: 'litkb-drawerTabs' },
          tab('详情', 'info'), tab('七段卡', 'card'), tab('精读', 'deep'), tab('原文解析', 'parse')))
      const body = view === 'info'
        ? infoBody
        : view === 'card'
          ? h('div', { className: 'litkb-drawerBody' }, h(CardPanel, { key: paper.id, paper, onChanged: onRefresh, onOpenPdf, onAsk, onCite, cardRevision }))
          : view === 'deep'
            ? h('div', { className: 'litkb-drawerBody' }, h(DeepReadPanel, { key: paper.id, paper, onOpenPdf, onBuildChain }))
            : h('div', { className: 'litkb-drawerBody is-flush' }, h(ParsePanel, { key: paper.id, paper, onOpenPdf, onLocate: (page, blockId, blockIds) => onOpenPdf(page, blockId, blockIds), onAsk, onBuildChain, onDeep: () => setView('deep'), flat: inline }))
      const foot = view === 'info'
        ? h('div', { className: 'litkb-drawerFoot' },
            h('button', { type: 'button', className: 'litkb-btn', disabled: saving, onClick: () => save() },
              saving ? '保存中…' : '保存修改'),
            inline ? null : h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: onClose }, '关闭'))
        : null

      if (inline) return h('div', { className: 'litkb-detailInline' }, head, body, foot)

      return h('div', { className: 'litkb-drawerWrap', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('aside', { className: 'litkb-drawer' + (view !== 'info' ? ' is-wide' : ''), role: 'dialog', 'aria-label': '文献详情' },
          head, body, foot))
    }

    function DeepReadPanel({ paper, onOpenPdf, onBuildChain }) {
      const [deepread, setDeepread] = useState(null)
      const [job, setJob] = useState(null)
      const [loading, setLoading] = useState(true)
      const [starting, setStarting] = useState(false)
      const [err, setErr] = useState('')
      const [claims, setClaims] = useState([])
      const [claimDraft, setClaimDraft] = useState('')
      const [activeSection, setActiveSection] = useState('')
      const [navHidden, setNavHidden] = useState(false)

      const load = useCallback(async () => {
        const data = await api('/api/litkb/deepread?id=' + encodeURIComponent(paper.id))
        setDeepread(data.deepread || null)
        setJob(data.job || null)
      }, [paper.id])

      useEffect(() => {
        let alive = true
        setLoading(true)
        load()
          .catch((e) => { if (alive) setErr(String(e.message || e)) })
          .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [load])

      useEffect(() => {
        if (!job || (job.status !== 'queued' && job.status !== 'running')) return undefined
        const timer = setInterval(() => { load().catch(() => {}) }, 1600)
        return () => clearInterval(timer)
      }, [job, load])

      useEffect(() => {
        let alive = true
        api('/api/litkb/chains/claims?paperId=' + encodeURIComponent(paper.id))
          .then((data) => { if (alive) setClaims(data.claims || []) })
          .catch(() => { if (alive) setClaims([]) })
        return () => { alive = false }
      }, [paper.id, deepread?.generatedAt])

      useEffect(() => {
        if (deepread?.sections?.length) setActiveSection('deep-sec-' + deepread.sections[0].key)
      }, [deepread?.generatedAt])

      useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return undefined
        const nodes = (deepread?.sections || [])
          .map((section) => document.getElementById('deep-sec-' + section.key))
          .filter(Boolean)
        if (!nodes.length) return undefined
        const observer = new IntersectionObserver((entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          if (visible[0]) setActiveSection(visible[0].target.id)
        }, { rootMargin: '-12% 0px -70% 0px' })
        nodes.forEach((node) => observer.observe(node))
        return () => observer.disconnect()
      }, [deepread?.generatedAt, deepread?.sections?.length])

      const start = async (force = false) => {
        setStarting(true)
        setErr('')
        try {
          const data = await api('/api/litkb/deepread/build', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, force }),
          })
          if (data.deepread) setDeepread(data.deepread)
          if (data.job) setJob(data.job)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setStarting(false)
        }
      }

      const running = job && (job.status === 'queued' || job.status === 'running')
      const jobError = job?.status === 'failed' ? (job.error?.message || '精读失败') : ''
      const buildCustom = () => {
        const text = claimDraft.trim()
        if (!text || !onBuildChain) return
        onBuildChain({
          claim: text, paperId: paper.id, origin: 'claim', source: 'manual',
        })
        setClaimDraft('')
      }
      const markdown = deepread?.markdown || ''
      const hasSections = Array.isArray(deepread?.sections) && deepread.sections.length > 0
      const numbers = deepread?.numbers || []
      const evidenceMap = new Map()
      for (const item of deepread?.evidence || []) evidenceMap.set(item.id, item)
      for (const item of numbers) if (item.evidenceId) evidenceMap.set(item.evidenceId, item)

      if (loading) return h('div', { className: 'litkb-empty' }, h('div', { className: 'litkb-muted' }, '加载精读…'))
      if (!markdown && !hasSections) {
        return h('div', { className: 'litkb-empty litkb-deepEmpty' },
          h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '◎'),
          h('div', { className: 'litkb-emptyTitle' }, '还没有精读'),
          h('p', { className: 'litkb-emptyText' },
            '精读会把论文转述成 11 个板块的 Markdown：文献基本资料、研究内容、方法、样本量、研究时间、图表解析、结论、创新点、局限性、可复刻性、核心要点。'),
          err ? h('div', { className: 'litkb-error' }, err) : null,
          jobError ? h('div', { className: 'litkb-error' }, jobError) : null,
          running
            ? h('div', { className: 'litkb-progress' }, h('span', { className: 'litkb-pulse', 'aria-hidden': 'true' }), job.step || '精读中…')
            : h('button', { type: 'button', className: 'litkb-btn', disabled: starting, onClick: () => start(false) },
                starting ? '提交中…' : '生成精读'))
      }

      const mdOptions = {
        onOpenPage: (page) => onOpenPdf && onOpenPdf(page),
        onOpenCitation: (part) => {
          const hit = evidenceMap.get(part.evidenceId)
          onOpenPdf && onOpenPdf(hit?.page || part.page, hit?.block || null)
        },
      }
      const numbersBlock = numbers.length
        ? h('section', { id: 'deep-sec-numbers', className: 'litkb-deepSec litkb-numAudit' },
            h('div', { className: 'litkb-deepSecTitle' },
              `数值核对（${numbers.filter((item) => item.verified).length}/${numbers.length} 已找到）`),
            h('table', { className: 'litkb-mdTable' },
              h('thead', null, h('tr', null, h('th', null, '数值'), h('th', null, '板块'), h('th', null, '位置'), h('th', null, '原文 / 状态'))),
              h('tbody', null, numbers.map((item, index) => h('tr', { key: index, className: item.verified ? '' : 'is-unverified' },
                h('td', null, item.value),
                h('td', null, item.sectionTitle || ''),
                h('td', null, item.verified
                  ? h('button', { type: 'button', className: 'litkb-evPage', onClick: () => onOpenPdf && onOpenPdf(item.page, item.block) }, `p.${item.page}`)
                  : h('span', { className: 'litkb-numBad' }, '未找到')),
                h('td', { className: 'litkb-numQuote' }, item.verified ? item.quote : '原文中未找到这个数值，需人工核对'))))))
        : null
      const claimsBlock = h('section', { id: 'deep-sec-claims', className: 'litkb-deepSec litkb-chainClaims' },
        h('div', { className: 'litkb-deepSecTitle' }, '论点与证据链'),
        h('div', { className: 'litkb-muted' },
          '挑一句可辩护的论点，系统会挂上同句引用与同页证据；确认后再保存，可插入文稿。'),
        claims.length
          ? claims.slice(0, 10).map((item, index) => h('div', { key: index, className: 'litkb-claimRow' },
              h('div', { className: 'litkb-claimMain' },
                h('span', { className: 'litkb-claimTag' }, item.sectionTitle),
                h('span', { className: 'litkb-claimText' }, item.text)),
              h('button', {
                type: 'button', className: 'litkb-miniBtn', disabled: !onBuildChain,
                onClick: () => onBuildChain && onBuildChain({
                  claim: item.text, paperId: item.paperId || paper.id,
                  sectionKey: item.sectionKey, evidenceIds: item.evidenceIds,
                  pages: item.pages, origin: 'claim', source: 'deepread',
                }),
              }, '用它建链')))
          : h('div', { className: 'litkb-muted' },
              deepread ? '精读里没有切成论点的句子；可在下面手写一句。' : '先生成精读，才有论点候选。'),
        h('div', { className: 'litkb-inline litkb-claimCustom' },
          h('input', {
            className: 'litkb-input', placeholder: '或手写一句论点…', value: claimDraft,
            onChange: (e) => setClaimDraft(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); buildCustom() } },
          }),
          h('button', {
            type: 'button', className: 'litkb-btn litkb-btnGhost',
            disabled: !claimDraft.trim() || !onBuildChain, onClick: buildCustom,
          }, '建链')))

      const jumpTo = (id) => {
        const target = document.getElementById(id)
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        setActiveSection(id)
      }
      const navItems = hasSections
        ? [
            ...deepread.sections.map((section) => ({
              id: 'deep-sec-' + section.key,
              label: `${section.index}. ${section.title}`,
            })),
            numbers.length ? { id: 'deep-sec-numbers', label: `数值核对 ${numbers.filter((item) => item.verified).length}/${numbers.length}` } : null,
            { id: 'deep-sec-claims', label: '论点与证据链' },
          ].filter(Boolean)
        : []

      return h('div', { className: 'litkb-deep' },
        h('div', { className: 'litkb-deepHead' },
          h('div', null,
            h('div', { className: 'litkb-deepTitle' }, '精读'),
            h('div', { className: 'litkb-muted' }, `${deepread.model || ''} · ${formatLocal(deepread.generatedAt).slice(0, 16)} · 已转述，非原文摘抄`)),
          h('span', { className: 'litkb-spacer' }),
          hasSections ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => setNavHidden((value) => !value) }, navHidden ? '显示导航' : '隐藏导航') : null,
          err ? h('span', { className: 'litkb-error' }, err) : null,
          jobError ? h('span', { className: 'litkb-error' }, jobError) : null,
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: starting || running, onClick: () => {
            if (window.confirm('重新精读会覆盖当前 11 板块说明（七段卡与证据保留）。继续？')) start(true)
          } }, starting || running ? '精读中…' : '重新精读')),
        running ? h('div', { className: 'litkb-progress' }, h('span', { className: 'litkb-pulse', 'aria-hidden': 'true' }), job.step || '精读中…') : null,
        hasSections
          ? h('div', { className: 'litkb-deepLayout' + (navHidden ? ' is-nav-hidden' : '') },
              navHidden ? null : h('nav', { className: 'litkb-deepNav', 'aria-label': '精读板块' },
                navItems.map((item) => h('button', {
                  key: item.id, type: 'button',
                  className: 'litkb-deepNavItem' + (activeSection === item.id ? ' is-on' : ''),
                  'aria-current': activeSection === item.id ? 'true' : undefined,
                  onClick: () => jumpTo(item.id),
                }, item.label))),
              h('div', { className: 'litkb-deepMain' },
                deepread.sections.map((section) => h('section', {
                  key: section.key, id: 'deep-sec-' + section.key, className: 'litkb-deepSection',
                },
                h('h3', { className: 'litkb-deepSectionTitle' }, `${section.index}. ${section.title}`),
                h('div', { className: 'litkb-deepSectionBody' }, renderMarkdown(section.markdown || '原文未说明。', mdOptions)))),
                numbersBlock,
                claimsBlock))
          : h('div', null,
              h('div', { className: 'litkb-deepMd' }, renderMarkdown(markdown, mdOptions)),
              numbersBlock,
              claimsBlock))
    }

    /* ---------------- 七段卡 ---------------- */
