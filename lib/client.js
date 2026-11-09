/* eslint-disable */
/* 由 scripts/build-client.mjs 从 src/client/*.js 生成；不要直接编辑本文件。 */
/**
 * dsh-litkb · 客户端插件（P2.1）
 * 大类 + 扁平标签 + 七段卡（生成 / 轮询 / 引文页码 / 重新生成）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-litkb',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    /* ---------------- 全局开关 ---------------- */
    let openState = false
    const listeners = new Set()
    function setOpen(next) {
      openState = next
      for (const fn of listeners) fn(next)
    }
    function useOpen() {
      const [value, setValue] = useState(openState)
      useEffect(() => {
        const fn = (v) => setValue(v)
        listeners.add(fn)
        setValue(openState)
        return () => { listeners.delete(fn) }
      }, [])
      return value
    }

    const TABS = ['个人工作台', '论文库', '写作']
    const CHAIN_RELATIONS = [['supports', '支持'], ['contradicts', '反驳'], ['qualifies', '限定'], ['derives', '推导'], ['compares', '对比']]
    const CHAIN_ORIGIN = { claim: '论点先行', evidence: '证据先行', question: '问题先行', block: '原文段落', topic: '主题建链' }
    const CHAIN_RELATION_LABELS = Object.fromEntries(CHAIN_RELATIONS)
    const CHAIN_KIND_LABELS = { claim: '论点', evidence: '证据', paper: '论文' }
    const STATUS = ['待读', '略读', '精读', '已引用', '弃读']
    const STATUS_COLOR = { 待读: '#8b949e', 略读: '#d29922', 精读: '#3fb950', 已引用: '#a371f7', 弃读: '#f85149' }
    const FILTERS = ['全部', '未归类', ...STATUS]

    function formatLocal(value) {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return String(value || '')
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function shortAuthors(authors) {
      const first = String(authors || '').split(/[,，;；]/)[0].trim()
      return first || 'Anon'
    }

    function citationLabel(paper, page) {
      return `${shortAuthors(paper.authors)} ${paper.year || ''}, p.${page}`
    }

    function tagTone(name) {
      let hash = 0
      for (const ch of String(name || '')) hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0
      return hash % 5
    }

    function storedNumber(key, fallback) {
      try {
        const value = Number(window.localStorage?.getItem(key))
        return Number.isFinite(value) && value > 0 ? value : fallback
      } catch {
        return fallback
      }
    }

    function storedWidth(key, fallback) {
      try {
        const value = Number(window.localStorage?.getItem(key))
        return Number.isFinite(value) && value > 0 ? value : fallback
      } catch {
        return fallback
      }
    }

    async function api(path, options) {
      const res = await fetch(path, options)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        const err = new Error(body.error || `HTTP ${res.status}`)
        err.affected = body.affected
        throw err
      }
      return body
    }


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
      const [maintaining, setMaintaining] = useState('')

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

      const maintain = async (action) => {
        if (maintaining) return
        const confirmText = action === 'rebuild-index'
          ? '重建索引会按论文 id 去重并重写 index.jsonl，继续？'
          : action === 'clear-pages' ? '清理解析缓存后，下次打开解析稿会重新抽取文本，继续？'
            : '清空搜索历史？'
        if (typeof window !== 'undefined' && window.confirm && !window.confirm(confirmText)) return
        setMaintaining(action)
        setNotice('')
        setErr('')
        try {
          const data = await api('/api/litkb/maintenance', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          setNotice(action === 'rebuild-index'
            ? `索引已重建：${data.before} → ${data.after} 条`
            : `已清理 ${data.removed || 0} 项`)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setMaintaining('')
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
        h('section', { className: 'litkb-settingsSection' },
          h('div', { className: 'litkb-settingsTitle' }, '维护'),
          h('div', { className: 'litkb-settingsHint' },
            '索引重建会按论文 id 去重；清理解析缓存只删 text/*.pages.json，不动卡片、证据与译文。'),
          h('div', { className: 'litkb-settingsRow' },
            h('span', { className: 'litkb-settingsLabel' }, '操作'),
            h('div', { className: 'litkb-inline' },
              h('button', { type: 'button', className: 'litkb-miniBtn', disabled: Boolean(maintaining), onClick: () => maintain('rebuild-index') },
                maintaining === 'rebuild-index' ? '重建中…' : '重建索引'),
              h('button', { type: 'button', className: 'litkb-miniBtn', disabled: Boolean(maintaining), onClick: () => maintain('clear-pages') },
                maintaining === 'clear-pages' ? '清理中…' : '清理解析缓存'),
              h('button', { type: 'button', className: 'litkb-miniBtn', disabled: Boolean(maintaining), onClick: () => maintain('clear-history') },
                maintaining === 'clear-history' ? '清理中…' : '清空搜索历史')))),
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
                papers,
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
                }, '审核队列') : null)
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

      const commentSelection = async (selection) => {
        const text = typeof window !== 'undefined' && window.prompt
          ? window.prompt('评论这句话（会作为批注并生成一条可入链的证据）：')
          : ''
        if (!text || !text.trim()) return
        try {
          await api('/api/litkb/card/annotate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: paper.id, text: text.trim(),
              quote: selection.text, page: selection.page, block: selection.blockId,
            }),
          })
          onRefresh && onRefresh()
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

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
            : h('div', { className: 'litkb-drawerBody is-flush' }, h(ParsePanel, { key: paper.id, paper, onOpenPdf, onLocate: (page, blockId, blockIds) => onOpenPdf(page, blockId, blockIds), onAsk, onComment: commentSelection, onBuildChain, onDeep: () => setView('deep'), flat: inline }))
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

    function progressLine(job) {
      return h('div', { className: 'litkb-progress' },
        h('span', { className: 'litkb-pulse', 'aria-hidden': 'true' }),
        `${job.status === 'queued' ? '排队中' : '生成中'}：${job.step || ''}`)
    }

    function CardPanel({ paper, onChanged, onOpenPdf, onAsk, onCite, cardRevision = 0 }) {
      const [card, setCard] = useState(null)
      const cardRef = useRef(null)
      const [job, setJob] = useState(null)
      const [llm, setLlm] = useState(null)
      const [pdfMissing, setPdfMissing] = useState(false)
      const [loading, setLoading] = useState(true)
      const [starting, setStarting] = useState(false)
      const [err, setErr] = useState('')
      const [editKey, setEditKey] = useState('')
      const [editText, setEditText] = useState('')
      const [savingEdit, setSavingEdit] = useState(false)
      const [noteText, setNoteText] = useState('')
      const [savingNote, setSavingNote] = useState(false)
      const [versions, setVersions] = useState([])
      const [versionsOpen, setVersionsOpen] = useState(false)
      const [versionBusy, setVersionBusy] = useState(false)
      const [status, setStatus] = useState(paper.status || '待读')
      const [statusBusy, setStatusBusy] = useState(false)
      const [expanded, setExpanded] = useState({})
      const [selHint, setSelHint] = useState(null)

      const load = useCallback(async () => {
        try {
          const data = await api('/api/litkb/card?id=' + encodeURIComponent(paper.id))
          if (data.card && !cardRef.current && onChanged) onChanged()
          cardRef.current = data.card || cardRef.current
          setCard(data.card || null)
          setJob(data.job || null)
          setLlm(data.llm || null)
          setPdfMissing(Boolean(data.pdfMissing))
          setErr('')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, [paper.id, onChanged])

      useEffect(() => { load() }, [load, cardRevision])
      useEffect(() => { setStatus(paper.status || '待读') }, [paper.status])

      const running = Boolean(job && (job.status === 'queued' || job.status === 'running'))
      useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(load, 1500)
        return () => clearInterval(timer)
      }, [running, load])

      const generate = async (force) => {
        setStarting(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/generate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, force: !!force }),
          })
          if (data.card) setCard(data.card)
          if (data.job) setJob(data.job)
          else await load()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setStarting(false)
        }
      }

      const startEdit = (section) => {
        setEditKey(section.key)
        setEditText(String(section.text || ''))
        setErr('')
      }

      const saveSection = async (key) => {
        setSavingEdit(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/section', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, key, text: editText }),
          })
          setCard(data.card)
          cardRef.current = data.card
          setEditKey('')
          if (onChanged) onChanged()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSavingEdit(false)
        }
      }

      const regenerateSection = async (key) => {
        setStarting(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/regenerate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, key }),
          })
          if (data.job) setJob(data.job)
          else await load()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setStarting(false)
        }
      }

      const addNote = async () => {
        const text = noteText.trim()
        if (!text) return
        setSavingNote(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/annotate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, text }),
          })
          setCard(data.card)
          cardRef.current = data.card
          setNoteText('')
          if (onChanged) onChanged()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSavingNote(false)
        }
      }

      const openVersions = async () => {
        setVersionBusy(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/versions?id=' + encodeURIComponent(paper.id))
          setVersions(data.versions || [])
          setVersionsOpen(true)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setVersionBusy(false)
        }
      }

      const restoreVersion = async (version) => {
        if (typeof window.confirm === 'function'
          && !window.confirm('恢复这个版本会覆盖当前卡片（当前版本会先进历史）。继续？')) return
        setVersionBusy(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/restore', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, version: version.name }),
          })
          setCard(data.card)
          cardRef.current = data.card
          setVersionsOpen(false)
          if (onChanged) onChanged()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setVersionBusy(false)
        }
      }

      const changeStatus = async (to) => {
        const previous = status
        setStatus(to)
        setStatusBusy(true)
        setErr('')
        try {
          const data = await api('/api/litkb/card/status', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, to }),
          })
          if (data.card) setCard(data.card)
          if (onChanged) onChanged()
        } catch (e) {
          setStatus(previous)
          setErr(String(e.message || e))
        } finally {
          setStatusBusy(false)
        }
      }

      const toggleContext = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

      const captureSelection = (event, section) => {
        if (editKey) return
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
        const text = String(selection?.toString?.() || '').trim()
        if (!text || text.length < 2 || text.length > 1200) return
        const anchor = selection?.anchorNode
        if (anchor && !event.currentTarget.contains(anchor)) return
        const first = (section.evidence || [])
          .map((id) => (card.evidence || []).find((ev) => ev.id === id))
          .find(Boolean)
        let x = 24
        let y = 80
        try {
          const rect = selection.getRangeAt(0).getBoundingClientRect()
          x = Math.min(Math.max(12, rect.left), (window.innerWidth || 900) - 96)
          y = Math.min(Math.max(12, rect.bottom + 8), (window.innerHeight || 700) - 56)
        } catch { /* 选区几何不可用时用默认位置 */ }
        setSelHint({
          text, page: first?.page || 0, blockId: first?.block || '',
          section: section.key, source: 'card', x, y,
        })
      }

      const modelReady = Boolean(llm && llm.available && llm.route)
      const busy = starting || running || pdfMissing
      const disabled = !modelReady || busy
      const hint = llm && !modelReady
        ? (llm.available ? '没有可用的默认模型' : '宿主未提供模型服务')
        : ''

      if (loading && !card) return h('div', { className: 'litkb-muted' }, '加载中…')

      if (!card) {
        return h('div', { className: 'litkb-cardEmpty' },
          h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '▦'),
          h('div', { className: 'litkb-emptyTitle' }, '还没有七段卡'),
          h('p', { className: 'litkb-emptyText' },
            '一句话 / 问题与动机 / 方法 / 数据与实验 / 结果 / 局限 / 与我的课题。每条结论都挂回原文页码，找不到依据就留空。'),
          h('div', { className: 'litkb-inline' },
            h('button', { type: 'button', className: 'litkb-btn', disabled, onClick: () => generate(false) },
              starting ? '提交中…' : '生成七段卡'),
            hint ? h('span', { className: 'litkb-muted' }, hint) : null),
          pdfMissing ? h('div', { className: 'litkb-error' }, '原文 PDF 已缺失：卡片还能读，但生成与 p.N 跳转会失败。') : null,
          running ? progressLine(job) : null,
          job && job.status === 'failed' && job.error
            ? h('div', { className: 'litkb-error' }, `生成失败：${job.error.message}`)
            : null,
          err ? h('div', { className: 'litkb-error' }, err) : null)
      }

      const evidence = new Map((card.evidence || []).map((e) => [e.id, e]))
      const meta = [
        card.model,
        `证据 ${(card.evidence || []).length} 条`,
        formatLocal(card.generatedAt),
      ].filter(Boolean).join(' · ')

      return h('div', { className: 'litkb-card' },
        h('div', { className: 'litkb-cardMeta' },
          h('span', { className: 'litkb-statusPill' + (card.status === 'ready' ? ' is-ok' : ' is-warn') },
            card.status === 'ready' ? '七段完整' : '部分待补'),
          h('select', {
            className: 'litkb-input litkb-statusSelect', value: status, disabled: statusBusy,
            title: '阅读状态（可自由切换）',
            onChange: (e) => changeStatus(e.target.value),
          }, STATUS.map((s) => h('option', { key: s, value: s }, s))),
          h('span', { className: 'litkb-muted' }, meta)),
        pdfMissing ? h('div', { className: 'litkb-error' }, '原文 PDF 已缺失（断链）：卡片内容仍可读，p.N 跳转不可用。') : null,
        running ? progressLine(job) : null,
        err ? h('div', { className: 'litkb-error' }, err) : null,
        job && job.status === 'failed' && job.error
          ? h('div', { className: 'litkb-error' }, `生成失败：${job.error.message}`)
          : null,
        (card.warnings || []).length
          ? h('div', { className: 'litkb-warnings' },
              h('div', { className: 'litkb-warnTitle' }, '生成警告'),
              card.warnings.map((w, i) => h('div', { key: i, className: 'litkb-warnLine' }, '· ' + w)))
          : null,
        (card.sections || []).map((section, index) => h('section', { key: section.key, className: 'litkb-sec' },
          h('div', { className: 'litkb-secHead' },
            h('span', { className: 'litkb-secNo' }, String(index + 1)),
            h('span', { className: 'litkb-secTitle' }, section.title),
            (section.evidence || []).length ? null : h('span', { className: 'litkb-secTag' }, '无原文引证'),
            h('span', { className: 'litkb-spacer' }),
            editKey === section.key
              ? null
              : h('button', {
                  type: 'button', className: 'litkb-secBtn is-edit', disabled: busy,
                  onClick: () => startEdit(section),
                }, h('span', { 'aria-hidden': 'true' }, '✎'), '编辑'),
            editKey === section.key
              ? null
              : h('button', {
                  type: 'button', className: 'litkb-secBtn is-regen', disabled: disabled || !modelReady,
                  onClick: () => regenerateSection(section.key),
                }, h('span', { 'aria-hidden': 'true' }, '↻'), '重生成')),
          editKey === section.key
            ? h('div', { className: 'litkb-secEdit' },
                h('textarea', {
                  className: 'litkb-input litkb-textarea', value: editText,
                  onChange: (e) => setEditText(e.target.value),
                }),
                h('div', { className: 'litkb-inline' },
                  h('button', { type: 'button', className: 'litkb-btn', disabled: savingEdit, onClick: () => saveSection(section.key) },
                    savingEdit ? '保存中…' : '保存'),
                  h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: () => setEditKey('') }, '取消'),
                  h('span', { className: 'litkb-muted' }, `${editText.length}/2000`)))
            : h('p', {
                className: 'litkb-secText',
                title: '选中正文可追问',
                onMouseUp: (event) => captureSelection(event, section),
              }, section.text),
          (section.evidence || []).map((id) => {
            const ev = evidence.get(id)
            if (!ev) return null
            return h('blockquote', { key: id, className: 'litkb-quote' },
              h('div', { className: 'litkb-quoteText' }, ev.quote),
              ev.comment ? h('div', { className: 'litkb-noteText' }, `批注：${ev.comment}`) : null,
              h('div', { className: 'litkb-quoteMeta' },
                h('button', {
                  type: 'button', className: 'litkb-evPage',
                  onClick: () => onOpenPdf && onOpenPdf(ev.page, ev.block),
                }, `p.${ev.page}`),
                h('span', { className: 'litkb-evId' }, '^' + ev.id),
                ev.blockMissing ? h('span', { className: 'litkb-evMissing', title: '版面块已不存在，按页定位' }, '块已失效') : null,
                h('span', { className: 'litkb-spacer' }),
                h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => toggleContext(ev.id),
                }, expanded[ev.id] ? '收起上下文' : '上下文'),
                h(BacklinksButton, { paperId: paper.id, quoteId: ev.id }),
                onCite ? h('button', {
                  type: 'button', className: 'litkb-miniBtn',
                  onClick: () => onCite({
                    paperId: paper.id,
                    evidenceId: ev.id,
                    page: ev.page,
                    label: citationLabel(paper, ev.page),
                  }),
                }, '引用') : null),
              expanded[ev.id]
                ? h('div', { className: 'litkb-evContext' },
                    h('div', { className: 'litkb-evContextLine' },
                      h('span', { className: 'litkb-evContextLabel' }, '前'),
                      ev.before || '（空）'),
                    h('div', { className: 'litkb-evContextLine' },
                      h('span', { className: 'litkb-evContextLabel' }, '后'),
                      ev.after || '（空）'))
                : null)
          }))),
        h('section', { className: 'litkb-sec litkb-notes' },
          h('div', { className: 'litkb-secHead' },
            h('span', { className: 'litkb-secNo', 'aria-hidden': 'true' }, '✎'),
            h('span', { className: 'litkb-secTitle' }, '我的批注')),
          (card.annotations || []).length
            ? (card.annotations || []).map((note) => h('div', { key: note.id, className: 'litkb-note' },
                h('span', { className: 'litkb-noteAt' }, formatLocal(note.at).slice(0, 10)),
                h('span', { className: 'litkb-noteText' }, note.text),
                note.quote ? h('div', { className: 'litkb-noteQuote' }, `原句：${note.quote}`) : null))
            : h('div', { className: 'litkb-muted' }, '还没有批注'),
          h('div', { className: 'litkb-noteAdd' },
            h('textarea', {
              className: 'litkb-input litkb-textarea', placeholder: '追加一条批注（不覆盖正文）…',
              value: noteText, onChange: (e) => setNoteText(e.target.value),
            }),
            h('button', { type: 'button', className: 'litkb-btn', disabled: savingNote || !noteText.trim(), onClick: addNote },
              savingNote ? '添加中…' : '添加批注'))),
        h('div', { className: 'litkb-cardActions' },
          h('button', {
            type: 'button', className: 'litkb-btn litkb-btnGhost', disabled,
            onClick: () => {
              if (window.confirm('重新生成会覆盖当前卡片（旧版备份在 cards/.versions/）。继续？')) generate(true)
            },
          }, starting ? '提交中…' : '重新生成'),
          h('button', {
            type: 'button', className: 'litkb-btn litkb-btnGhost',
            onClick: () => onOpenPdf && onOpenPdf(1),
          }, '打开原文'),
          h('button', {
            type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: versionBusy,
            onClick: openVersions,
          }, versionBusy ? '读取中…' : '历史版本'),
          h('details', { className: 'litkb-exportMenu' },
            h('summary', { className: 'litkb-btn litkb-btnGhost' }, '导出 ▾'),
            h('div', { className: 'litkb-exportMenuList' },
              h('a', {
                href: `/api/litkb/evidence/export?id=${encodeURIComponent(paper.id)}&format=json`,
                download: paper.id + '.evidence.json',
              }, '证据 JSON'),
              h('a', {
                href: `/api/litkb/evidence/export?id=${encodeURIComponent(paper.id)}&format=csv`,
                download: paper.id + '.evidence.csv',
              }, '证据 CSV'),
              h('a', {
                href: `/api/litkb/export?format=bibtex&id=${encodeURIComponent(paper.id)}`,
                download: paper.id + '.bib',
              }, 'BibTeX'),
              h('a', {
                href: `/api/litkb/export?format=gbt&id=${encodeURIComponent(paper.id)}`,
                download: paper.id + '.gbt.txt',
              }, 'GB/T 7714'),
              h('a', {
                href: `/api/litkb/export?format=card&id=${encodeURIComponent(paper.id)}`,
                download: paper.id + '.md',
              }, '卡片 Markdown')))),
        versionsOpen
          ? h('div', { className: 'litkb-versions' },
              h('div', { className: 'litkb-inline' },
                h('span', { className: 'litkb-blockTitle' }, '历史版本'),
                h('span', { className: 'litkb-muted' }, '每次编辑/重生成/状态变更前自动备份，保留 20 份'),
                h('span', { className: 'litkb-spacer' }),
                h('button', { type: 'button', className: 'litkb-link', onClick: () => setVersionsOpen(false) }, '收起')),
              versions.length
                ? versions.map((version) => h('div', { key: version.name, className: 'litkb-versionRow' },
                    h('span', { className: 'litkb-versionTime' }, formatLocal(version.at)),
                    h('span', { className: 'litkb-muted' }, `${Math.round(version.bytes / 1024)} KB`),
                    h('button', { type: 'button', className: 'litkb-link', disabled: versionBusy, onClick: () => restoreVersion(version) }, '恢复')))
                : h('div', { className: 'litkb-muted' }, '还没有历史版本'))
          : null,
        !modelReady ? h('div', { className: 'litkb-muted' }, hint) : null,
        selHint
          ? h('div', { className: 'litkb-selFab', style: { left: selHint.x, top: selHint.y } },
              h('button', {
                type: 'button', className: 'litkb-askFab',
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => { if (onAsk) onAsk(selHint); setSelHint(null) },
              }, '追问'),
              onBuildChain
                ? h('button', {
                    type: 'button', className: 'litkb-askFab is-accent',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => buildFromSelection(selHint),
                  }, '建链')
                : null,
              onComment
                ? h('button', {
                    type: 'button', className: 'litkb-askFab',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => { onComment(selHint); setSelHint(null) },
                  }, '评论')
                : null)
          : null,
        null)
    }

    /* ---------------- 内嵌原文查看器（不依赖新标签页） ---------------- */
    function PdfViewer({ view, onClose }) {
      const { paper, page = 1, blockId } = view
      const [doc, setDoc] = useState(null)
      const [current, setCurrent] = useState(page)
      const [err, setErr] = useState('')
      const total = doc?.pages?.length || paper.pages || Math.max(1, Number(page) || 1)

      useEffect(() => {
        let alive = true
        api('/api/litkb/blocks?id=' + encodeURIComponent(paper.id))
          .then((data) => { if (alive) setDoc(data.doc || null) })
          .catch(() => { /* 没有解析稿也能看页图 */ })
        return () => { alive = false }
      }, [paper.id])

      useEffect(() => {
        setCurrent(page)
        const target = document.getElementById('pdfv-pg-' + page)
        if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' })
      }, [page, doc])

      const go = (next) => {
        const target = Math.max(1, Math.min(total, next))
        setCurrent(target)
        const element = document.getElementById('pdfv-pg-' + target)
        if (element && element.scrollIntoView) element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }

      const pages = doc?.pages?.length
        ? doc.pages
        : Array.from({ length: total }, (_, index) => ({ page: index + 1 }))

      return h('div', { className: 'litkb-pdfWrap', role: 'dialog', 'aria-label': '原文' },
        h('div', { className: 'litkb-pdfHead' },
          h('span', { className: 'litkb-blockTitle litkb-pdfTitle', title: paper.title }, paper.title || '原文'),
          h('span', { className: 'litkb-muted' }, `${current} / ${total}`),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: current <= 1, onClick: () => go(current - 1) }, '上一页'),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: current >= total, onClick: () => go(current + 1) }, '下一页'),
          h('a', {
            className: 'litkb-link',
            href: '/api/litkb/pdf?id=' + encodeURIComponent(paper.id),
            download: paper.id + '.pdf',
          }, '下载 PDF'),
          h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
        err ? h('div', { className: 'litkb-error', style: { margin: '8px 14px' } }, err) : null,
        h('div', { className: 'litkb-pdfBody' },
          pages.map((pageDoc) => pageDoc.width
            ? h('div', { key: pageDoc.page, id: 'pdfv-pg-' + pageDoc.page, className: 'litkb-shot' },
                h('div', {
                  className: 'litkb-shotInner',
                  style: { paddingTop: `${((pageDoc.height / pageDoc.width) * 100).toFixed(2)}%` },
                },
                h('img', {
                  src: `/api/litkb/page?id=${encodeURIComponent(paper.id)}&page=${pageDoc.page}&dpi=144`,
                  alt: `第 ${pageDoc.page} 页`, loading: 'lazy',
                  onError: () => setErr('页图加载失败，可尝试「下载 PDF」直接打开'),
                }),
                (pageDoc.blocks || []).map((block) => h('div', {
                  key: block.id,
                  className: 'litkb-box' + (block.id === blockId ? ' litkb-focus' : ''),
                  style: {
                    left: `${block.bbox[0] * 100}%`,
                    top: `${block.bbox[1] * 100}%`,
                    width: `${(block.bbox[2] - block.bbox[0]) * 100}%`,
                    height: `${(block.bbox[3] - block.bbox[1]) * 100}%`,
                    background: 'transparent',
                    border: block.id === blockId ? '2px solid var(--litkb-accent)' : '1px solid transparent',
                    boxShadow: block.id === blockId ? '0 0 0 2px rgba(79,142,247,.18)' : 'none',
                  },
                  title: String(block.text || '').slice(0, 90),
                }))))
            : h('div', { key: pageDoc.page, id: 'pdfv-pg-' + pageDoc.page, className: 'litkb-shot' },
                h('img', {
                  className: 'litkb-pdfImg',
                  src: `/api/litkb/page?id=${encodeURIComponent(paper.id)}&page=${pageDoc.page}&dpi=144`,
                  alt: `第 ${pageDoc.page} 页`, loading: 'lazy',
                  onError: () => setErr('页图加载失败，可尝试「下载 PDF」直接打开'),
                })))))
    }

    /* ---------------- 右栏原文（P4.2） ---------------- */
    function PdfRail({ paper, page = 1, blockId, blockIds = [], nonce, askSelection, onClearAsk, cardRevision = 0, chainRevision = 0, onChanged, onBuildChain, onOpenChain }) {
      const [doc, setDoc] = useState(null)
      const [card, setCard] = useState(null)
      const [tab, setTab] = useState('pdf')
      const [current, setCurrent] = useState(page)
      const [focusBlock, setFocusBlock] = useState(blockId)
      const [targetPage, setTargetPage] = useState(null)
      const [err, setErr] = useState('')
      const [jump, setJump] = useState('')
      const [zoom, setZoom] = useState(() => storedNumber('litkb.pdfZoom', 1.35))
      const [evidenceView, setEvidenceView] = useState('evidence')
      const [chains, setChains] = useState([])
      const [highlightIds, setHighlightIds] = useState([])
      const bodyRef = useRef(null)
      const pageRefs = useRef(new Map())

      useEffect(() => {
        let alive = true
        setErr('')
        setDoc(null)
        api('/api/litkb/blocks?id=' + encodeURIComponent(paper.id))
          .then((data) => { if (alive) setDoc(data.doc || null) })
          .catch(() => { if (alive) setDoc(null) })
        return () => { alive = false }
      }, [paper.id])

      const loadCard = useCallback(async () => {
        try {
          const data = await api('/api/litkb/card?id=' + encodeURIComponent(paper.id))
          setCard(data.card || null)
        } catch { /* 没有卡片时证据/信息页留空 */ }
      }, [paper.id])

      useEffect(() => { loadCard() }, [loadCard, cardRevision])

      const loadChains = useCallback(async () => {
        try {
          const data = await api('/api/litkb/chains')
          setChains(data.chains || [])
        } catch { setChains([]) }
      }, [])

      useEffect(() => { loadChains() }, [loadChains, chainRevision, paper.id])
      useEffect(() => { setErr('') }, [paper.id])
      useEffect(() => { setFocusBlock(blockId) }, [blockId])

      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const handler = (event) => {
          const detail = event?.detail || {}
          if (detail.paperId && detail.paperId !== paper.id) return
          setTab('pdf')
          if (detail.blockId) setFocusBlock(detail.blockId)
          setHighlightIds(Array.isArray(detail.blockIds) ? detail.blockIds : [])
          if (detail.page) setTargetPage({ page: Number(detail.page) || 1, nonce: Date.now() })
        }
        window.addEventListener('litkb:locate', handler)
        return () => window.removeEventListener('litkb:locate', handler)
      }, [paper.id])
      useEffect(() => { if (nonce) setTab('pdf') }, [nonce])
      useEffect(() => { if (askSelection) setTab('ask') }, [askSelection])

      const total = Math.max(1, Number(doc?.numPages) || Number(paper.pages) || 1)
      const dpi = zoom >= 1.6 ? 216 : 180
      const pages = doc?.pages?.length
        ? doc.pages
        : Array.from({ length: total }, (_, index) => ({ page: index + 1 }))

      const scrollToPage = (target) => {
        const next = Math.max(1, Math.min(total, Number(target) || 1))
        const container = bodyRef.current
        const element = pageRefs.current.get(next)
          || pageRefs.current.get(String(next))
          || container?.querySelector?.(`[data-litkb-page="${next}"]`)
        if (element && container) {
          container.scrollTop = Math.max(0, element.offsetTop - 4)
        }
        setCurrent(next)
      }

      useEffect(() => { setTargetPage(null) }, [page, nonce, paper.id])

      useEffect(() => {
        if (tab !== 'pdf') return
        const target = targetPage?.page || page
        setCurrent(Math.max(1, Number(target) || 1))
        scrollToPage(target)
      }, [targetPage, page, blockId, paper.id, nonce, doc, tab])

      const changeZoom = (next) => {
        const value = Math.max(0.8, Math.min(2.5, Number(next) || 1))
        setZoom(value)
        try { window.localStorage?.setItem('litkb.pdfZoom', String(value)) } catch { /* 忽略 */ }
      }

      useEffect(() => { if (tab === 'pdf') scrollToPage(current) }, [zoom, dpi])

      const onScroll = () => {
        const container = bodyRef.current
        if (!container) return
        const top = container.scrollTop + 24
        let best = 1
        for (const [number, element] of pageRefs.current) {
          if (element.offsetTop <= top) best = Math.max(best, Number(number))
        }
        if (best !== current) setCurrent(best)
      }

      const go = () => {
        if (!jump) return
        setTargetPage({ page: Number(jump), nonce: Date.now() })
        setJump('')
      }

      const evidence = card?.evidence || []
      const tabBtn = (key, label, count) => h('button', {
        type: 'button', className: 'litkb-railTab' + (tab === key ? ' is-on' : ''),
        onClick: () => setTab(key),
      }, label, count ? h('span', { className: 'litkb-filterCount' }, count) : null)

      const head = h('div', { className: 'litkb-pdfRailHead' },
        h('div', { className: 'litkb-railTabs' },
          tabBtn('pdf', '原文'),
          tabBtn('evidence', '证据', evidence.length),
          tabBtn('info', '信息'),
          tabBtn('ask', '追问', askSelection ? 1 : 0)),
        h('span', { className: 'litkb-spacer' }),
        tab === 'pdf'
          ? h('div', { className: 'litkb-pdfControls' },
              h('span', { className: 'litkb-muted' }, `p.${Math.min(Math.max(1, current), total)} / ${total}`),
              h('div', { className: 'litkb-zoom' },
                h('button', { type: 'button', className: 'litkb-pageBtn', onClick: () => changeZoom(zoom - 0.15), title: '缩小' }, '−'),
                h('button', { type: 'button', className: 'litkb-zoomValue', onClick: () => changeZoom(1), title: '恢复 100%' }, `${Math.round(zoom * 100)}%`),
                h('button', { type: 'button', className: 'litkb-pageBtn', onClick: () => changeZoom(zoom + 0.15), title: '放大' }, '＋')),
              h('input', {
                className: 'litkb-input litkb-pageInput', type: 'number', min: 1, max: total,
                placeholder: '页码', value: jump,
                onChange: (e) => setJump(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') go() },
              }),
              h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost litkb-pageBtn', onClick: go }, '跳转'))
          : h('span', { className: 'litkb-railTitle', title: paper.title }, paper.title || ''))

      const paragraphGroup = (doc?.paragraphs || [])
        .find((paragraph) => (paragraph.blockIds || []).includes(focusBlock))?.blockIds || []
      const externalIds = (Array.isArray(highlightIds) && highlightIds.length ? highlightIds : blockIds) || []
      const groupIds = externalIds.length ? externalIds : paragraphGroup
      const inGroup = (id) => id === focusBlock || groupIds.includes(id)
      const pdfBody = h('div', { className: 'litkb-pdfRailBody', ref: bodyRef, onScroll },
        err ? h('div', { className: 'litkb-error' }, err) : null,
        pages.map((pageDoc) => h('div', {
          key: pageDoc.page,
          className: 'litkb-pdfRailPage',
          'data-litkb-page': pageDoc.page,
          style: { width: `${Math.round(zoom * 100)}%` },
          onDoubleClick: () => changeZoom(zoom >= 2 ? 1 : 2),
          ref: (element) => {
            if (element) pageRefs.current.set(String(pageDoc.page), element)
            else pageRefs.current.delete(String(pageDoc.page))
          },
        },
        pageDoc.width
          ? h('div', {
              className: 'litkb-shotInner',
              style: { paddingTop: `${((pageDoc.height / pageDoc.width) * 100).toFixed(2)}%` },
            },
            h('img', {
              src: `/api/litkb/page?id=${encodeURIComponent(paper.id)}&page=${pageDoc.page}&dpi=${dpi}`,
              alt: `第 ${pageDoc.page} 页`, loading: 'lazy',
              onError: () => setErr('页图加载失败，可下载 PDF 查看'),
            }),
            (pageDoc.blocks || []).map((block) => h('div', {
              key: block.id,
              className: 'litkb-box' + (inGroup(block.id) ? ' litkb-focus' : ''),
              style: {
                left: `${block.bbox[0] * 100}%`,
                top: `${block.bbox[1] * 100}%`,
                width: `${(block.bbox[2] - block.bbox[0]) * 100}%`,
                height: `${(block.bbox[3] - block.bbox[1]) * 100}%`,
                background: inGroup(block.id) ? 'rgba(79,142,247,.16)' : 'transparent',
                border: inGroup(block.id)
                  ? '2px solid var(--litkb-accent)' : '1px solid transparent',
                boxShadow: inGroup(block.id)
                  ? '0 0 0 2px rgba(79,142,247,.2)' : 'none',
                pointerEvents: inGroup(block.id) ? 'auto' : 'none',
              },
              title: String(block.text || '').slice(0, 90),
            })))
          : h('img', {
              className: 'litkb-pdfImg',
              src: `/api/litkb/page?id=${encodeURIComponent(paper.id)}&page=${pageDoc.page}&dpi=${dpi}`,
              alt: `第 ${pageDoc.page} 页`, loading: 'lazy',
              onError: () => setErr('页图加载失败，可下载 PDF 查看'),
            }),
        h('div', { className: 'litkb-pdfRailPageNo' }, `${pageDoc.page} / ${total}`))))

      const evidenceRow = (ev) => h('div', { key: ev.id, className: 'litkb-evItem' },
        h('button', {
          type: 'button', className: 'litkb-evRow',
          onClick: () => {
            setFocusBlock(ev.block || null)
            setTargetPage({ page: ev.page, nonce: Date.now() })
            setTab('pdf')
          },
        },
        h('div', { className: 'litkb-evRowTop' },
          h('span', { className: 'litkb-evPage' }, `p.${ev.page}`),
          h('span', { className: 'litkb-evId' }, '^' + ev.id),
          ev.blockMissing ? h('span', { className: 'litkb-evMissing' }, '块已失效') : null),
        h('div', { className: 'litkb-evRowText' }, ev.quote || ''),
        ev.section ? h('div', { className: 'litkb-railMeta' }, ev.section) : null),
        h('div', { className: 'litkb-evItemActions' },
          h('button', {
            type: 'button', className: 'litkb-miniBtn', title: '用这条证据建链',
            onClick: (event) => {
              event.stopPropagation()
              if (onBuildChain) {
                onBuildChain({ paperId: paper.id, evidenceIds: [ev.id], mode: 'evidence', origin: 'evidence' })
              }
            },
          }, '建链')))

      const paperChains = chains.filter((item) => (item.paperIds || []).includes(paper.id)
        || item.claimPaperId === paper.id)
      const chainRow = (item) => h('div', {
        key: item.id, role: 'button', tabIndex: 0, className: 'litkb-chainRow',
        onClick: () => onOpenChain && onOpenChain(item.id),
        onKeyDown: (e) => { if (e.key === 'Enter' && onOpenChain) onOpenChain(item.id) },
      },
      h('div', { className: 'litkb-chainRowTop' },
        h('span', { className: 'litkb-chainRowTitle' }, item.title || item.claim),
        h('span', { className: 'litkb-evPage' }, `${item.nodes} 证据`)),
      h('div', { className: 'litkb-chainRowClaim' }, item.claim),
      h('div', { className: 'litkb-chainRowMeta' },
        h('span', null, CHAIN_ORIGIN[item.origin] || '论点先行'),
        item.stale ? h('span', { className: 'litkb-numBad' }, `失效 ${item.stale}`) : null,
        h('span', null, formatLocal(item.updatedAt).slice(0, 10))))

      const evidenceBody = h('div', { className: 'litkb-railPane' },
        h('div', { className: 'litkb-evSeg' },
          h('button', {
            type: 'button', className: 'litkb-evSegBtn' + (evidenceView === 'evidence' ? ' is-on' : ''),
            onClick: () => setEvidenceView('evidence'),
          }, `证据 ${evidence.length}`),
          h('button', {
            type: 'button', className: 'litkb-evSegBtn' + (evidenceView === 'chains' ? ' is-on' : ''),
            onClick: () => setEvidenceView('chains'),
          }, `证据链 ${paperChains.length}`)),
        evidenceView === 'chains'
          ? h('div', { className: 'litkb-chainRail' },
              h('div', { className: 'litkb-chainRailHead' },
                h('button', {
                  type: 'button', className: 'litkb-btn',
                  onClick: () => onBuildChain && onBuildChain({ paperId: paper.id, mode: 'claim', origin: 'claim' }),
                }, '＋ 新建链'),
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => loadChains().catch(() => {}) }, '刷新')),
              h('div', { className: 'litkb-railHint' }, '链保存到 chains/；插入文稿在弹窗底部选择。'),
              paperChains.length ? paperChains.map(chainRow)
                : h('div', { className: 'litkb-muted' }, '还没有论证链；从证据、解析稿段落或精读论点建链。'))
          : h('div', { className: 'litkb-evList' },
              h('div', { className: 'litkb-railHint' }, '点一条证据翻到原文；点「建链」把它作为节点。'),
              evidence.length ? evidence.map(evidenceRow)
                : h('div', { className: 'litkb-muted' }, '这篇还没有证据；先生成七段卡。')))

      const infoBody = h('div', { className: 'litkb-railPane' },
        h('div', { className: 'litkb-infoTitle' }, paper.title || paper.id),
        h('div', { className: 'litkb-railMeta' }, [paper.year, paper.venue, paper.type].filter(Boolean).join(' · ') || '元数据缺失'),
        h('div', { className: 'litkb-infoGrid' },
          infoLine('作者', paper.authors || '—'),
          infoLine('DOI', paper.doi || '—'),
          infoLine('七段卡', card ? (card.status === 'ready' ? '完整' : '部分') : '未生成'),
          infoLine('证据', `${evidence.length} 条`),
          infoLine('批注', `${(card?.annotations || []).length} 条`),
          infoLine('生成模型', card?.model || '—')),
        h('div', { className: 'litkb-railHint' }, '更多字段与标签在中间「详情」页；导出的证据在卡片底部。'))

      const askBody = h('div', { className: 'litkb-railPane litkb-askRail' },
        askSelection
          ? h(AskPanel, {
              key: `${paper.id}-${askSelection.page || 0}-${String(askSelection.text || '').slice(0, 24)}`,
              inline: true,
              paper,
              selection: askSelection,
              onClose: onClearAsk,
              onOpenPdf: (targetPage) => { setTargetPage({ page: targetPage, nonce: Date.now() }); setTab('pdf') },
              onSaved: () => { loadCard(); if (onChanged) onChanged() },
            })
          : h('div', { className: 'litkb-railHint' }, '在中间卡片或解析稿里选中一句话，点「追问」，问题与回答会出现在这里。'))

      return h('aside', { className: 'litkb-pdfRail', 'aria-label': '原文与上下文' },
        head,
        tab === 'pdf'
          ? pdfBody
          : tab === 'evidence'
            ? evidenceBody
            : tab === 'info'
              ? infoBody
              : askBody,
        h('div', { className: 'litkb-pdfRailFoot' },
          h('a', {
            className: 'litkb-link',
            href: '/api/litkb/pdf?id=' + encodeURIComponent(paper.id),
            download: paper.id + '.pdf',
          }, '下载 PDF'),
          h('span', { className: 'litkb-muted' }, '滚动阅读'),
          h('span', { className: 'litkb-spacer' }),
          focusBlock ? h('span', { className: 'litkb-muted', title: focusBlock }, '块已定位') : null))
    }

    function infoLine(label, value) {
      return h('div', { className: 'litkb-infoLine' },
        h('span', { className: 'litkb-infoKey' }, label),
        h('span', { className: 'litkb-infoValue', title: String(value) }, String(value)))
    }

    /* ---------------- 解析稿（版面对照） ---------------- */
    const ROLE_LABEL = {
      title: '标题', authors: '作者', abstract: '摘要', keywords: '关键词', heading1: '小节',
      caption: '图注/表注', paragraph: '正文', reference: '参考文献', header: '页眉', footer: '页脚',
    }
    const SECTION_LABEL = {
      abstract: '摘要', keywords: '关键词', intro: '引言', related: '相关工作', method: '方法',
      experiment: '实验', results: '结果', discussion: '讨论', conclusion: '结论',
      references: '参考文献', other: '其他',
    }

    function GlossaryEditor({ terms, onClose, onSaved, embedded = false }) {
      const [rows, setRows] = useState(() => terms.map((t) => ({ source: t.source, target: t.target, aliases: t.aliases || [] })))
      const [source, setSource] = useState('')
      const [target, setTarget] = useState('')
      const [saving, setSaving] = useState(false)
      const [err, setErr] = useState('')
      const [dirty, setDirty] = useState(false)

      const add = () => {
        const s = source.trim()
        const t = target.trim()
        if (!s || !t) { setErr('术语与译名都不能为空'); return }
        setRows([...rows, { source: s, target: t, aliases: [] }])
        setSource('')
        setTarget('')
        setErr('')
        setDirty(true)
      }

      const close = () => {
        if (dirty && typeof window.confirm === 'function'
          && !window.confirm('术语表有未保存的修改，确定关闭？')) return
        onClose()
      }

      const save = async () => {
        setSaving(true)
        setErr('')
        try {
          const data = await api('/api/litkb/glossary', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ terms: rows.filter((r) => r.source && r.target) }),
          })
          const changed = rows.filter((row) => {
            const old = terms.find((t) => t.source === row.source)
            return !old || old.target !== row.target
          }).length
          setDirty(false)
          onSaved(data.terms, changed)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      return h('div', { className: 'litkb-glossary' + (embedded ? ' is-embedded' : '') },
        h('div', { className: 'litkb-inline' },
          embedded ? null : h('span', { className: 'litkb-blockTitle' }, '术语表'),
          h('span', { className: 'litkb-muted' }, '命中术语时译文强制使用右侧译名'),
          dirty ? h('span', { className: 'litkb-glossDirty' }, '未保存') : null,
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-btn', disabled: saving, onClick: save },
            saving ? '保存中…' : '保存'),
          embedded ? null : h('button', { type: 'button', className: 'litkb-link', onClick: close }, '关闭')),
        rows.map((row, index) => h('div', { key: row.source + index, className: 'litkb-glossRow' },
          h('span', { className: 'litkb-glossSource', title: row.source }, row.source),
          h('input', {
            className: 'litkb-input', value: row.target,
            onChange: (e) => {
              setRows(rows.map((r, i) => (i === index ? { ...r, target: e.target.value } : r)))
              setDirty(true)
            },
          }),
          h('button', {
            type: 'button', className: 'litkb-link',
            onClick: () => { setRows(rows.filter((_, i) => i !== index)); setDirty(true) },
          }, '删除'))),
        h('div', { className: 'litkb-inline' },
          h('input', { className: 'litkb-input', placeholder: '英文术语', value: source, onChange: (e) => setSource(e.target.value) }),
          h('input', { className: 'litkb-input', placeholder: '中文译名', value: target, onChange: (e) => setTarget(e.target.value) }),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: add }, '添加')),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        h('div', { className: 'litkb-glossFoot' },
          h('span', { className: 'litkb-muted' }, '保存后需重新「翻译」或单块「重译」才会生效'),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-btn', disabled: saving, onClick: save },
            saving ? '保存中…' : '保存术语表')))
    }

    function ParsePanel({ paper, onOpenPdf, onLocate, onAsk, onComment, onDeep, onBuildChain, flat = false }) {
      const [doc, setDoc] = useState(null)
      const [job, setJob] = useState(null)
      const [settings, setSettings] = useState(null)
      const [trans, setTrans] = useState(null)
      const [tjob, setTjob] = useState(null)
      const [mode, setMode] = useState('source')
      const [scope, setScope] = useState('summary')
      const [section, setSection] = useState('')
      const [loading, setLoading] = useState(true)
      const [building, setBuilding] = useState(false)
      const [err, setErr] = useState('')
      const [active, setActive] = useState('')
      const [showHeaders, setShowHeaders] = useState(false)
      const [byPara, setByPara] = useState(true)
      const [showPage, setShowPage] = useState(!flat)
      const [selHint, setSelHint] = useState(null)

      const load = useCallback(async () => {
        try {
          const [blockData, settingsData, transData] = await Promise.all([
            api('/api/litkb/blocks?id=' + encodeURIComponent(paper.id)),
            api('/api/litkb/settings'),
            api('/api/litkb/translate?id=' + encodeURIComponent(paper.id)),
          ])
          setDoc(blockData.doc || null)
          setJob(blockData.job || null)
          setSettings(settingsData.settings || null)
          setTrans(transData.doc || null)
          setTjob(transData.job || null)
          setErr('')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, [paper.id])

      useEffect(() => { load() }, [load])

      const running = Boolean(job && (job.status === 'queued' || job.status === 'running'))
      useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(load, 2000)
        return () => clearInterval(timer)
      }, [running, load])

      const tRunning = Boolean(tjob && (tjob.status === 'queued' || tjob.status === 'running'))
      useEffect(() => {
        if (!tRunning) return undefined
        const timer = setInterval(async () => {
          try {
            const data = await api('/api/litkb/translate?id=' + encodeURIComponent(paper.id))
            setTrans(data.doc || null)
            setTjob(data.job || null)
          } catch { /* 轮询失败下一次再试 */ }
        }, 2000)
        return () => clearInterval(timer)
      }, [tRunning, paper.id])

      const build = async (force, backend) => {
        setBuilding(true)
        setErr('')
        try {
          const body = { id: paper.id, force: !!force }
          if (backend) body.backend = backend
          const data = await api('/api/litkb/blocks/build', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          })
          if (data.doc) { setDoc(data.doc); setJob(null) }
          else if (data.job) setJob(data.job)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBuilding(false)
        }
      }

      const translate = async (params) => {
        setErr('')
        try {
          const data = await api('/api/litkb/translate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, ...params }),
          })
          if (data.job) setTjob(data.job)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const translateBlock = (block) => {
        translate({ scope: 'block', blockIds: [block.id], force: true })
      }

      const startTranslate = () => {
        const scopeLabel = scope === 'paper' ? '整篇' : scope === 'section' ? '本章' : '摘要+结论'
        const sectionKey = section || sections[0] || ''
        if (scope === 'section' && !sectionKey) {
          setErr('请先选择章节')
          return
        }
        if (scope === 'paper' && typeof window.confirm === 'function'
          && !window.confirm(`${scopeLabel}翻译约 ${doc?.stats?.blocks ?? 0} 块，可能耗时几分钟，继续？`)) return
        translate({ scope, section: scope === 'section' ? sectionKey : undefined, force: false })
      }

      const buildFromSelection = async (selection) => {
        try {
          const data = await api('/api/litkb/card/evidence', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: paper.id, quote: selection.text,
              page: selection.page, block: selection.blockId,
            }),
          })
          const evidence = data.evidence
          onBuildChain({
            paperId: paper.id, mode: 'evidence', evidenceIds: [evidence.id], claim: '',
            source: 'parse', autoPropose: true,
            nodes: [{
              paperId: paper.id, evidenceId: evidence.id,
              page: evidence.page, block: evidence.block || null, quote: evidence.quote,
              title: paper.title || '', authors: paper.authors || '', year: paper.year || '', note: '',
            }],
          })
          setSelHint(null)
        } catch (e) {
          setErr(String(e.message || e))
        }
      }

      const focus = (block, from) => {
        setActive(block.id)
        if (onLocate) onLocate(block.page, block.id, block.blockIds || [block.id])
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
          window.dispatchEvent(new window.CustomEvent('litkb:locate', {
            detail: { paperId: paper.id, page: block.page, blockId: block.id, blockIds: block.blockIds || [block.id] },
          }))
        }
        const targetId = from === 'parse' ? 'pg-' + block.page : 'blk-' + block.id
        const target = document.getElementById(targetId)
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }

      if (loading) return h('div', { className: 'litkb-muted' }, '加载中…')

      const configured = Boolean(settings?.paddle?.configured)
      const paddleModel = settings?.paddle?.model || 'PaddleOCR-VL-1.6'
      const setupHint = h('div', { className: 'litkb-tokenForm' },
        h('div', { className: 'litkb-muted' },
          configured
            ? `PaddleOCR 已配置（${paddleModel}）。令牌与模型在 DSH「设置 → 文献库」统一维护。`
            : 'PaddleOCR 未配置：到 DSH「设置 → 文献库」填访问令牌，或先用 pdf.js 构建。'),
        configured ? null : h('div', { className: 'litkb-muted' },
          'pdf.js 是离线兜底：表格/公式会切得碎，扫描件不可用；PaddleOCR 效果更好但需要联网。'))

      if (!doc && !running) {
        return h('div', { className: 'litkb-cardEmpty' },
          h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '▥'),
          h('div', { className: 'litkb-emptyTitle' }, '构建解析稿'),
          h('p', { className: 'litkb-emptyText' },
            '把全文拆成块（标题/段落/图注/表注），每块带页码与版面坐标。构建后，点解析稿会在右侧原文上高亮对应区域，反过来也一样。'),
          configured
            ? h('div', { className: 'litkb-inline' },
                h('button', { type: 'button', className: 'litkb-btn', disabled: building, onClick: () => build(false) },
                  building ? '提交中…' : `用 ${paddleModel} 解析`),
                h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: building, onClick: () => build(false, 'pdfjs') }, 'pdf.js 兜底'))
            : setupHint,
          job && job.status === 'failed' && job.error
            ? h('div', { className: 'litkb-error' }, `解析失败：${job.error.message}`)
            : null,
          err ? h('div', { className: 'litkb-error' }, err) : null)
      }

      const isPageNumber = (block) => block.role === 'paragraph' && /^\d{1,4}$/.test(String(block.text || '').trim())
      const visible = (block) => (showHeaders || (block.role !== 'header' && block.role !== 'footer')) && !isPageNumber(block)
      const pages = doc?.pages || []
      const activeParagraph = (doc?.paragraphs || []).find((item) => (item.blockIds || []).includes(active))
      const focusGroup = activeParagraph?.blockIds || (active ? [active] : [])
      const paragraphMode = byPara && !showHeaders && mode === 'source'
        && Array.isArray(doc?.paragraphs) && doc.paragraphs.length > 0
      const paragraphPages = []
      if (paragraphMode) {
        for (const paragraph of doc?.paragraphs || []) {
          if (paragraph.role === 'header' || paragraph.role === 'footer') continue
          let group = paragraphPages[paragraphPages.length - 1]
          if (!group || group.page !== paragraph.page) {
            group = { page: paragraph.page, pageEnd: paragraph.pageEnd, blocks: [] }
            paragraphPages.push(group)
          }
          if (paragraph.pageEnd > group.page) group.pageEnd = paragraph.pageEnd
          group.blocks.push({
            id: paragraph.firstBlockId,
            role: paragraph.role,
            text: paragraph.text,
            page: paragraph.page,
            blockIds: paragraph.blockIds,
          })
        }
      }
      const parsePages = paragraphMode
        ? paragraphPages
        : pages.map((page) => ({ ...page, blocks: (page.blocks || []).filter(visible) }))
      const sections = [...new Set(pages.flatMap((p) => (p.blocks || []).map((b) => b.section)).filter(Boolean))]

      const head = h('div', { className: 'litkb-parseHead' },
        h('span', { className: 'litkb-muted' },
          doc ? `${doc.parser} · ${doc.stats?.blocks ?? 0} 块 · 质量 ${doc.quality?.layout ?? '—'}` : '解析中'),
        h('span', { className: 'litkb-spacer' }),
        h('label', { className: 'litkb-muted litkb-inline', title: '按段落合并跨页续句；翻译时自动切回按块' },
          h('input', {
            type: 'checkbox', checked: byPara,
            onChange: (e) => setByPara(e.target.checked),
          }), ' 按段落'),
        h('label', { className: 'litkb-muted litkb-inline' },
          h('input', {
            type: 'checkbox', checked: showHeaders,
            onChange: (e) => setShowHeaders(e.target.checked),
          }), ' 页眉页脚'),
        h('button', { type: 'button', className: 'litkb-link', disabled: building || running, onClick: () => build(true, configured ? undefined : 'pdfjs') },
          building || running ? '解析中…' : '重建'),
        h('a', {
          className: 'litkb-link', href: '/api/litkb/blocks.md?id=' + encodeURIComponent(paper.id),
          download: 'parse.md',
        }, '导出 MD'))

      const transBar = h('div', { className: 'litkb-transBar' },
        h('div', { className: 'litkb-seg' },
          [['source', '原文'], ['both', '对照'], ['target', '译文']].map(([key, label]) => h('button', {
            key, type: 'button', className: 'litkb-segBtn' + (mode === key ? ' litkb-on' : ''),
            onClick: () => setMode(key),
          }, label))),
        h('select', {
          className: 'litkb-input litkb-scope', value: scope,
          onChange: (e) => setScope(e.target.value),
        },
        h('option', { value: 'summary' }, '摘要+结论'),
        h('option', { value: 'section' }, '本章'),
        h('option', { value: 'paper' }, '整篇')),
        scope === 'section'
          ? h('select', {
              className: 'litkb-input litkb-scope', value: section || sections[0] || '',
              onChange: (e) => setSection(e.target.value),
            }, sections.map((key) => h('option', { key, value: key }, SECTION_LABEL[key] || key)))
          : null,
        h('button', { type: 'button', className: 'litkb-btn', disabled: tRunning, onClick: startTranslate },
          tRunning ? '翻译中…' : '翻译'),
        tjob ? h('span', { className: 'litkb-muted' },
          `${tjob.status === 'running' ? '翻译' : tjob.status === 'done' ? '已译' : '失败'} ${tjob.done}/${tjob.total}`) : null,
        h('span', { className: 'litkb-spacer' }),
        h('span', { className: 'litkb-muted' }, '术语表在「标签与术语」'))

      const renderTranslation = (block) => {
        const tr = trans?.blocks?.[block.id]
        if (!tr) {
          return h('div', { className: 'litkb-trans is-empty' },
            h('span', { className: 'litkb-muted' }, '未翻译'),
            h('button', { type: 'button', className: 'litkb-link', onClick: (e) => { e.stopPropagation(); translateBlock(block) } }, '译'))
        }
        return h('div', { className: 'litkb-trans is-' + tr.status },
          h('div', { className: 'litkb-transTop' },
            h('span', { className: 'litkb-transBadge' }, tr.status === 'stale' ? '待重译' : '机翻'),
            tr.status === 'stale'
              ? h('span', { className: 'litkb-transIssues' }, '术语/模型已更新，点「重译」')
              : (tr.issues && tr.issues.length ? h('span', { className: 'litkb-transIssues', title: tr.issues.join('；') }, tr.issues[0]) : null),
            h('span', { className: 'litkb-spacer' }),
            h('button', {
              type: 'button', className: 'litkb-link',
              onClick: (e) => { e.stopPropagation(); translateBlock(block) },
            }, '重译')),
          h('div', { className: 'litkb-transText' },
            tr.status === 'skipped' ? '原文已是中文，未翻译'
              : tr.status === 'failed' ? `翻译失败：${tr.issues?.[0] || '未知原因'}`
                : tr.text))
      }

      const parsePane = h('div', { className: 'litkb-parsePane' },
        onDeep
          ? h('div', { className: 'litkb-parseHint' },
              h('span', null, '这是原文解析（按页 OCR/块文本），不是精读说明。'),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onDeep }, '看精读 →'))
          : null,
        head,
        transBar,
        tjob && tjob.status === 'failed' && tjob.error
          ? h('div', { className: 'litkb-error' }, `翻译失败：${tjob.error.message}`)
          : null,
        err ? h('div', { className: 'litkb-error' }, err) : null,
        parsePages.map((page) => h('div', { key: page.page, className: 'litkb-parsePage' },
          h('div', { className: 'litkb-pageNo' },
            page.pageEnd && page.pageEnd > page.page ? `p.${page.page}–${page.pageEnd}` : `p.${page.page}`),
          (page.blocks || []).map((block) => h('div', {
            key: block.id, id: 'blk-' + block.id, title: '点击定位到右侧原文',
            className: 'litkb-pblock is-' + block.role
              + (active === block.id || focusGroup.includes(block.id) ? ' litkb-focus' : ''),
            onClick: () => focus(block, 'parse'),
            onMouseUp: (event) => {
              const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
              const text = String(selection?.toString?.() || '').trim()
              if (!text || text.length < 2 || text.length > 1200) { setSelHint(null); return }
              const anchor = selection?.anchorNode
              if (anchor && !event.currentTarget.contains(anchor)) return
              let x = 24
              let y = 80
              try {
                const range = selection.getRangeAt(0)
                const rects = range.getClientRects()
                const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect()
                const barWidth = 220
                const barHeight = 38
                x = Math.min(Math.max(12, rect.left), (window.innerWidth || 900) - barWidth - 12)
                y = rect.top - barHeight - 8
                if (y < 12) y = Math.min((window.innerHeight || 700) - barHeight - 12, rect.bottom + 8)
              } catch { /* 选区几何不可用时用默认位置 */ }
              setSelHint({ text, page: block.page, blockId: block.id, x, y, source: 'parse' })
            },
          },
          h('div', { className: 'litkb-pblockText' }, block.text),
          mode !== 'source' ? renderTranslation(block) : null,
          h('div', { className: 'litkb-pblockMeta' },
            h('span', { className: 'litkb-pblockRole' }, ROLE_LABEL[block.role] || block.role),
            h('span', { className: 'litkb-spacer' }),
            h('div', { className: 'litkb-pblockActions' },
              onAsk
                ? h('button', {
                    type: 'button', className: 'litkb-blockAct', title: '追问这一段',
                    onClick: (event) => {
                      event.stopPropagation()
                      onAsk({ text: block.text, page: block.page, blockId: block.id, source: 'parse' })
                    },
                  }, '追问')
                : null,
              onBuildChain
                ? h('button', {
                    type: 'button', className: 'litkb-blockAct is-accent', title: '用这一段原文建一条论证链',
                    onClick: (event) => {
                      event.stopPropagation()
                      onBuildChain({
                        paperId: paper.id, blockId: block.id, page: block.page,
                        mode: 'block', origin: 'block', source: 'parse',
                      })
                    },
                  }, '建链')
                : null)))))))

      const pagePane = h('div', { className: 'litkb-pagePane' },
        pages.map((page) => h('div', { key: page.page, id: 'pg-' + page.page, className: 'litkb-shot' },
          h('div', { className: 'litkb-shotInner', style: { paddingTop: `${((page.height / page.width) * 100).toFixed(2)}%` } },
            h('img', {
              src: `/api/litkb/page?id=${encodeURIComponent(paper.id)}&page=${page.page}&dpi=120`,
              alt: `第 ${page.page} 页`, loading: 'lazy',
            }),
            (page.blocks || []).filter(visible).map((block) => h('div', {
              key: block.id,
              className: 'litkb-box is-' + block.role
                + (active === block.id || focusGroup.includes(block.id) ? ' litkb-focus' : ''),
              style: {
                left: `${block.bbox[0] * 100}%`,
                top: `${block.bbox[1] * 100}%`,
                width: `${(block.bbox[2] - block.bbox[0]) * 100}%`,
                height: `${(block.bbox[3] - block.bbox[1]) * 100}%`,
                background: 'transparent',
                border: active === block.id || focusGroup.includes(block.id)
                  ? '2px solid var(--litkb-accent)' : '1px solid transparent',
                boxShadow: active === block.id || focusGroup.includes(block.id)
                  ? '0 0 0 2px rgba(79,142,247,.18)' : 'none',
              },
              title: String(block.text || '').slice(0, 90),
              onClick: () => focus(block, 'page'),
            }))))))

      return h('div', { className: 'litkb-reader' + (flat && !showPage ? ' is-flat' : '') }, parsePane, showPage ? pagePane : null,
        selHint
          ? h('div', { className: 'litkb-selFab', style: { left: selHint.x, top: selHint.y } },
              h('button', {
                type: 'button', className: 'litkb-askFab',
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => { if (onAsk) onAsk(selHint); setSelHint(null) },
              }, '追问'),
              onBuildChain
                ? h('button', {
                    type: 'button', className: 'litkb-askFab is-accent',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => {
                      onBuildChain({
                        paperId: paper.id, mode: 'claim', claim: selHint.text,
                        page: selHint.page, blockId: selHint.blockId,
                        source: 'parse', autoPropose: true,
                      })
                      setSelHint(null)
                    },
                  }, '建链')
                : null,
              onComment
                ? h('button', {
                    type: 'button', className: 'litkb-askFab',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => { onComment(selHint); setSelHint(null) },
                  }, '评论')
                : null)
          : null,
        null)
    }

    function citationParts(text, onOpenPaper) {
      const nodes = []
      const regex = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|([^\]]+))?\]\]/g
      let last = 0
      let match = regex.exec(text)
      while (match) {
        if (match.index > last) nodes.push({ text: text.slice(last, match.index) })
        const label = match[3] || '引用'
        const page = Number((label.match(/p\.(\d+)/) || [])[1]) || 1
        nodes.push({ citation: true, paperId: match[1], evidenceId: match[2], label, page })
        last = match.index + match[0].length
        match = regex.exec(text)
      }
      if (last < text.length) nodes.push({ text: text.slice(last) })
      return nodes
    }

    function inlineMd(text, opts = {}) {
      const out = []
      citationParts(String(text || ''), opts.onOpenPaper).forEach((part, index) => {
        if (part.citation) {
          out.push(h('button', {
            key: `cite-${index}`, type: 'button', className: 'litkb-citeChip',
            title: `打开 ${part.label}`,
            onClick: () => {
              if (opts.onOpenCitation) opts.onOpenCitation(part)
              else if (opts.onOpenPaper) opts.onOpenPaper(part.paperId, part.page)
            },
          }, part.label))
          return
        }
        const pattern = /(\[p\.\d+\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
        let last = 0
        let match = pattern.exec(part.text)
        while (match) {
          if (match.index > last) out.push(part.text.slice(last, match.index))
          const token = match[0]
          if (/^\[p\.\d+\]$/.test(token)) {
            const page = Number(token.slice(3, -1))
            out.push(h('button', {
              key: `p-${index}-${match.index}`, type: 'button', className: 'litkb-citeChip',
              title: `打开 p.${page}`,
              onClick: () => opts.onOpenPage && opts.onOpenPage(page),
            }, token))
          } else if (token.startsWith('**')) out.push(h('strong', { key: `b-${index}-${match.index}` }, token.slice(2, -2)))
          else if (token.startsWith('`')) out.push(h('code', { key: `c-${index}-${match.index}` }, token.slice(1, -1)))
          else if (token.startsWith('[')) {
            const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
            out.push(link ? h('a', { key: `l-${index}-${match.index}`, href: link[2], target: '_blank', rel: 'noreferrer' }, link[1]) : token)
          } else out.push(h('em', { key: `i-${index}-${match.index}` }, token.slice(1, -1)))
          last = match.index + token.length
          match = pattern.exec(part.text)
        }
        if (last < part.text.length) out.push(part.text.slice(last))
      })
      return out
    }

    function renderMarkdown(text, opts = {}) {
      const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let index = 0
      let key = 0
      while (index < lines.length) {
        const line = lines[index]
        if (!line.trim()) { index += 1; continue }
        if (/^```/.test(line)) {
          const code = []
          index += 1
          while (index < lines.length && !/^```/.test(lines[index])) { code.push(lines[index]); index += 1 }
          index += 1
          blocks.push(h('pre', { key: `pre-${key++}`, className: 'litkb-mdCode' }, h('code', null, code.join('\n'))))
          continue
        }
        const heading = line.match(/^(#{1,6})\s*(.*)$/)
        if (heading) {
          const level = Math.min(6, heading[1].length)
          blocks.push(h(`h${level}`, { key: `h-${key++}`, className: 'litkb-mdH' }, inlineMd(heading[2], opts)))
          index += 1
          continue
        }
        if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
          blocks.push(h('hr', { key: `hr-${key++}` }))
          index += 1
          continue
        }
        if (/^\s*>/.test(line)) {
          const quote = []
          while (index < lines.length && /^\s*>/.test(lines[index])) {
            quote.push(lines[index].replace(/^\s*>\s?/, ''))
            index += 1
          }
          blocks.push(h('blockquote', { key: `q-${key++}`, className: 'litkb-mdQuote' }, inlineMd(quote.join(' '), opts)))
          continue
        }
        const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/)
        if (listMatch) {
          const ordered = /^\d+\.$/.test(listMatch[1])
          const items = []
          while (index < lines.length) {
            const hit = lines[index].match(/^\s*([-*+]|\d+\.)\s+(.*)$/)
            if (!hit || /^\d+\.$/.test(hit[1]) !== ordered) break
            items.push(h('li', { key: `li-${key++}` }, inlineMd(hit[2], opts)))
            index += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: `list-${key++}`, className: 'litkb-mdList' }, items))
          continue
        }
        if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1])) {
          const rows = [line]
          index += 2
          while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
            rows.push(lines[index]); index += 1
          }
          const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
          blocks.push(h('table', { key: `tb-${key++}`, className: 'litkb-mdTable' },
            h('thead', null, h('tr', null, cells(rows[0]).map((cell, i) => h('th', { key: i }, inlineMd(cell, opts))))),
            h('tbody', null, rows.slice(1).map((row, r) => h('tr', { key: r }, cells(row).map((cell, c) => h('td', { key: c }, inlineMd(cell, opts))))))))
          continue
        }
        const para = []
        while (index < lines.length) {
          const current = lines[index]
          if (!current.trim() || /^```/.test(current) || /^(#{1,6})\s+/.test(current)
            || /^\s*>/.test(current) || /^\s*([-*+]|\d+\.)\s+/.test(current)
            || /^\s*(---+|\*\*\*+)\s*$/.test(current)) break
          para.push(current.trim())
          index += 1
        }
        if (para.length) {
          const children = []
          para.forEach((row, rowIndex) => {
            if (rowIndex) children.push(h('br', { key: `br-${key}-${rowIndex}` }))
            children.push(...inlineMd(row, opts))
          })
          blocks.push(h('p', { key: `p-${key++}`, className: 'litkb-mdP' }, children))
        }
      }
      return blocks
    }


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

      const exportEvidence = () => {
        const rows = (data?.citations?.length ? data.citations : data?.evidence) || []
        if (!rows.length) { setNotice('当前没有可导出的证据'); return }
        const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
        const header = ['paper_id', 'title', 'page', 'evidence_id', 'quote']
        const csv = [header.join(','), ...rows.map((row) => [
          row.paperId, row.title, row.page, row.evidenceId, row.quote,
        ].map(cell).join(','))].join('\n')
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'litkb-search-evidence.csv'
        link.click()
        URL.revokeObjectURL(url)
        setNotice(`已导出 ${rows.length} 条证据`)
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
                (data.citations?.length || data.evidence?.length)
                  ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: exportEvidence }, '导出证据 CSV')
                  : null,
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

    function WritingPage({ insertRequest, onConsumed, onOpenPaper, focus = null, onBack = null }) {
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
          onBack
            ? h('div', { className: 'litkb-writingBack' },
                h('button', { type: 'button', className: 'litkb-miniBtn', onClick: onBack }, '← 研究工作台'))
            : null,
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
                  h('details', { className: 'litkb-exportMenu is-down' },
                    h('summary', { className: 'litkb-miniBtn' }, '导出 ▾'),
                    h('div', { className: 'litkb-exportMenuList' },
                      h('a', {
                        href: '/api/litkb/drafts/export?id=' + encodeURIComponent(draft.id),
                        download: draft.id + '.md',
                      }, '当前文稿 Markdown'),
                      h('a', {
                        href: '/api/litkb/drafts/export?id=' + encodeURIComponent(draft.id) + '&format=docx',
                        download: draft.id + '.docx',
                      }, '当前文稿 DOCX'),
                      h('a', {
                        href: '/api/litkb/drafts/export?format=vault',
                        download: 'litkb-vault.zip',
                      }, '整库 Obsidian vault')))),
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

    function mergeChainNodes(current, incoming) {
      const map = new Map((current || []).map((node) => [node.evidenceId, node]))
      for (const node of incoming || []) {
        if (!map.has(node.evidenceId)) map.set(node.evidenceId, { ...node, note: node.note || '' })
      }
      return [...map.values()]
    }

    function ChainDialog({ seed, paper, onClose, onSaved, onDeleted, onOpenPdf, onEvidenceChanged }) {
      const initial = seed?.chain || null
      const [chainId, setChainId] = useState(initial?.id || seed?.chainId || '')
      const [mode, setMode] = useState(seed?.mode || initial?.origin || 'claim')
      const [title, setTitle] = useState(initial?.title || '')
      const [claim, setClaim] = useState(initial?.claim?.text || seed?.claim || '')
      const [question, setQuestion] = useState(initial?.question || seed?.question || '')
      const [source, setSource] = useState({
        paperId: initial?.claim?.paperId || seed?.paperId || '',
        sectionKey: initial?.claim?.sectionKey || seed?.sectionKey || '',
        source: initial?.claim?.source || seed?.source || 'manual',
      })
      const [nodes, setNodes] = useState(initial?.nodes || seed?.nodes || [])
      const [warnings, setWarnings] = useState(() => (
        (initial?.nodes || []).some((node) => node.stale)
          ? ['有节点已失效；插入时会跳过，请换一条证据。']
          : []
      ))
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const [notice, setNotice] = useState('')
      const [searchQuery, setSearchQuery] = useState('')
      const [searchResults, setSearchResults] = useState([])
      const [searching, setSearching] = useState(false)
      const [loadingChain, setLoadingChain] = useState(Boolean(seed?.chainId && !initial))
      const [drafts, setDrafts] = useState([])
      const [targetDraft, setTargetDraft] = useState('__new__')
      const [paperEvidence, setPaperEvidence] = useState([])
      const dialogRef = useRef(null)
      const returnFocusRef = useRef(null)
      const [poolSource, setPoolSource] = useState('paper')
      const [poolLoading, setPoolLoading] = useState(false)
      const [expandedQuotes, setExpandedQuotes] = useState({})
      const autoRef = useRef(false)
      const proposeAutoRef = useRef(false)
      const contextPaperId = source.paperId || nodes[0]?.paperId || seed?.paperId || paper?.id || ''
      const contextTitle = paper?.title || nodes[0]?.title || ''

      const setRelation = (evidenceId, relation) => {
        setNodes((current) => current.map((node) => (node.evidenceId === evidenceId ? { ...node, relation } : node)))
      }
      const setNote = (evidenceId, note) => {
        setNodes((current) => current.map((node) => (node.evidenceId === evidenceId ? { ...node, note } : node)))
      }
      const removeNode = (evidenceId) => {
        setNodes((current) => current.filter((node) => node.evidenceId !== evidenceId))
      }
      const addNode = (item) => {
        setNodes((current) => mergeChainNodes(current, [{
          relation: 'supports', paperId: item.paperId, evidenceId: item.evidenceId,
          page: item.page, block: item.block || null, quote: item.quote || '',
          title: item.title || '', authors: item.authors || '', year: item.year || '', note: item.note || '',
        }]))
      }

      const propose = async (nextMode, nextClaim = claim, nextQuestion = question, evidenceIds = null) => {
        setBusy('propose')
        setErr('')
        setNotice('')
        try {
          const data = await api('/api/litkb/chains/propose', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mode: nextMode,
              claim: nextClaim || '',
              question: nextQuestion || '',
              blockId: nextMode === 'block' ? (seed?.blockId || '') : '',
              paperId: source.paperId || nodes[0]?.paperId || seed?.paperId || paper?.id || '',
              evidenceIds: evidenceIds || (nextMode === 'evidence'
                ? nodes.map((node) => node.evidenceId)
                : (seed?.evidenceIds || [])),
              pages: seed?.pages || [],
            }),
          })
          if (data.claim) setClaim(data.claim)
          if (Array.isArray(data.nodes) && data.nodes.length) {
            setNodes((current) => mergeChainNodes(current, data.nodes))
          }
          setWarnings(data.warnings || [])
          setMode(nextMode)
          if (data.notice) {
            setNotice(data.notice)
            if (data.origin === 'block' && onEvidenceChanged) onEvidenceChanged()
          } else if (data.model) {
            setNotice('AI 已提议论点，保存前请核对')
          } else if (!data.claim && (nextMode === 'question' || nextMode === 'evidence')) {
            setNotice('请把论点点成一句可辩护的话，再保存')
          }
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      useEffect(() => {
        if (!seed?.chainId || seed?.chain) {
          setLoadingChain(false)
          return undefined
        }
        let alive = true
        setLoadingChain(true)
        api('/api/litkb/chains/read?id=' + encodeURIComponent(seed.chainId))
          .then((data) => {
            if (!alive || !data.chain) return
            const chain = data.chain
            setChainId(chain.id)
            setMode(chain.origin || 'claim')
            setTitle(chain.title || '')
            setClaim(chain.claim?.text || '')
            setQuestion(chain.question || '')
            setSource({
              paperId: chain.claim?.paperId || '',
              sectionKey: chain.claim?.sectionKey || '',
              source: chain.claim?.source || 'manual',
            })
            setPoolSource(chain.claim?.paperId ? 'paper' : 'all')
            setNodes(chain.nodes || [])
            setWarnings((chain.nodes || []).some((node) => node.stale)
              ? ['有节点已失效；插入时会跳过，请换一条证据。']
              : [])
          })
          .catch((e) => { if (alive) setErr(String(e.message || e)) })
          .finally(() => { if (alive) setLoadingChain(false) })
        return () => { alive = false }
      }, [seed.chainId])

      useEffect(() => {
        let alive = true
        api('/api/litkb/drafts')
          .then((data) => { if (alive) setDrafts(data.drafts || []) })
          .catch(() => {})
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!contextPaperId) { setPaperEvidence([]); setPoolLoading(false); return undefined }
        let alive = true
        setPoolLoading(true)
        api('/api/litkb/card?id=' + encodeURIComponent(contextPaperId))
          .then((data) => {
            if (!alive) return
            const list = (data.card?.evidence || []).map((ev) => ({
              evidenceId: ev.id, paperId: contextPaperId, page: ev.page,
              block: ev.block || null, quote: ev.quote || '',
              title: data.card?.title || paper?.title || contextPaperId,
              authors: paper?.authors || '', year: paper?.year || '',
              section: ev.section || '',
              note: ev.comment ? `批注：${ev.comment}` : '',
            }))
            setPaperEvidence(list)
          })
          .catch(() => { if (alive) setPaperEvidence([]) })
          .finally(() => { if (alive) setPoolLoading(false) })
        return () => { alive = false }
      }, [contextPaperId])

      useEffect(() => {
        if (!contextPaperId) setPoolSource('all')
      }, [contextPaperId])

      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      useEffect(() => {
        returnFocusRef.current = document.activeElement
        const node = dialogRef.current
        if (!node) return undefined
        const focusables = () => Array.from(node.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
          .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0)
        const first = node.querySelector('[data-autofocus]') || focusables()[0]
        if (first && typeof first.focus === 'function') first.focus()
        const onKey = (event) => {
          if (event.key !== 'Tab') return
          const list = focusables()
          if (!list.length) return
          const firstEl = list[0]
          const lastEl = list[list.length - 1]
          if (event.shiftKey && document.activeElement === firstEl) {
            event.preventDefault(); lastEl.focus()
          } else if (!event.shiftKey && document.activeElement === lastEl) {
            event.preventDefault(); firstEl.focus()
          }
        }
        node.addEventListener('keydown', onKey)
        return () => {
          node.removeEventListener('keydown', onKey)
          const previous = returnFocusRef.current
          if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus()
        }
      }, [])

      useEffect(() => {
        if (autoRef.current) return
        autoRef.current = true
        if (initial || seed?.chainId) return
        if (seed?.blockId) propose('block', seed.claim || '')
        else if (seed?.evidenceIds && seed.evidenceIds.length) propose('evidence', seed.claim || '', '', seed.evidenceIds)
        else if (seed?.claim) propose('claim', seed.claim)
      }, [])

      useEffect(() => {
        if (poolSource !== 'all') { setSearchResults([]); return undefined }
        let alive = true
        const timer = setTimeout(async () => {
          setSearching(true)
          try {
            const data = await api('/api/litkb/evidence/search?q=' + encodeURIComponent(searchQuery.trim()))
            if (alive) setSearchResults(data.items || [])
          } catch (e) {
            if (alive) setErr(String(e.message || e))
          } finally {
            if (alive) setSearching(false)
          }
        }, 260)
        return () => { alive = false; clearTimeout(timer) }
      }, [searchQuery, poolSource])

      const persist = async () => {
        if (!claim.trim()) throw new Error('先用一句话写下论点')
        if (!nodes.length) throw new Error('至少挂一条证据')
        const data = await api('/api/litkb/chains/save', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: chainId || undefined,
            title: title || undefined,
            origin: mode,
            status: 'confirmed',
            question,
            claim: {
              text: claim.trim(),
              paperId: source.paperId || nodes[0]?.paperId || seed?.paperId || '',
              sectionKey: source.sectionKey || '',
              source: source.source || 'manual',
            },
            nodes: nodes.map((node) => ({
              paperId: node.paperId, evidenceId: node.evidenceId,
              relation: node.relation, note: node.note || '',
            })),
          }),
        })
        setChainId(data.chain.id)
        setNodes(data.chain.nodes)
        setMode(data.chain.origin)
        setTitle(data.chain.title || '')
        setSource({
          paperId: data.chain.claim.paperId || '',
          sectionKey: data.chain.claim.sectionKey || '',
          source: data.chain.claim.source || 'manual',
        })
        setWarnings([])
        if (onSaved) onSaved(data.chain)
        return data.chain
      }

      useEffect(() => {
        if (!seed || proposeAutoRef.current) return
        proposeAutoRef.current = true
        if (seed.mode === 'evidence' && Array.isArray(seed.evidenceIds) && seed.evidenceIds.length) {
          propose('evidence', '', '', seed.evidenceIds)
          return
        }
        if (seed.autoPropose && claim.trim()) propose('claim')
      }, [])

      const save = async () => {
        setBusy('save')
        setErr('')
        setNotice('')
        try {
          await persist()
          setNotice('链已保存')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const insert = async () => {
        setBusy('insert')
        setErr('')
        setNotice('')
        try {
          const chain = await persist()
          const data = await api('/api/litkb/chains/insert', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: chain.id,
              append: true,
              draftId: targetDraft === '__new__' ? '' : targetDraft,
            }),
          })
          const draft = data.draft || null
          setNotice(`已插入文稿「${draft?.title || '未命名文稿'}」`)
          if (draft?.id) {
            setTargetDraft(draft.id)
            setDrafts((current) => (current.some((item) => item.id === draft.id)
              ? current
              : [{ ...draft, chars: 0, citations: 0 }, ...current]))
          }
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const remove = async () => {
        if (!chainId) return
        if (!window.confirm('删除这条链？已经插入文稿的引用不受影响。')) return
        setBusy('delete')
        setErr('')
        try {
          await api('/api/litkb/chains/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: chainId }),
          })
          if (onDeleted) onDeleted(chainId)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const ready = Boolean(claim.trim()) && nodes.length > 0 && !busy && !loadingChain
      const paperNeedle = searchQuery.trim().toLowerCase()
      const paperPool = paperEvidence.filter((item) => !paperNeedle
        || `${item.quote} ${item.section || ''} p.${item.page}`.toLowerCase().includes(paperNeedle))
      const pickRow = (item) => {
        const added = nodes.some((node) => node.evidenceId === item.evidenceId)
        return h('div', { key: item.evidenceId, className: 'litkb-chainPickRow' },
          h('div', { className: 'litkb-chainPickTop' },
            h('span', { className: 'litkb-evPage' }, `p.${item.page}`),
            poolSource === 'all' ? h('span', { className: 'litkb-chainPickPaper', title: item.title }, item.title || '') : null,
            h('button', {
              type: 'button', className: 'litkb-miniBtn', disabled: added,
              onClick: () => addNode(item),
            }, added ? '已添加' : '＋ 添加')),
          h('div', { className: 'litkb-chainPickQuote' }, item.quote),
          item.section ? h('div', { className: 'litkb-chainPickMeta' }, item.section) : null)
      }
      const nodeRow = (node) => {
        const quote = String(node.quote || '')
        const expanded = Boolean(expandedQuotes[node.evidenceId])
        return h('div', { key: node.evidenceId, className: 'litkb-chainNode' + (node.stale ? ' is-stale' : '') },
          h('div', { className: 'litkb-chainNodeTop' },
            h('select', {
              className: 'litkb-input litkb-chainRel', value: node.relation, title: '关系',
              'data-relation': node.relation,
              onChange: (e) => setRelation(node.evidenceId, e.target.value),
            }, CHAIN_RELATIONS.map(([value, label]) => h('option', { key: value, value }, label))),
            h('span', { className: 'litkb-chainNodeTitle', title: node.title || node.paperId }, node.title || node.paperId),
            node.stale
              ? h('span', { className: 'litkb-numBad' }, '已失效')
              : h('button', {
                  type: 'button', className: 'litkb-evPage',
                  onClick: () => onOpenPdf && onOpenPdf(node.paperId, node.page, node.block),
                }, `p.${node.page}`),
            h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => removeNode(node.evidenceId) }, '移除')),
          h('div', { className: 'litkb-chainNodeQuote' + (expanded ? ' is-open' : '') }, quote),
          quote.length > 140
            ? h('button', {
                type: 'button', className: 'litkb-chainQuoteToggle',
                onClick: () => setExpandedQuotes((current) => ({ ...current, [node.evidenceId]: !current[node.evidenceId] })),
              }, expanded ? '收起' : '展开全文')
            : null,
          h('input', {
            className: 'litkb-input litkb-chainNote', value: node.note || '',
            placeholder: '备注：我为什么把它挂在这里（可选）',
            onChange: (e) => setNote(node.evidenceId, e.target.value),
          }))
      }

      return h('div', {
        className: 'litkb-chainModal',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
      },
      h('div', { className: 'litkb-chainDialog', ref: dialogRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': '证据链' },
        h('div', { className: 'litkb-chainHead' },
          h('div', null,
            h('div', { className: 'litkb-chainTitle' }, '证据链'),
            h('div', { className: 'litkb-muted' },
              `${CHAIN_ORIGIN[mode] || '论点先行'} · ${contextTitle ? contextTitle.slice(0, 40) : '从证据构建论证'}`)),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-close', title: '关闭（Esc）', onClick: onClose }, '×')),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
        loadingChain
          ? h('div', { className: 'litkb-muted', style: { padding: '20px' } }, '加载链…')
          : h('div', { className: 'litkb-chainBody' },
              h('div', { className: 'litkb-chainLeft' },
                h('div', { className: 'litkb-chainField' },
                  h('label', { className: 'litkb-chainLabel' }, '研究问题（可选）'),
                  h('input', {
                    className: 'litkb-input', value: question, placeholder: '这条链要回答什么问题？',
                    onChange: (e) => setQuestion(e.target.value),
                  })),
                h('div', { className: 'litkb-chainField' },
                  h('label', { className: 'litkb-chainLabel' }, '论点'),
                  h('textarea', {
                    className: 'litkb-input litkb-chainClaim', value: claim, 'data-autofocus': 'true',
                    placeholder: '一句话写出你要辩护的判断…',
                    onChange: (e) => setClaim(e.target.value),
                  })),
                h('div', { className: 'litkb-chainActions' },
                  h('button', {
                    type: 'button', className: 'litkb-miniBtn', disabled: busy === 'propose',
                    onClick: () => propose('claim'),
                  }, busy === 'propose' ? '提议中…' : '按论点找证据'),
                  h('button', {
                    type: 'button', className: 'litkb-miniBtn', disabled: busy === 'propose' || !question.trim(),
                    onClick: () => propose('question'),
                  }, '按问题跨论文找证据'),
                  h('button', {
                    type: 'button', className: 'litkb-miniBtn', disabled: busy === 'propose' || !nodes.length,
                    onClick: () => propose('evidence', claim, question, nodes.map((node) => node.evidenceId)),
                  }, '按已选证据提论点'),
                  h('span', { className: 'litkb-spacer' }),
                  h('span', { className: 'litkb-muted' }, `${nodes.length} 条证据`)),
                warnings.length ? h('div', { className: 'litkb-chainWarn' }, warnings.join('；')) : null,
                nodes.length > 1
                  ? h('div', { className: 'litkb-chainBatchRel' },
                      h('span', { className: 'litkb-muted' }, '批量关系'),
                      h('select', {
                        className: 'litkb-input litkb-chainRel', value: '', title: '把下面所有证据设为同一关系',
                        onChange: (e) => {
                          if (!e.target.value) return
                          setNodes((current) => current.map((node) => ({ ...node, relation: e.target.value })))
                        },
                      },
                        h('option', { value: '' }, '选择…'),
                        CHAIN_RELATIONS.map(([value, label]) => h('option', { key: value, value }, label))))
                  : null,
                h('div', { className: 'litkb-chainNodes' },
                  nodes.length
                    ? nodes.map(nodeRow)
                    : h('div', { className: 'litkb-muted' }, '还没有证据节点；从右侧「本论文证据」或「全库」里选一条添加。'))),
              h('aside', { className: 'litkb-chainPick' },
                h('div', { className: 'litkb-chainPickHead' },
                  h('div', { className: 'litkb-chainPickTitle' }, '添加证据'),
                  h('div', { className: 'litkb-seg' },
                    h('button', {
                      type: 'button',
                      className: 'litkb-segBtn' + (poolSource === 'paper' ? ' litkb-on' : ''),
                      onClick: () => setPoolSource('paper'),
                    }, `本论文 ${paperEvidence.length}`),
                    h('button', {
                      type: 'button',
                      className: 'litkb-segBtn' + (poolSource === 'all' ? ' litkb-on' : ''),
                      onClick: () => setPoolSource('all'),
                    }, '全库'))),
                h('div', { className: 'litkb-chainPickHint' },
                  poolSource === 'paper'
                    ? '从这篇论文已有的证据里选一条，点「添加」直接挂到链上。'
                    : '全库检索引文与论文标题；可跨论文补证据。'),
                h('input', {
                  className: 'litkb-input', value: searchQuery,
                  placeholder: poolSource === 'paper' ? '搜本论文证据…' : '搜全库引文 / 标题…',
                  onChange: (e) => setSearchQuery(e.target.value),
                }),
                (poolSource === 'paper' ? poolLoading : searching)
                  ? h('div', { className: 'litkb-muted' }, '加载中…') : null,
                h('div', { className: 'litkb-chainPickList' },
                  poolSource === 'paper'
                    ? (paperEvidence.length
                        ? (paperPool.length
                            ? paperPool.slice(0, 80).map(pickRow)
                            : h('div', { className: 'litkb-muted' }, '本论文没有匹配的证据'))
                        : h('div', { className: 'litkb-muted' },
                            poolLoading ? '加载本论文证据…' : '本论文还没有证据；先生成七段卡，或切到「全库」。'))
                    : (searchResults.length
                        ? searchResults.slice(0, 30).map(pickRow)
                        : h('div', { className: 'litkb-muted' }, searching ? '搜索中…' : '没有匹配证据'))))),
        h('div', { className: 'litkb-chainFoot' },
          h('label', { className: 'litkb-chainDraftPick' },
            h('span', { className: 'litkb-muted' }, '插入到'),
            h('select', {
              className: 'litkb-input litkb-chainDraft', value: targetDraft,
              onChange: (e) => setTargetDraft(e.target.value),
            },
            h('option', { value: '__new__' }, '＋ 新建文稿'),
            drafts.map((draft) => h('option', { key: draft.id, value: draft.id }, draft.title || draft.id)))),
          h('span', { className: 'litkb-spacer' }),
          h('button', {
            type: 'button', className: 'litkb-btn', disabled: !ready,
            onClick: save,
          }, busy === 'save' ? '保存中…' : '保存链'),
          h('button', {
            type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: !ready,
            onClick: insert,
          }, busy === 'insert' ? '插入中…' : '插入文稿'),
          chainId
            ? h('button', { type: 'button', className: 'litkb-miniBtn litkb-chainDel', onClick: remove }, '删除链')
            : null)))
    }

    function BacklinksButton({ paperId, quoteId }) {
      const [open, setOpen] = useState(false)
      const [links, setLinks] = useState(null)
      const [loading, setLoading] = useState(false)
      const [err, setErr] = useState('')
      const toggle = async () => {
        if (open) { setOpen(false); return }
        setOpen(true)
        if (links !== null) return
        setLoading(true)
        setErr('')
        try {
          const data = await api('/api/litkb/evidence/backlinks?id=' + encodeURIComponent(quoteId)
            + '&paper=' + encodeURIComponent(paperId))
          setLinks(data.links || [])
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }
      return h('span', { className: 'litkb-backlinkWrap' },
        h('button', { type: 'button', className: 'litkb-miniBtn', onClick: toggle },
          `反链${links ? ` ${links.length}` : ''}`),
        open
          ? h('div', { className: 'litkb-backlinks' },
              loading ? h('span', { className: 'litkb-muted' }, '查询中…') : null,
              err ? h('span', { className: 'litkb-error' }, err) : null,
              links && links.length === 0 ? h('span', { className: 'litkb-muted' }, '未被引用') : null,
              (links || []).map((link, index) => h('div', { key: link.file + index, className: 'litkb-backlink' },
                h('span', { className: 'litkb-backlinkFile' }, `${link.file}:${link.line}`),
                h('span', { className: 'litkb-backlinkText' }, link.text))))
          : null)
    }

    /* ---------------- 标签管理 ---------------- */
    function TagsEditor({ tags, onChanged }) {
      const [drafts, setDrafts] = useState(() => Object.fromEntries(tags.map((t) => [t.name, (t.keywords || []).join(', ')])))
      const [name, setName] = useState('')
      const [keywords, setKeywords] = useState('')
      const [err, setErr] = useState('')

      const create = async () => {
        const n = name.trim()
        if (!n) return
        try {
          await api('/api/litkb/tags/create', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: n, keywords: keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }),
          })
          setName('')
          setKeywords('')
          setErr('')
          onChanged()
        } catch (e) { setErr(String(e.message || e)) }
      }

      const saveKeywords = async (tagName) => {
        try {
          await api('/api/litkb/tags/create', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: tagName, keywords: (drafts[tagName] || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean) }),
          })
          onChanged()
        } catch (e) { setErr(String(e.message || e)) }
      }

      const remove = async (tag) => {
        if (!window.confirm(`删除标签「${tag.name}」？将从 ${tag.count} 篇论文上摘除，不可撤销。`)) return
        try {
          await api('/api/litkb/tags/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: tag.name, confirmed: true }),
          })
          onChanged()
        } catch (e) { setErr(String(e.message || e)) }
      }

      const rerun = async () => {
        if (!window.confirm('按当前标签重跑全部论文？会自动生成的标签会被覆盖（人工修改也会）。')) return
        try {
          await api('/api/litkb/reclassify', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ replace: true }),
          })
          onChanged()
        } catch (e) { setErr(String(e.message || e)) }
      }

      return h('div', { className: 'litkb-manageSection' },
        err ? h('div', { className: 'litkb-error' }, err) : null,
        h('div', { className: 'litkb-tagAdd' },
          h('input', { className: 'litkb-input', placeholder: '新标签名', value: name, onChange: (e) => setName(e.target.value) }),
          h('input', { className: 'litkb-input', placeholder: '关键词，逗号分隔（可留空）', value: keywords, onChange: (e) => setKeywords(e.target.value) }),
          h('button', { type: 'button', className: 'litkb-btn', onClick: create }, '添加标签')),
        h('div', { className: 'litkb-tagList' },
          tags.length === 0 ? h('div', { className: 'litkb-muted' }, '还没有标签') : null,
          tags.map((t) => h('div', { key: t.name, className: 'litkb-tagRow' },
            h('div', { className: 'litkb-tagHead' },
              h('span', { className: 'litkb-tagName' }, t.name),
              h('span', { className: 'litkb-muted' }, `${t.count} 篇`),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-link', onClick: () => remove(t) }, '删除')),
            h('input', {
              className: 'litkb-input',
              placeholder: '关键词，逗号分隔',
              value: drafts[t.name] ?? '',
              onChange: (e) => setDrafts({ ...drafts, [t.name]: e.target.value }),
              onBlur: () => saveKeywords(t.name),
            })))),
        h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', style: { alignSelf: 'flex-start' }, onClick: rerun }, '按当前标签重跑全部'))
    }

    function ManagePanel({ tags, onClose, onChanged }) {
      const [tab, setTab] = useState('tags')
      const [terms, setTerms] = useState(null)
      const [notice, setNotice] = useState('')
      const [err, setErr] = useState('')

      useEffect(() => {
        let alive = true
        api('/api/litkb/glossary')
          .then((data) => { if (alive) setTerms(data.terms || []) })
          .catch((e) => { if (alive) setErr(String(e.message || e)) })
        return () => { alive = false }
      }, [])

      const tabBtn = (key, label, count) => h('button', {
        type: 'button', className: 'litkb-manageTab' + (tab === key ? ' is-on' : ''),
        onClick: () => setTab(key),
      }, label, count == null ? null : h('span', { className: 'litkb-filterCount' }, count))

      return h('div', { className: 'litkb-managePanel' },
        h('div', { className: 'litkb-manageHead' },
          h('span', { className: 'litkb-blockTitle' }, '标签与术语'),
          h('div', { className: 'litkb-manageTabs' },
            tabBtn('tags', '标签', tags.length),
            tabBtn('terms', '术语表', terms?.length)),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: onClose }, '返回阅读')),
        h('div', { className: 'litkb-manageBody' },
          notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
          err ? h('div', { className: 'litkb-error' }, err) : null,
          tab === 'tags'
            ? h(TagsEditor, { tags, onChanged })
            : terms === null
              ? h('div', { className: 'litkb-muted' }, '术语表加载中…')
              : h(GlossaryEditor, {
                  terms, embedded: true,
                  onClose: () => setTab('tags'),
                  onSaved: (next, changed) => {
                    setTerms(next)
                    setNotice(changed ? `已保存：${changed} 条改动，重新翻译后生效` : '已保存')
                    if (changed && onChanged) onChanged()
                  },
                })))
    }

    function Toast({ toast, onClose, onOpen, onResults }) {
      return h('div', { className: `litkb-toast is-${toast.kind}` },
        h('div', { className: 'litkb-toastTitle' }, toast.title),
        toast.detail ? h('div', { className: 'litkb-toastText' }, toast.detail) : null,
        h('div', { className: 'litkb-toastActions' },
          toast.action === 'open' && toast.paper
            ? h('button', { type: 'button', className: 'litkb-link', onClick: () => onOpen(toast.paper) }, '打开')
            : null,
          toast.action === 'results'
            ? h('button', { type: 'button', className: 'litkb-link', onClick: onResults }, '查看')
            : null,
          h('button', { type: 'button', className: 'litkb-toastClose', onClick: onClose, 'aria-label': '关闭提示' }, '×')))
    }

    function ResultsPanel({ items, onClose, onRetry, onOpen }) {
      const labels = { added: '新增', duplicate: '重复', failed: '失败' }
      return h('div', { className: 'litkb-drawerWrap', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('aside', { className: 'litkb-drawer', role: 'dialog', 'aria-label': '导入结果' },
          h('div', { className: 'litkb-drawerHead' },
            h('span', { className: 'litkb-blockTitle' }, '导入结果'),
            h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
          h('div', { className: 'litkb-drawerBody' },
            items.map((it) => h('div', { key: it.key, className: 'litkb-resultRow' },
              h('div', { className: 'litkb-resultTop' },
                h('span', { className: 'litkb-resultName', title: it.name }, it.name),
                h('span', { className: 'litkb-resultStatus is-' + it.status }, labels[it.status] || it.status)),
              it.reason ? h('div', { className: 'litkb-resultReason' }, it.reason) : null,
              h('div', { className: 'litkb-resultActions' },
                it.status === 'failed'
                  ? h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: () => onRetry(it) }, '重试')
                  : null,
                it.paper
                  ? h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: () => onOpen(it.paper) }, '打开')
                  : null)))))) 
    }

    function field(label, node) {
      return h('label', { className: 'litkb-field' },
        h('span', { className: 'litkb-fieldLabel' }, label), node)
    }
    function metaLine(k, v) {
      return h('div', { className: 'litkb-metaLine', key: k },
        h('span', { className: 'litkb-metaKey' }, k),
        h('span', { className: 'litkb-metaValue', title: v }, v))
    }
    /* ---------------- 划词追问（P3） ---------------- */
    function AskPanel({ paper, selection, onClose, onOpenPdf, onSaved, inline = false }) {
      const [question, setQuestion] = useState('')
      const [answer, setAnswer] = useState(null)
      const [loading, setLoading] = useState(false)
      const [err, setErr] = useState('')
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)

      const submit = async () => {
        const text = question.trim()
        if (!text || loading) return
        setLoading(true)
        setErr('')
        setAnswer(null)
        setSaved(false)
        try {
          const data = await api('/api/litkb/ask', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: paper.id,
              question: text,
              selection: selection?.text || '',
              page: selection?.page || 0,
              blockId: selection?.blockId || '',
            }),
          })
          setAnswer(data)
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }

      const saveNote = async () => {
        if (!answer?.answer || saving) return
        setSaving(true)
        setErr('')
        try {
          const note = `追问：${question}\n${answer.answer}`.slice(0, 1000)
          await api('/api/litkb/card/annotate', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: paper.id, text: note }),
          })
          setSaved(true)
          if (onSaved) onSaved()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      const invalid = answer?.invalidCitations || []
      const parts = String(answer?.answer || '').split(/(\[p\.\s*\d+\s*\])/gi)
      const presets = ['它和 baseline 差在哪？', '这段的方法是什么？', '有什么局限？']

      const card = h('div', { className: 'litkb-askCard', role: inline ? 'region' : 'dialog', 'aria-label': '划词追问' },
        h('div', { className: 'litkb-askHead' },
          h('span', { className: 'litkb-askTitle' }, '追问'),
          h('span', { className: 'litkb-muted' }, selection?.page ? `依据 p.${selection.page}` : '仅依据本文材料'),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
        h('div', { className: 'litkb-askSelection' }, `“${String(selection?.text || '').slice(0, 240)}”`),
        h('div', { className: 'litkb-askInputRow' },
          h('textarea', {
            className: 'litkb-input litkb-textarea', value: question,
            placeholder: '针对这段问一句，例如：它和 baseline 差在哪？',
            onChange: (e) => setQuestion(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() },
          }),
          h('button', { type: 'button', className: 'litkb-btn', disabled: !question.trim() || loading, onClick: submit },
            loading ? '回答中…' : '提问')),
        h('div', { className: 'litkb-askPresets' },
          presets.map((preset) => h('button', {
            key: preset, type: 'button', className: 'litkb-chip is-select',
            onClick: () => setQuestion(preset),
          }, preset))),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        loading
          ? h('div', { className: 'litkb-progress' },
              h('span', { className: 'litkb-pulse', 'aria-hidden': 'true' }),
              '正在读原文并核对页码…')
          : null,
        answer
          ? h('div', { className: 'litkb-askBody' },
              (answer.warnings || []).length
                ? h('div', { className: 'litkb-warnings' },
                    h('div', { className: 'litkb-warnTitle' }, '需要核对'),
                    answer.warnings.map((w, i) => h('div', { key: i, className: 'litkb-warnLine' }, '· ' + w)))
                : null,
              h('div', { className: 'litkb-askAnswer' },
                parts.map((part, index) => {
                  const match = part.match(/^\[p\.\s*(\d+)\s*\]$/i)
                  if (!match) return h('span', { key: index }, part)
                  const page = Number(match[1])
                  const bad = invalid.includes(page)
                  return h('button', {
                    key: index, type: 'button',
                    className: 'litkb-cite' + (bad ? ' is-bad' : ''),
                    title: bad ? '这个页码不在本次材料内' : `打开 p.${page}`,
                    disabled: bad,
                    onClick: () => { if (!bad && onOpenPdf) onOpenPdf(page) },
                  }, part)
                })),
              (answer.citations || []).length
                ? h('div', { className: 'litkb-askCites' },
                    h('div', { className: 'litkb-askCitesTitle' }, '依据'),
                    answer.citations.map((cite) => h('div', { key: cite.page, className: 'litkb-askCite' },
                      h('button', {
                        type: 'button', className: 'litkb-evPage',
                        onClick: () => onOpenPdf && onOpenPdf(cite.page),
                      }, `p.${cite.page}`),
                      h('span', { className: 'litkb-askCiteText' }, (cite.snippets || []).join(' / ') || '（无片段）'))))
                : null,
              answer.invalidCitations?.length
                ? h('div', { className: 'litkb-askBadCites' },
                    '越界页码：', answer.invalidCitations.map((page) => `p.${page}`).join('、'))
                : null,
              h('div', { className: 'litkb-askActions' },
                h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: saving || saved, onClick: saveNote },
                  saved ? '已存为批注' : saving ? '保存中…' : '存为批注'),
                h('span', { className: 'litkb-muted' }, answer.model || ''),
                h('span', { className: 'litkb-spacer' }),
                h('span', { className: 'litkb-muted' }, `材料页码 ${answer.pagesUsed?.length || 0} 页`)))
          : null)
      if (inline) return h('div', { className: 'litkb-askInline' }, card)
      return h('div', {
        className: 'litkb-askWrap',
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() },
      }, card)
    }

    /* ---------------- 图谱（P3） ---------------- */
    const GRAPH_KIND_LABEL = { method: '方法', dataset: '数据集', metric: '指标' }
    const GRAPH_EDGE_LABEL = { uses: '使用', improves_on: '改进', evaluates_on: '评测于', reports: '报告' }
    const GRAPH_EDGE_COLOR = { uses: '#4f8ef7', improves_on: '#3fb950', evaluates_on: '#d29922', reports: '#a371f7' }
    const GRAPH_KIND_COLOR = { method: '#3fb950', dataset: '#d29922', metric: '#a371f7' }


    function graphEdgeColor(type) {
      return GRAPH_EDGE_COLOR[type] || '#6b7280'
    }

    /** 简易力导向布局：斥力 O(n²) + 边弹簧 + 向心；300 节点一次算完。 */
    function computeForceLayout(nodes, edges, width, height) {
      const positions = new Map()
      const n = nodes.length
      if (!n) return positions
      const index = new Map(nodes.map((node, i) => [node.id, i]))
      const xs = new Float64Array(n)
      const ys = new Float64Array(n)
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.36
      for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2 + (i % 5) * 0.17
        const r = radius * (0.45 + (((i * 37) % 100) / 100) * 0.55)
        xs[i] = cx + Math.cos(angle) * r
        ys[i] = cy + Math.sin(angle) * r
      }
      if (n === 1) { xs[0] = cx; ys[0] = cy }
      const links = edges
        .map((edge) => [index.get(edge.source), index.get(edge.target)])
        .filter(([a, b]) => a !== undefined && b !== undefined && a !== b)
      const iterations = n > 220 ? 150 : 220
      for (let iter = 0; iter < iterations; iter += 1) {
        const fx = new Float64Array(n)
        const fy = new Float64Array(n)
        for (let i = 0; i < n; i += 1) {
          for (let j = i + 1; j < n; j += 1) {
            const dx = xs[j] - xs[i]
            const dy = ys[j] - ys[i]
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const force = Math.min(60, 15000 / (dist * dist))
            const ux = dx / dist
            const uy = dy / dist
            fx[i] -= ux * force
            fy[i] -= uy * force
            fx[j] += ux * force
            fy[j] += uy * force
          }
        }
        for (const [a, b] of links) {
          const dx = xs[b] - xs[a]
          const dy = ys[b] - ys[a]
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (dist - 110) * 0.02
          const ux = dx / dist
          const uy = dy / dist
          fx[a] += ux * force
          fy[a] += uy * force
          fx[b] -= ux * force
          fy[b] -= uy * force
        }
        for (let i = 0; i < n; i += 1) {
          fx[i] += (cx - xs[i]) * 0.006
          fy[i] += (cy - ys[i]) * 0.006
          xs[i] = Math.max(24, Math.min(width - 24, xs[i] + Math.max(-10, Math.min(10, fx[i]))))
          ys[i] = Math.max(24, Math.min(height - 24, ys[i] + Math.max(-10, Math.min(10, fy[i]))))
        }
      }
      nodes.forEach((node, i) => positions.set(node.id, { x: xs[i], y: ys[i] }))
      return positions
    }

    function applyGraphFilters(graph, filters) {
      if (!graph) return { nodes: [], edges: [] }
      const topic = filters.topic
      const q = String(filters.q || '').trim().toLowerCase()
      const from = Number(filters.from) || 0
      const to = Number(filters.to) || 0
      const allowedPapers = new Set()
      for (const node of graph.nodes) {
        if (node.type !== 'paper') continue
        if (topic && !(node.topics || []).includes(topic)) continue
        if (from && (!node.year || node.year < from)) continue
        if (to && (!node.year || node.year > to)) continue
        allowedPapers.add(node.id)
      }
      let keep = new Set()
      for (const node of graph.nodes) {
        if (node.type === 'paper') {
          if (allowedPapers.has(node.id)) keep.add(node.id)
        } else if (filters.kinds[node.kind] !== false) {
          keep.add(node.id)
        }
      }
      let edges = graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target) && allowedPapers.has(edge.paper))
      if (q) {
        const matched = new Set()
        for (const node of graph.nodes) {
          if (!keep.has(node.id)) continue
          const names = [node.name, ...(node.aliases || [])].map((x) => String(x).toLowerCase())
          if (names.some((name) => name.includes(q))) matched.add(node.id)
        }
        const near = new Set(matched)
        for (const edge of edges) {
          if (matched.has(edge.source)) near.add(edge.target)
          if (matched.has(edge.target)) near.add(edge.source)
        }
        keep = new Set([...keep].filter((id) => near.has(id)))
        edges = edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target))
      }
      const degree = new Map()
      for (const edge of edges) {
        degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
        degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
      }
      for (const node of graph.nodes) {
        if (node.type === 'concept' && !degree.get(node.id)) keep.delete(node.id)
      }
      edges = edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target))
      return {
        nodes: graph.nodes.filter((node) => keep.has(node.id)),
        edges,
      }
    }

    function distanceToSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1
      const dy = y2 - y1
      const length = dx * dx + dy * dy
      if (!length) return Math.hypot(px - x1, py - y1)
      let t = ((px - x1) * dx + (py - y1) * dy) / length
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
    }

    function drawGraph(canvas, graph, positions, selected) {
      if (!canvas) return
      const width = canvas.clientWidth || 900
      const height = 500
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext && canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const byId = new Map(graph.nodes.map((node) => [node.id, node]))
      const selectedEdgeId = selected?.kind === 'edge' ? selected.id : null
      const selectedNodeId = selected?.kind === 'node' ? selected.id : null

      for (const edge of graph.edges) {
        const a = positions.get(edge.source)
        const b = positions.get(edge.target)
        if (!a || !b) continue
        const active = edge.id === selectedEdgeId
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = graphEdgeColor(edge.type)
        ctx.globalAlpha = active ? 0.95 : 0.35
        ctx.lineWidth = active ? 2.4 : 1
        ctx.stroke()
        if (active) {
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          ctx.globalAlpha = 1
          ctx.fillStyle = graphEdgeColor(edge.type)
          ctx.beginPath()
          ctx.arc(mx, my, 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      const labels = graph.nodes.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 40)
      const labelIds = new Set(labels.map((node) => node.id))
      for (const node of graph.nodes) {
        const pos = positions.get(node.id)
        if (!pos) continue
        const paper = node.type === 'paper'
        const radius = paper ? 9 : 5 + Math.min(5, node.degree || 0)
        const color = paper ? '#4f8ef7' : (GRAPH_KIND_COLOR[node.kind] || '#9aa4b2')
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.95
        ctx.fill()
        ctx.globalAlpha = 1
        if (selectedNodeId === node.id) {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2)
          ctx.strokeStyle = '#e6e8eb'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        if ((paper || labelIds.has(node.id)) && (node.degree || 0) > 0) {
          const text = String(node.name || '').slice(0, 22)
          ctx.font = paper ? '600 11px ui-sans-serif,system-ui' : '10px ui-sans-serif,system-ui'
          ctx.fillStyle = paper ? '#e6e8eb' : 'rgba(195,201,211,.85)'
          ctx.textAlign = 'center'
          ctx.fillText(text, pos.x, pos.y - radius - 5)
        }
      }
    }

    /* ---------------- 证据链知识库（Cytoscape.js） ---------------- */
    let cytoscapePromise = null
    function loadCytoscape() {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.reject(new Error('当前环境没有浏览器 DOM'))
      }
      if (window.cytoscape) return Promise.resolve(window.cytoscape)
      if (!cytoscapePromise) {
        cytoscapePromise = new Promise((resolve, reject) => {
          const existing = document.getElementById('litkb-cytoscape-script')
          if (existing) { existing.remove(); }
          const script = document.createElement('script')
          script.id = 'litkb-cytoscape-script'
          script.src = '/api/litkb/vendor/cytoscape.js'
          script.async = true
          script.onload = () => {
            if (window.cytoscape) resolve(window.cytoscape)
            else { cytoscapePromise = null; reject(new Error('Cytoscape 未初始化')) }
          }
          script.onerror = () => { cytoscapePromise = null; reject(new Error('Cytoscape 加载失败')) }
          document.head.appendChild(script)
        })
      }
      return cytoscapePromise
    }

    const GRAPH_PALETTES = {
      dark: {
        bg: '#0b0e14',
        baseBg: '#1f2937', baseBorder: '#475569', baseText: '#e2e8f0',
        claimBg: '#1e3a8a', claimBorder: '#60a5fa', claimText: '#eff6ff',
        evidenceBg: '#14532d', evidenceBorder: '#4ade80', evidenceText: '#dcfce7',
        paperBg: '#4c1d95', paperBorder: '#c084fc', paperText: '#f5f3ff',
        unchainedBg: '#1e1b4b', unchainedBorder: '#64748b', unchainedText: '#cbd5e1',
        stale: '#f59e0b', hover: '#e2e8f0',
        edgeLine: '#475569', edgeLabel: '#94a3b8', edgeLabelBg: '#0b0e14',
        supports: '#22c55e', supportsText: '#86efac',
        contradicts: '#ef4444', contradictsText: '#fca5a5',
        qualifies: '#f59e0b', qualifiesText: '#fcd34d',
        derives: '#3b82f6', derivesText: '#93c5fd',
        compares: '#a855f7', comparesText: '#d8b4fe',
        excerpt: '#334155', selected: '#22d3ee',
      },
      light: {
        bg: '#f8fafc',
        baseBg: '#ffffff', baseBorder: '#cbd5e1', baseText: '#0f172a',
        claimBg: '#dbeafe', claimBorder: '#2563eb', claimText: '#1e3a8a',
        evidenceBg: '#dcfce7', evidenceBorder: '#15803d', evidenceText: '#14532d',
        paperBg: '#f3e8ff', paperBorder: '#7e22ce', paperText: '#4c1d95',
        unchainedBg: '#f1f5f9', unchainedBorder: '#94a3b8', unchainedText: '#475569',
        stale: '#b45309', hover: '#0f172a',
        edgeLine: '#94a3b8', edgeLabel: '#475569', edgeLabelBg: '#ffffff',
        supports: '#16a34a', supportsText: '#15803d',
        contradicts: '#dc2626', contradictsText: '#b91c1c',
        qualifies: '#d97706', qualifiesText: '#b45309',
        derives: '#2563eb', derivesText: '#1d4ed8',
        compares: '#7c3aed', comparesText: '#6d28d9',
        excerpt: '#cbd5e1', selected: '#0891b2',
      },
    }

    function detectThemeMode(element) {
      try {
        const color = getComputedStyle(element).color || ''
        const parts = color.match(/\d+(?:\.\d+)?/g)
        if (!parts || parts.length < 3) return 'dark'
        const luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255
        return luminance > 0.55 ? 'dark' : 'light'
      } catch {
        return 'dark'
      }
    }

    function chainGraphStyle(mode = 'dark') {
      const p = GRAPH_PALETTES[mode] || GRAPH_PALETTES.dark
      const base = {
        label: 'data(short)', 'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'center',
        'font-size': 11, 'font-weight': 500, color: p.baseText,
        'background-color': p.baseBg, 'border-width': 1.5, 'border-color': p.baseBorder,
        'overlay-opacity': 0, 'text-max-width': 110, 'text-margin-y': 0,
      }
      return [
        { selector: 'node', style: { ...base, width: 150, height: 42 } },
        {
          selector: 'node[kind="claim"]',
          style: {
            width: 186, height: 48, 'text-max-width': 160, 'font-size': 12.5, 'font-weight': 600,
            'background-color': p.claimBg, 'border-color': p.claimBorder, color: p.claimText,
            shape: 'round-rectangle', 'border-width': 2,
          },
        },
        {
          selector: 'node[kind="evidence"]',
          style: {
            width: 118, height: 38, 'text-max-width': 100, 'font-size': 11,
            'background-color': p.evidenceBg, 'border-color': p.evidenceBorder, color: p.evidenceText,
            shape: 'round-tag', 'border-width': 1.5,
          },
        },
        {
          selector: 'node[kind="paper"]',
          style: {
            width: 128, height: 42, 'text-max-width': 108, 'font-size': 11,
            'background-color': p.paperBg, 'border-color': p.paperBorder, color: p.paperText,
            shape: 'ellipse', 'border-width': 1.5,
          },
        },
        { selector: 'node[?unchained]', style: { 'background-color': p.unchainedBg, 'border-color': p.unchainedBorder, 'border-style': 'dashed', color: p.unchainedText, opacity: 0.72 } },
        { selector: 'node[?stale]', style: { 'border-color': p.stale, 'border-style': 'dashed', opacity: 0.8 } },
        { selector: 'node.litkb-hover', style: { 'border-width': 3, 'border-color': p.hover } },
        {
          selector: 'edge',
          style: {
            width: 1.8, 'line-color': p.edgeLine, 'target-arrow-color': p.edgeLine,
            'target-arrow-shape': 'triangle', 'arrow-scale': 1.1, 'curve-style': 'bezier',
            label: 'data(label)', 'font-size': 8.5, color: p.edgeLabel,
            'text-background-color': p.edgeLabelBg, 'text-background-opacity': 0.92,
            'text-background-padding': '2px', 'text-rotation': 'autorotate',
          },
        },
        { selector: 'edge[kind="supports"]', style: { 'line-color': p.supports, 'target-arrow-color': p.supports, color: p.supportsText } },
        { selector: 'edge[kind="contradicts"]', style: { 'line-color': p.contradicts, 'target-arrow-color': p.contradicts, color: p.contradictsText } },
        { selector: 'edge[kind="qualifies"]', style: { 'line-color': p.qualifies, 'target-arrow-color': p.qualifies, color: p.qualifiesText } },
        { selector: 'edge[kind="derives"]', style: { 'line-color': p.derives, 'target-arrow-color': p.derives, color: p.derivesText, 'line-style': 'dashed' } },
        { selector: 'edge[kind="compares"]', style: { 'line-color': p.compares, 'target-arrow-color': p.compares, color: p.comparesText, 'line-style': 'dashed' } },
        { selector: 'edge[kind="excerpt"]', style: { 'line-color': p.excerpt, 'target-arrow-color': p.excerpt, 'line-style': 'dotted', width: 1.1, label: '' } },
        { selector: 'edge[?stale]', style: { 'line-color': p.stale, 'target-arrow-color': p.stale, 'line-style': 'dashed' } },
        { selector: 'node:selected', style: { 'border-color': p.selected, 'border-width': 3 } },
        { selector: 'edge:selected', style: { 'line-color': p.selected, 'target-arrow-color': p.selected, width: 2.4 } },
      ]
    }

    const CONCEPT_PALETTES = {
      dark: {
        paperBg: '#3b0764', paperBorder: '#c084fc', paperText: '#f5f3ff',
        methodBg: '#14532d', methodBorder: '#4ade80', methodText: '#dcfce7',
        datasetBg: '#78350f', datasetBorder: '#fbbf24', datasetText: '#fef3c7',
        metricBg: '#1e3a8a', metricBorder: '#60a5fa', metricText: '#dbeafe',
        uses: '#4f8ef7', improves: '#3fb950', evaluates: '#d29922', reports: '#a371f7',
        edgeLabel: '#94a3b8', edgeLabelBg: '#0b0e14', selected: '#22d3ee',
      },
      light: {
        paperBg: '#f3e8ff', paperBorder: '#7e22ce', paperText: '#4c1d95',
        methodBg: '#dcfce7', methodBorder: '#15803d', methodText: '#14532d',
        datasetBg: '#fef3c7', datasetBorder: '#b45309', datasetText: '#78350f',
        metricBg: '#dbeafe', metricBorder: '#2563eb', metricText: '#1e3a8a',
        uses: '#2563eb', improves: '#16a34a', evaluates: '#d97706', reports: '#7c3aed',
        edgeLabel: '#475569', edgeLabelBg: '#ffffff', selected: '#0891b2',
      },
    }

    function conceptGraphStyle(mode = 'dark') {
      const p = CONCEPT_PALETTES[mode] || CONCEPT_PALETTES.dark
      const base = {
        label: 'data(label)', 'text-wrap': 'wrap', 'text-valign': 'center', 'text-halign': 'center',
        'font-size': 11.5, 'font-weight': 500, color: p.methodText,
        'background-color': p.methodBg, 'border-width': 1.5, 'border-color': p.methodBorder,
        'overlay-opacity': 0, 'text-max-width': 110, 'text-margin-y': 0,
        width: 140, height: 40,
      }
      return [
        { selector: 'node', style: base },
        {
          selector: 'node[type="paper"]',
          style: {
            width: 152, height: 44, 'font-size': 11.5, 'font-weight': 600,
            'background-color': p.paperBg, 'border-color': p.paperBorder, color: p.paperText,
            shape: 'round-rectangle', 'border-width': 1.8,
          },
        },
        {
          selector: 'node[kind="method"]',
          style: { 'background-color': p.methodBg, 'border-color': p.methodBorder, color: p.methodText, shape: 'round-tag' },
        },
        {
          selector: 'node[kind="dataset"]',
          style: { 'background-color': p.datasetBg, 'border-color': p.datasetBorder, color: p.datasetText, shape: 'round-rectangle' },
        },
        {
          selector: 'node[kind="metric"]',
          style: { 'background-color': p.metricBg, 'border-color': p.metricBorder, color: p.metricText, shape: 'ellipse' },
        },
        { selector: 'node:selected', style: { 'border-color': p.selected, 'border-width': 3 } },
        {
          selector: 'edge',
          style: {
            width: 1.6, 'line-color': p.uses, 'target-arrow-color': p.uses,
            'target-arrow-shape': 'triangle', 'arrow-scale': 1.05, 'curve-style': 'bezier',
            label: 'data(label)', 'font-size': 8.5, color: p.edgeLabel,
            'text-background-color': p.edgeLabelBg, 'text-background-opacity': 0.92,
            'text-background-padding': '2px', 'text-rotation': 'autorotate',
          },
        },
        { selector: 'edge[kind="uses"]', style: { 'line-color': p.uses, 'target-arrow-color': p.uses } },
        { selector: 'edge[kind="improves_on"]', style: { 'line-color': p.improves, 'target-arrow-color': p.improves, 'line-style': 'dashed' } },
        { selector: 'edge[kind="evaluates_on"]', style: { 'line-color': p.evaluates, 'target-arrow-color': p.evaluates } },
        { selector: 'edge[kind="reports"]', style: { 'line-color': p.reports, 'target-arrow-color': p.reports, 'line-style': 'dotted' } },
        { selector: 'edge:selected', style: { 'line-color': p.selected, 'target-arrow-color': p.selected, width: 2.4 } },
      ]
    }

    function conceptNodeLabel(node) {
      const text = String(node.type === 'paper' ? (node.title || node.name || node.id) : (node.name || node.id))
      return text.length > 18 ? text.slice(0, 18) + '…' : text
    }

    function readConceptPositions() {
      try {
        const parsed = JSON.parse(window.localStorage?.getItem('litkb.conceptPositions.v2') || '{}')
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function saveConceptPositions(positions) {
      try { window.localStorage?.setItem('litkb.conceptPositions.v2', JSON.stringify(positions)) } catch { /* ignore */ }
    }

    function AutoChainPanel({ onClose, onChanged, onOpenChain, contextPaperId = '', contextPaperTitle = '' }) {
      const [drafts, setDrafts] = useState([])
      const [loading, setLoading] = useState(true)
      const [job, setJob] = useState(null)
      const [error, setError] = useState('')
      const [busyId, setBusyId] = useState('')
      const [autoConfirm, setAutoConfirm] = useState(false)
      const [runMode, setRunMode] = useState('paper')
      const [topic, setTopic] = useState('')
      const [sections, setSections] = useState({ conclusion: true, innovation: true, limitations: true, takeaways: true })
      const timerRef = useRef(null)

      const loadReview = useCallback(async () => {
        try {
          const data = await api('/api/litkb/chains/review')
          setDrafts(data.chains || [])
          setError('')
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => { loadReview() }, [loadReview])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

      const poll = async (id) => {
        try {
          const data = await api('/api/litkb/chains/auto/jobs?id=' + encodeURIComponent(id))
          setJob(data.job)
          if (data.job?.status === 'queued' || data.job?.status === 'running') {
            timerRef.current = setTimeout(() => poll(id), 1000)
          } else {
            await loadReview()
            if (onChanged) onChanged()
          }
        } catch (e) {
          setError(String(e.message || e))
        }
      }

      const run = async () => {
        setError('')
        try {
          const chosen = Object.keys(sections).filter((key) => sections[key])
          if (runMode === 'paper' && !chosen.length) { setError('至少选一个板块'); return }
          const data = await api('/api/litkb/chains/auto/run', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              scope: contextPaperId && runMode === 'paper' ? 'paper' : 'library',
              paperIds: contextPaperId && runMode === 'paper' ? [contextPaperId] : undefined,
              mode: runMode, topic: topic.trim(),
              sections: runMode === 'paper' ? chosen : [], autoConfirm,
            }),
          })
          setJob(data.job)
          if (data.job?.id) poll(data.job.id)
        } catch (e) {
          setError(String(e.message || e))
        }
      }

      const decide = async (id, action) => {
        setBusyId(id)
        setError('')
        try {
          await api('/api/litkb/chains/review', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, action }),
          })
          setDrafts((current) => current.filter((chain) => chain.id !== id))
          if (onChanged) onChanged()
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusyId('')
        }
      }

      const running = job && (job.status === 'queued' || job.status === 'running')
      return h('div', { className: 'litkb-chainModal', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'litkb-chainDialog litkb-autoDialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '自动建链与审核' },
          h('div', { className: 'litkb-chainHead' },
            h('div', { className: 'litkb-chainTitle' }, '自动建链与审核'),
            h('span', { className: 'litkb-muted' }, contextPaperTitle ? `当前论文：${contextPaperTitle.slice(0, 24)} · 待审 ${drafts.length} 条` : `待审 ${drafts.length} 条`),
            h('span', { className: 'litkb-spacer' }),
            h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
          h('div', { className: 'litkb-autoBody' },
            h('div', { className: 'litkb-autoRun' },
              h('div', { className: 'litkb-autoModes' },
                h('button', { type: 'button', className: 'litkb-autoMode' + (runMode === 'paper' ? ' is-on' : ''), onClick: () => setRunMode('paper') }, '单篇自动链'),
                h('button', { type: 'button', className: 'litkb-autoMode' + (runMode === 'cross' ? ' is-on' : ''), onClick: () => setRunMode('cross') }, '跨论文对比 / 矛盾')),
              h('div', { className: 'litkb-autoRunTitle' }, runMode === 'paper' ? '从精读自动抽链' : '跨论文自动对比 / 矛盾链'),
              h('div', { className: 'litkb-muted' },
                runMode === 'paper'
                  ? '按结论 / 创新点 / 局限 / 核心要点抽候选论点，每条必须锚定库内 q-id 证据；生成草稿，审核后确认。'
                  : '按主题把不同论文的相近 claim 配对，规则判断支持 / 限定 / 矛盾 / 对比；两侧都必须有 q-id 证据才生成草稿。'),
              runMode === 'paper'
                ? h('div', { className: 'litkb-autoChecks' },
                    [['conclusion', '结论'], ['innovation', '创新点'], ['limitations', '局限'], ['takeaways', '核心要点']].map(([key, label]) => h('label', { key, className: 'litkb-autoCheck' },
                      h('input', {
                        type: 'checkbox', checked: Boolean(sections[key]),
                        onChange: (e) => setSections((current) => ({ ...current, [key]: e.target.checked })),
                      }), label)))
                : h('input', {
                    className: 'litkb-input', placeholder: '主题（可选，例如：视盘分割 / 多模态情绪）',
                    value: topic, onChange: (e) => setTopic(e.target.value),
                  }),
              h('label', { className: 'litkb-autoCheck' },
                h('input', { type: 'checkbox', checked: autoConfirm, onChange: (e) => setAutoConfirm(e.target.checked) }),
                '高置信度（≥0.8）自动确认'),
              h('div', { className: 'litkb-inline' },
                h('button', { type: 'button', className: 'litkb-btn', disabled: Boolean(running), onClick: run },
                  running ? '建链中…' : (runMode === 'cross' ? '开始跨论文建链' : '开始自动建链')),
                h('span', { className: 'litkb-muted' }, autoConfirm ? '会直接写入 confirmed，谨慎使用' : '默认全部进审核队列'))),
            job
              ? h('div', { className: 'litkb-autoJob' },
                  h('div', { className: 'litkb-inline' },
                    h('span', { className: 'litkb-autoJobState' }, running ? '进行中' : (job.status === 'done' ? '完成' : job.status)),
                    h('span', { className: 'litkb-muted' }, job.mode === 'cross'
                      ? `跨论文 · 新建 ${job.created} · 跳过 ${job.skipped} · 失败 ${job.failed}`
                      : `论文 ${job.done}/${job.total} · 新建 ${job.created} · 跳过 ${job.skipped} · 失败 ${job.failed}`)),
                  running ? h('div', { className: 'litkb-autoBar' }, h('span', { style: { width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` } })) : null,
                  job.step ? h('div', { className: 'litkb-muted' }, job.step) : null,
                  job.mode === 'cross' && !running && job.created === 0
                    ? h('div', { className: 'litkb-muted' }, '没有找到可配对的跨论文 claim；试试同主题论文，或先用单篇自动链补链。')
                    : null,
                  job.errors?.length ? h('div', { className: 'litkb-error' }, job.errors.map((item) => item.message).join('；')) : null)
              : null,
            error ? h('div', { className: 'litkb-error' }, error) : null,
            h('div', { className: 'litkb-autoReviewHead' },
              h('span', { className: 'litkb-autoRunTitle' }, '待审核草稿'),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => loadReview() }, '刷新')),
            loading
              ? h('div', { className: 'litkb-muted' }, '加载审核队列…')
              : drafts.length
                ? h('div', { className: 'litkb-autoList' }, drafts.map((chain) => h('div', { key: chain.id, className: 'litkb-autoRow' },
                    h('div', { className: 'litkb-autoRowTop' },
                      h('span', { className: 'litkb-chip is-type' }, chain.origin === 'auto' ? '自动' : chain.origin),
                      h('span', { className: 'litkb-autoConfidence' }, `置信度 ${Math.round((Number(chain.confidence) || 0) * 100)}%`),
                      h('span', { className: 'litkb-muted' }, `${chain.nodes?.length || 0} 条证据`)),
                    h('div', { className: 'litkb-autoClaim' }, chain.claim?.text || chain.title),
                    h('div', { className: 'litkb-muted' }, chain.provenance?.kind === 'cross-paper'
                      ? `跨论文 · ${chain.paperIds?.length || 2} 篇`
                      : (chain.paperTitle || chain.claim?.paperId || '')),
                    chain.warnings?.length ? h('div', { className: 'litkb-autoWarn' }, chain.warnings.join('；')) : null,
                    h('div', { className: 'litkb-autoActions' },
                      h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: busyId === chain.id, onClick: () => decide(chain.id, 'reject') }, '拒绝'),
                      h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain && onOpenChain(chain.id) }, '编辑'),
                      h('button', { type: 'button', className: 'litkb-btn', disabled: busyId === chain.id, onClick: () => decide(chain.id, 'accept') }, busyId === chain.id ? '处理中…' : '确认')))))
                : h('div', { className: 'litkb-muted' }, '没有待审核草稿。先运行自动建链，或所有草稿已处理。'))))
    }

    function ChainGraphView({ onOpenChain, onOpenPdf, onOpenPaper, onGoLibrary, chainRevision = 0 }) {
      const [graph, setGraph] = useState(null)
      const [loading, setLoading] = useState(true)
      const [err, setErr] = useState('')
      const [engine, setEngine] = useState('loading')
      const [themeMode, setThemeMode] = useState('dark')
      const [autoOpen, setAutoOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [selected, setSelected] = useState(null)
      const [tip, setTip] = useState(null)
      const containerRef = useRef(null)
      const cyRef = useRef(null)
      const saveTimer = useRef(null)

      const load = useCallback(async () => {
        try {
          const data = await api('/api/litkb/chains/graph')
          setGraph(data.graph || { nodes: [], edges: [], stats: {}, positions: {} })
          setErr('')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => { load() }, [load, chainRevision])

      useEffect(() => {
        const element = containerRef.current
        if (!element) return undefined
        const update = () => setThemeMode(detectThemeMode(element))
        update()
        let observer = null
        if (typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(update)
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
          if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        }
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
        if (media?.addEventListener) media.addEventListener('change', update)
        return () => {
          if (observer) observer.disconnect()
          if (media?.removeEventListener) media.removeEventListener('change', update)
        }
      }, [])

      const savePositions = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          const cy = cyRef.current
          if (!cy) return
          const positions = {}
          cy.nodes().forEach((node) => {
            const pos = node.position()
            positions[node.id()] = { x: Math.round(pos.x), y: Math.round(pos.y) }
          })
          api('/api/litkb/chains/layout', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ positions }),
          }).catch(() => {})
        }, 600)
      }, [])

      useEffect(() => {
        const container = containerRef.current
        if (!graph || !container || !graph.nodes.length) {
          setEngine(graph ? 'ready' : 'loading')
          return undefined
        }
        let alive = true
        setEngine('loading')
        loadCytoscape().then((cytoscape) => {
          if (!alive || !containerRef.current) return
          if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
          const known = graph.positions || {}
          const allPositioned = graph.nodes.every((node) => known[node.data.id])
          const cy = cytoscape({
            container: containerRef.current,
            elements: [...graph.nodes, ...graph.edges],
            style: chainGraphStyle(themeMode),
            layout: { name: 'preset', positions: known, fit: false },
            minZoom: 0.15,
            maxZoom: 2.5,
            wheelSensitivity: 0.2,
            boxSelectionEnabled: false,
          })
          cyRef.current = cy
          const placeUnchainedPapers = () => {
            const isolated = cy.nodes('[kind="paper"]').filter((node) => node.data('unchained') && !known[node.id()])
            if (!isolated.length) return
            let bottom = 0
            cy.nodes().forEach((node) => { bottom = Math.max(bottom, node.position().y) })
            isolated.forEach((node, index) => {
              node.position({ x: 140 + (index % 6) * 200, y: bottom + 160 + Math.floor(index / 6) * 110 })
            })
          }
          if (!allPositioned && !Object.keys(known).length) {
            const roots = cy.nodes('[kind="claim"]')
            cy.layout({
              name: 'breadthfirst', roots: roots.length ? roots : undefined,
              directed: true, spacingFactor: 1.2, padding: 60, animate: false, fit: true,
            }).run()
            placeUnchainedPapers()
            cy.fit(undefined, 60)
            savePositions()
          } else if (!allPositioned) {
            // 保留已拖过位置的节点，只给新节点找位置：优先贴着已有邻居，否则排到右侧。
            const positioned = new Set(Object.keys(known))
            let maxX = 0
            for (const id of positioned) maxX = Math.max(maxX, Number(known[id]?.x) || 0)
            let cursorX = maxX + (maxX ? 320 : 120)
            let cursorY = 100
            for (const node of cy.nodes().filter((item) => !positioned.has(item.id()))) {
              const neighbors = node.neighborhood('node').filter((item) => positioned.has(item.id()))
              if (neighbors.length) {
                const base = neighbors[0].position()
                node.position({ x: base.x + 280, y: base.y + 70 })
              } else {
                node.position({ x: cursorX, y: cursorY })
                cursorY += 100
                if (cursorY > 900) { cursorX += 300; cursorY = 100 }
              }
              positioned.add(node.id())
            }
            placeUnchainedPapers()
            cy.fit(undefined, 60)
            savePositions()
          } else {
            cy.fit(undefined, 50)
          }
          cy.on('tap', 'node', (event) => {
            cy.elements().unselect(); event.target.select()
            setSelected({ kind: 'node', data: event.target.data() }); setTip(null)
          })
          cy.on('tap', 'edge', (event) => {
            cy.elements().unselect(); event.target.select()
            setSelected({ kind: 'edge', data: event.target.data() }); setTip(null)
          })
          cy.on('tap', (event) => { if (event.target === cy) { cy.elements().unselect(); setSelected(null); setTip(null) } })
          cy.on('mouseover', 'node', (event) => {
            event.target.addClass('litkb-hover')
            if (containerRef.current) containerRef.current.style.cursor = 'pointer'
            const data = event.target.data()
            const rect = containerRef.current?.getBoundingClientRect()
            if (!rect) return
            const source = event.originalEvent || {}
            setTip({
              x: Math.min(Math.max(8, (source.clientX || 0) - rect.left + 14), Math.max(8, rect.width - 300)),
              y: Math.min(Math.max(8, (source.clientY || 0) - rect.top + 14), Math.max(8, rect.height - 240)),
              kind: data.kind,
              text: String(data.full || data.quote || data.label || '').slice(0, 220),
              meta: data.kind === 'evidence' ? `p.${data.page}` : (data.unchained ? '未建链' : (data.year || '')),
            })
          })
          cy.on('mouseout', 'node', (event) => {
            event.target.removeClass('litkb-hover')
            if (containerRef.current) containerRef.current.style.cursor = ''
            setTip(null)
          })
          cy.on('dragfree', 'node', savePositions)
          setEngine('ready')
        }).catch((e) => {
          if (alive) { setEngine('failed'); setErr(String(e.message || '图引擎加载失败')) }
        })
        return () => {
          alive = false
          if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
        }
      }, [graph, savePositions])

      useEffect(() => {
        const cy = cyRef.current
        if (cy) cy.style(chainGraphStyle(themeMode))
      }, [themeMode])

      useEffect(() => {
        const cy = cyRef.current
        if (!cy) return
        const needle = query.trim().toLowerCase()
        cy.batch(() => {
          cy.nodes().forEach((node) => {
            const text = `${node.data('full') || ''} ${node.data('label') || ''} ${node.data('quote') || ''} ${node.data('title') || ''}`.toLowerCase()
            node.style('display', !needle || text.includes(needle) ? 'element' : 'none')
          })
          cy.edges().forEach((edge) => {
            const visible = edge.source().style('display') !== 'none' && edge.target().style('display') !== 'none'
            edge.style('display', visible ? 'element' : 'none')
          })
        })
      }, [query, graph])

      const nodes = graph?.nodes || []
      const edges = graph?.edges || []
      const stats = graph?.stats || {}
      const palette = GRAPH_PALETTES[themeMode] || GRAPH_PALETTES.dark
      const nodeById = (id) => nodes.find((node) => node.data.id === id)
      const zoomBy = (factor) => {
        const cy = cyRef.current
        if (!cy) return
        cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
      }
      const fit = () => { if (cyRef.current) cyRef.current.fit(undefined, 50) }
      const relayout = () => {
        const cy = cyRef.current
        if (!cy) return
        const roots = cy.nodes('[kind="claim"]')
        cy.one('layoutstop', savePositions)
        cy.layout({
          name: 'breadthfirst', roots: roots.length ? roots : undefined,
          directed: true, spacingFactor: 1.2, padding: 60, animate: true, animationDuration: 350,
        }).run()
      }

      const side = (() => {
        if (!selected) return null
        const data = selected.data || {}
        if (selected.kind === 'edge') {
          const source = nodeById(data.source)
          const target = nodeById(data.target)
          return h('div', { className: 'litkb-kbSideBody' },
            h('div', { className: 'litkb-kbSideKind is-edge' }, '关系'),
            h('div', { className: 'litkb-kbSideTitle' }, CHAIN_RELATION_LABELS[data.kind] || data.label || data.kind),
            h('div', { className: 'litkb-kbSideMeta' },
              `${source?.data.kind === 'claim' ? '论点' : '证据'} → ${target?.data.kind === 'paper' ? '论文' : '证据'}`),
            data.stale ? h('div', { className: 'litkb-kbWarn' }, '这条关系指向的证据已失效') : null,
            h('div', { className: 'litkb-kbSideQuote' }, source?.data.label || ''),
            h('div', { className: 'litkb-kbSideQuote' }, target?.data.label || ''))
        }
        if (data.kind === 'claim') {
          return h('div', { className: 'litkb-kbSideBody' },
            h('div', { className: 'litkb-kbSideKind is-claim' }, '论点'),
            h('div', { className: 'litkb-kbSideText' }, data.full || data.label),
            h('div', { className: 'litkb-kbSideMeta' },
              `${CHAIN_ORIGIN[data.origin] || '论证链'} · ${data.count || 0} 条证据`),
            h('div', { className: 'litkb-kbSideActions' },
              onOpenChain ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => onOpenChain(data.chainId) }, '打开链') : null,
              onOpenPaper && data.paperId ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenPaper(data.paperId) }, '看论文') : null))
        }
        if (data.kind === 'paper') {
          const chained = data.chained !== false && Number(data.chains) > 0
          return h('div', { className: 'litkb-kbSideBody' },
            h('div', { className: 'litkb-kbSideKind is-paper' }, '论文'),
            h('div', { className: 'litkb-kbSideText' }, data.full || data.label),
            h('div', { className: 'litkb-kbSideMeta' },
              chained
                ? `${data.chains || 0} 条证据链${data.year ? ' · ' + data.year : ''}`
                : `还没有证据链${data.year ? ' · ' + data.year : ''}，先从这篇论文建链`),
            chained ? null : h('div', { className: 'litkb-kbWarn' }, '这篇论文暂未进入知识库：建链后才会出现证据与关系。'),
            h('div', { className: 'litkb-kbSideActions' },
              onOpenPaper ? h('button', {
                type: 'button', className: chained ? 'litkb-miniBtn' : 'litkb-btn',
                onClick: () => onOpenPaper(data.paperId),
              }, chained ? '看论文' : '打开论文建链') : null))
        }
        return h('div', { className: 'litkb-kbSideBody' },
          h('div', { className: 'litkb-kbSideKind is-evidence' }, '证据'),
          h('div', { className: 'litkb-kbSideMeta' }, `p.${data.page} · ${data.title || data.paperId}`),
          data.stale ? h('div', { className: 'litkb-kbWarn' }, '该证据已失效（卡片重生成后找不到了）') : null,
          h('div', { className: 'litkb-kbSideQuote' }, data.full || data.quote || data.label),
          h('div', { className: 'litkb-kbSideActions' },
            onOpenPdf ? h('button', { type: 'button', className: 'litkb-btn', onClick: () => onOpenPdf(data.paperId, data.page, data.block || null) }, '回原文') : null,
            onOpenPaper ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenPaper(data.paperId) }, '看论文') : null))
      })()

      const empty = !loading && graph && !nodes.length
      return h('div', { className: 'litkb-kb' },
        h('div', { className: 'litkb-kbHead' },
          h('div', { className: 'litkb-kbTitle' }, '证据链知识库'),
          h('div', { className: 'litkb-kbStats' },
            h('span', { className: 'litkb-kbStat is-chain' }, h('b', null, stats.chains ?? 0), ' 链'),
            h('span', { className: 'litkb-kbStat is-evidence' }, h('b', null, stats.evidence ?? 0), ' 证据'),
            h('span', { className: 'litkb-kbStat is-paper' }, h('b', null, stats.papers ?? 0), ' 论文'),
            stats.unchainedPapers ? h('span', { className: 'litkb-kbStat is-unchained' }, h('b', null, stats.unchainedPapers), ' 未建链') : null,
            stats.staleEdges ? h('span', { className: 'litkb-kbStat is-warn' }, h('b', null, stats.staleEdges), ' 失效') : null),
          h('span', { className: 'litkb-spacer' }),
          h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: () => setAutoOpen(true) }, '自动建链 / 审核'),
          nodes.length ? h('input', {
            className: 'litkb-input litkb-kbSearch', placeholder: '搜论点 / 证据 / 论文…',
            value: query, onChange: (e) => setQuery(e.target.value),
          }) : null,
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: !nodes.length, onClick: () => zoomBy(0.8) }, '－'),
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: !nodes.length, onClick: () => zoomBy(1.25) }, '＋'),
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: !nodes.length, onClick: fit }, '适应'),
          h('button', { type: 'button', className: 'litkb-miniBtn', disabled: !nodes.length, onClick: relayout }, '重排'),
          h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => load().catch(() => {}) }, '刷新')),
        h('div', { className: 'litkb-kbLegend' },
          h('span', { className: 'litkb-kbLegendItem' },
            h('span', { className: 'litkb-kbNodeDot', style: { background: palette.claimBg, borderColor: palette.claimBorder } }), '论点'),
          h('span', { className: 'litkb-kbLegendItem' },
            h('span', { className: 'litkb-kbNodeDot', style: { background: palette.evidenceBg, borderColor: palette.evidenceBorder } }), '证据'),
          h('span', { className: 'litkb-kbLegendItem' },
            h('span', { className: 'litkb-kbNodeDot is-paper', style: { background: palette.paperBg, borderColor: palette.paperBorder } }), '论文'),
          h('span', { className: 'litkb-kbLegendItem' },
            h('span', { className: 'litkb-kbNodeDot is-unchained', style: { background: palette.unchainedBg, borderColor: palette.unchainedBorder } }), '未建链'),
          h('span', { className: 'litkb-kbLegendSep' }),
          ['supports', 'contradicts', 'qualifies', 'derives', 'compares'].map((key) => h('span', { key, className: 'litkb-kbLegendItem' },
            h('span', { className: 'litkb-kbDot', style: { background: palette[key] } }),
            CHAIN_RELATION_LABELS[key])),
          h('span', { className: 'litkb-kbLegendItem' }, h('span', { className: 'litkb-kbDot is-dashed' }), '失效'),
          h('span', { className: 'litkb-kbMuted' }, '拖动节点后自动保存布局')),
        stats.chains === 0
          ? h('div', { className: 'litkb-kbBanner' }, '还没有证据链：点下方论文节点打开论文，从段落/证据建链。')
          : null,
        h('div', { className: 'litkb-kbMain' },
          h('div', { className: 'litkb-kbCanvasWrap is-' + themeMode },
            h('div', { ref: containerRef, className: 'litkb-kbCanvas', 'aria-label': '证据链知识库' }),
            tip ? h('div', { className: 'litkb-kbTip', style: { left: tip.x + 'px', top: tip.y + 'px' } },
              h('div', { className: 'litkb-kbTipKind is-' + tip.kind }, CHAIN_KIND_LABELS[tip.kind] || '节点'),
              h('div', { className: 'litkb-kbTipText' }, tip.text),
              tip.meta ? h('div', { className: 'litkb-kbTipMeta' }, tip.meta) : null) : null,
            loading ? h('div', { className: 'litkb-kbOverlay' }, '加载知识库…') : null,
            empty ? h('div', { className: 'litkb-kbOverlay litkb-kbEmpty' },
              h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '◇'),
              h('div', { className: 'litkb-emptyTitle' }, '还没有证据链'),
              h('p', { className: 'litkb-emptyText' }, '到论文库从解析稿段落、证据行或精读论点建一条链；这里会自动长成可拖拽的知识库。'),
              onGoLibrary ? h('button', { type: 'button', className: 'litkb-btn', onClick: onGoLibrary }, '去论文库建链') : null) : null,
            !loading && err && !nodes.length ? h('div', { className: 'litkb-kbOverlay' },
              h('div', { className: 'litkb-error' }, err),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => load().catch(() => {}) }, '重试')) : null,
            engine === 'failed' ? h('div', { className: 'litkb-kbOverlay' },
              h('div', { className: 'litkb-error' }, err || '图引擎加载失败'),
              h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => { setErr(''); setEngine('loading'); load().catch(() => {}) } }, '重试')) : null),
          side ? h('aside', { className: 'litkb-kbSide' },
            h('button', { type: 'button', className: 'litkb-close litkb-kbSideClose', onClick: () => setSelected(null) }, '×'),
            side) : null),
        autoOpen
          ? h(AutoChainPanel, {
              onClose: () => setAutoOpen(false),
              onChanged: () => load().catch(() => {}),
              onOpenChain: (id) => { setAutoOpen(false); onOpenChain && onOpenChain(id) },
            })
          : null)
    }

    function comparePlain(markdown) {
      return String(markdown || '')
        .replace(/\[\[[^\]]*\]\]/g, ' ')
        .replace(/\[p\.[^\]]*\]/g, ' ')
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function compareNumbers(markdown) {
      const text = comparePlain(markdown)
      return [...new Set(text.match(/\d+(?:\.\d+)?%?/g) || [])].slice(0, 10)
    }

    function compareTokens(text) {
      const out = new Set()
      const value = String(text || '').toLowerCase()
      for (const token of value.match(/[a-z0-9][a-z0-9._+-]*/g) || []) {
        if (token.length >= 2) out.add(token)
      }
      for (const run of value.match(/[\u3400-\u9fff]+/g) || []) {
        for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2))
      }
      return out
    }

    function compareSimilarity(a, b) {
      const left = compareTokens(comparePlain(a))
      const right = compareTokens(comparePlain(b))
      if (!left.size || !right.size) return left.size === right.size ? 1 : 0
      let common = 0
      for (const token of left) if (right.has(token)) common += 1
      return common / Math.max(1, left.size + right.size - common)
    }

    function compareSectionMeta(section, papers) {
      const cells = papers.map((paper) => paper.sections?.[section.key]?.markdown || '')
      const numbers = cells.map((markdown) => compareNumbers(markdown))
      let textDiff = false
      let numberDiff = false
      for (let i = 0; i < papers.length; i += 1) {
        if (!cells[i]) { textDiff = true; continue }
        for (let j = i + 1; j < papers.length; j += 1) {
          if (!cells[j]) { textDiff = true; continue }
          if (compareSimilarity(cells[i], cells[j]) < 0.55) textDiff = true
          if (numbers[i].some((value) => !numbers[j].includes(value))
            || numbers[j].some((value) => !numbers[i].includes(value))) {
            numberDiff = true
            textDiff = true
          }
        }
      }
      return { cells, numbers, textDiff, numberDiff, diff: textDiff || numberDiff }
    }

    function compareCitationIds(markdown) {
      const out = []
      const regex = /\[\[(p-[a-zA-Z0-9_-]+)#\^(q-[0-9a-f]{8})(?:\|[^\]]*)?\]\]/g
      let match = regex.exec(String(markdown || ''))
      while (match) {
        out.push({ paperId: match[1], evidenceId: match[2] })
        match = regex.exec(String(markdown || ''))
      }
      return out
    }

    function ComparePanel({ papers = [], onOpenPaper, onBuildCompareChain, onSaveCompare }) {
      const [selected, setSelected] = useState(() => papers.slice(0, 2).map((paper) => paper.id))
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(false)
      const [onlyDiff, setOnlyDiff] = useState(false)
      const [collapsed, setCollapsed] = useState({})
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState('')
      const [err, setErr] = useState('')

      useEffect(() => {
        if (!selected.length && papers.length) setSelected(papers.slice(0, 2).map((paper) => paper.id))
      }, [papers.length])

      const load = async (ids = selected) => {
        if (!ids.length) { setErr('至少选一篇论文'); return }
        setLoading(true)
        setErr('')
        setNotice('')
        try {
          let payload = null
          try {
            payload = await api('/api/litkb/deepread/compare?ids=' + encodeURIComponent(ids.join(',')))
          } catch {
            // 旧服务端还没有 compare 路由时，退回逐篇读取 /deepread。
            const sectionMap = new Map()
            const rows = []
            for (const id of ids) {
              const record = papers.find((paper) => paper.id === id)
              const response = await api('/api/litkb/deepread?id=' + encodeURIComponent(id))
              const deepread = response?.deepread || null
              const sections = {}
              for (const section of deepread?.sections || []) {
                sections[section.key] = {
                  title: section.title, index: section.index, markdown: section.markdown || '',
                }
                if (!sectionMap.has(section.key)) {
                  sectionMap.set(section.key, { key: section.key, title: section.title, index: section.index || 99 })
                }
              }
              rows.push({
                id, title: record?.title || id, authors: record?.authors || '',
                year: record?.year || '', available: Boolean(deepread),
                generatedAt: deepread?.generatedAt || '', model: deepread?.model || '', sections,
              })
            }
            payload = { papers: rows, sections: [...sectionMap.values()].sort((a, b) => a.index - b.index) }
          }
          setData(payload)
          setCollapsed({})
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => { if (selected.length) load(selected) }, [])

      const toggle = (id) => {
        setSelected((current) => {
          if (current.includes(id)) return current.filter((item) => item !== id)
          if (current.length >= 4) return current
          return [...current, id]
        })
      }

      const rows = (data?.sections || []).map((section) => ({
        ...section,
        analysis: data ? compareSectionMeta(section, data.papers) : null,
      }))
      const visibleRows = onlyDiff ? rows.filter((section) => section.analysis?.diff) : rows
      const paperTitles = (data?.papers || []).map((paper) => paper.title)

      const buildMarkdown = () => {
        const lines = [`# 横向精读：${paperTitles.join(' vs ')}`]
        for (const section of visibleRows) {
          lines.push(`## ${section.index}. ${section.title}`)
          for (const paper of data.papers) {
            lines.push(`### ${paper.title}`)
            lines.push(paper.sections?.[section.key]?.markdown || (paper.available ? '（未说明）' : '（未精读）'))
          }
        }
        return lines.join('\n\n')
      }

      const copyCompare = async () => {
        if (!data) return
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(buildMarkdown())
          setNotice('已复制对比 Markdown')
        } catch {
          setNotice('复制失败，可改用「存为文稿」')
        }
      }

      const saveCompare = async () => {
        if (!onSaveCompare || !data || saving) return
        setSaving(true)
        setNotice('正在打开写作…')
        try {
          await onSaveCompare(buildMarkdown(), `横向精读：${paperTitles.join(' vs ').slice(0, 50)}`)
        } catch (e) {
          setNotice(String(e.message || e))
        } finally {
          setSaving(false)
        }
      }

      const buildChain = (section) => {
        if (!onBuildCompareChain || !data) return
        const citations = []
        const seen = new Set()
        for (const paper of data.papers) {
          for (const item of compareCitationIds(paper.sections?.[section.key]?.markdown || '')) {
            if (seen.has(item.evidenceId)) continue
            seen.add(item.evidenceId)
            citations.push(item)
          }
        }
        const paperIds = [...new Set(citations.map((item) => item.paperId))]
        if (citations.length < 2 || paperIds.length < 2) {
          setNotice('这个板块至少要有两篇论文的 q-id 引用，才能建对比链')
          return
        }
        const claim = `关于「${section.title}」，${paperTitles.join('、')}的结论存在差异，需要对比。`
        onBuildCompareChain({
          claim, evidenceIds: citations.map((item) => item.evidenceId).slice(0, 12),
          paperId: citations[0].paperId, sectionKey: section.key,
        })
      }

      return h('div', { className: 'litkb-compareDeep' },
        h('div', { className: 'litkb-compareHead' },
          h('div', null,
            h('div', { className: 'litkb-searchTitle' }, '横向精读'),
            h('div', { className: 'litkb-muted' }, '选 2–4 篇，按 11 板块并排看；差异按数字/文本相似度自动标记。')),
          h('span', { className: 'litkb-spacer' }),
          h('button', {
            type: 'button', className: 'litkb-searchMode' + (onlyDiff ? ' is-on' : ''),
            onClick: () => setOnlyDiff((value) => !value),
          }, onlyDiff ? '看全部' : '只看差异'),
          data ? h('button', { type: 'button', className: 'litkb-miniBtn', onClick: copyCompare }, '复制对比') : null,
          onSaveCompare && data
            ? h('button', { type: 'button', className: 'litkb-miniBtn', disabled: saving, onClick: saveCompare }, saving ? '保存中…' : '存为文稿')
            : null,
          h('button', { type: 'button', className: 'litkb-btn', disabled: loading, onClick: () => load() }, loading ? '加载中…' : '加载对比')),
        h('div', { className: 'litkb-comparePapers' }, papers.map((paper) => h('button', {
          key: paper.id, type: 'button',
          className: 'litkb-chip is-select' + (selected.includes(paper.id) ? ' is-on' : ''),
          onClick: () => toggle(paper.id),
          title: paper.title,
        }, paper.title || paper.id))),
        err ? h('div', { className: 'litkb-error' }, err) : null,
        notice ? h('div', { className: 'litkb-glossNotice' }, notice) : null,
        !data
          ? h('div', { className: 'litkb-empty' }, h('div', { className: 'litkb-muted' }, '选择论文后加载横向对比'))
          : !data.papers.length
            ? h('div', { className: 'litkb-empty' }, h('div', { className: 'litkb-muted' }, '没有可比较的论文'))
            : !visibleRows.length
              ? h('div', { className: 'litkb-empty' }, h('div', { className: 'litkb-muted' }, onlyDiff ? '这些板块没有检测到差异。' : '没有可比较的板块。'))
              : h('div', { className: 'litkb-compareScroll' },
                  h('table', { className: 'litkb-compareGrid' },
                    h('thead', null, h('tr', null,
                      h('th', { className: 'litkb-compareSection' }, '板块'),
                      data.papers.map((paper) => h('th', { key: paper.id },
                        h('div', { className: 'litkb-comparePaperTitle', title: paper.title }, paper.title),
                        h('div', { className: 'litkb-muted' }, `${paper.authors || ''} ${paper.year || ''}${paper.available ? '' : ' · 未精读'}`))))),
                    h('tbody', null, visibleRows.map((section) => {
                      const isCollapsed = Boolean(collapsed[section.key])
                      return h('tr', { key: section.key, className: section.analysis?.diff ? 'is-diff' : '' },
                        h('th', { className: 'litkb-compareSection' },
                          h('button', {
                            type: 'button', className: 'litkb-compareSectionBtn',
                            onClick: () => setCollapsed((current) => ({ ...current, [section.key]: !current[section.key] })),
                          }, `${isCollapsed ? '▸' : '▾'} ${section.index}. ${section.title}`),
                          section.analysis?.diff
                            ? h('span', { className: 'litkb-compareDiffBadge' }, section.analysis.numberDiff ? '数字差异' : '文本差异')
                            : null,
                          h('button', {
                            type: 'button', className: 'litkb-compareChainBtn',
                            disabled: !onBuildCompareChain,
                            onClick: () => buildChain(section),
                          }, '对比链')),
                        isCollapsed
                          ? h('td', { colSpan: data.papers.length, className: 'litkb-compareCollapsed' }, '已折叠，点板块名展开')
                          : data.papers.map((paper) => {
                              const cell = paper.sections?.[section.key]
                              const nums = section.analysis?.numbers?.[data.papers.indexOf(paper)] || []
                              const other = new Set(section.analysis?.numbers?.filter((_, index) => index !== data.papers.indexOf(paper)).flat() || [])
                              return h('td', { key: paper.id, className: 'litkb-compareCell' },
                                nums.length
                                  ? h('div', { className: 'litkb-compareNums' }, nums.map((value) => h('span', {
                                      key: value, className: 'litkb-compareNum' + (other.has(value) ? '' : ' is-diff'),
                                    }, value)))
                                  : null,
                                cell?.markdown
                                  ? renderMarkdown(cell.markdown, { onOpenPaper: (paperId, page) => onOpenPaper && onOpenPaper(paperId, page) })
                                  : h('span', { className: 'litkb-muted' }, paper.available ? '—' : '未精读'))
                            }))
                    })))))
    }

    function GraphPanel({ papers = [], onOpenPaper, onOpenPdf, onOpenChain, onGoLibrary, chainRevision = 0 }) {
      const [mode, setMode] = useState('chains')
      return h('div', { className: 'litkb-graphPage' },
        h('div', { className: 'litkb-graphModes' },
          h('button', {
            type: 'button', className: 'litkb-searchMode' + (mode === 'chains' ? ' is-on' : ''),
            onClick: () => setMode('chains'),
          }, '证据链图'),
          h('button', {
            type: 'button', className: 'litkb-searchMode' + (mode === 'concept' ? ' is-on' : ''),
            onClick: () => setMode('concept'),
          }, '概念图谱')),
        mode === 'concept'
          ? h(ConceptGraphPanel, { papers, onOpenPaper, onOpenPdf })
          : h(ChainGraphView, { onOpenChain, onOpenPdf, onOpenPaper, onGoLibrary, chainRevision }))
    }

    function ConceptGraphPanel({ papers, onOpenPaper, onOpenPdf }) {
      const [graph, setGraph] = useState(null)
      const [job, setJob] = useState(null)
      const [llm, setLlm] = useState(null)
      const [concepts, setConcepts] = useState(null)
      const [loading, setLoading] = useState(true)
      const [starting, setStarting] = useState(false)
      const [err, setErr] = useState('')
      const [view, setView] = useState('graph')
      const [filters, setFilters] = useState({ topic: '', from: '', to: '', kinds: { method: true, dataset: true, metric: true }, q: '' })
      const [selected, setSelected] = useState(null)
      const [positions, setPositions] = useState(new Map())
      const [queueOpen, setQueueOpen] = useState(false)
      const [groups, setGroups] = useState(null)
      const [groupKey, setGroupKey] = useState('')
      const [groupLoading, setGroupLoading] = useState(false)
      const [themeMode, setThemeMode] = useState('dark')
      const [conceptTip, setConceptTip] = useState(null)
      const cyRef = useRef(null)
      const cyContainerRef = useRef(null)

      const load = useCallback(async () => {
        try {
          const data = await api('/api/litkb/graph')
          setGraph(data.graph || null)
          setJob(data.job || null)
          setLlm(data.llm || null)
          setConcepts(data.concepts || null)
          setErr('')
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => { load() }, [load])

      const running = Boolean(job && (job.status === 'queued' || job.status === 'running'))
      useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(load, 2000)
        return () => clearInterval(timer)
      }, [running, load])

      const loadCompare = useCallback(async () => {
        setGroupLoading(true)
        try {
          const data = await api('/api/litkb/compare')
          const next = data.groups || []
          setGroups(next)
          setGroupKey((current) => (next.some((g) => g.key === current) ? current : (next[0]?.key || '')))
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setGroupLoading(false)
        }
      }, [])

      useEffect(() => {
        if (view === 'compare') loadCompare()
      }, [view, loadCompare])

      const filtered = applyGraphFilters(graph, filters)
      const nodeKey = filtered.nodes.map((node) => node.id).join(',')
      const edgeKey = filtered.edges.map((edge) => edge.id).join(',')
      const conceptMode = themeMode === 'light' ? 'light' : 'dark'
      const conceptPalette = CONCEPT_PALETTES[conceptMode]
      const conceptElements = [
        ...filtered.nodes.map((node) => ({
          data: {
            id: node.id, type: node.type, kind: node.kind,
            label: conceptNodeLabel(node), name: node.name, title: node.title,
          },
        })),
        ...filtered.edges.map((edge) => ({
          data: {
            id: edge.id, source: edge.source, target: edge.target,
            kind: edge.type, label: GRAPH_EDGE_LABEL[edge.type] || edge.type,
          },
        })),
      ]

      useEffect(() => {
        const element = cyContainerRef.current
        if (!element) return undefined
        const update = () => setThemeMode(detectThemeMode(element))
        update()
        let observer = null
        if (typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(update)
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
          if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
        }
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
        if (media?.addEventListener) media.addEventListener('change', update)
        return () => {
          if (observer) observer.disconnect()
          if (media?.removeEventListener) media.removeEventListener('change', update)
        }
      }, [view, loading, nodeKey])

      useEffect(() => {
        const container = cyContainerRef.current
        if (view !== 'graph' || !container || !conceptElements.length) {
          if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
          return undefined
        }
        let alive = true
        let resizeObserver = null
        loadCytoscape().then((cytoscape) => {
          if (!alive || !cyContainerRef.current) return
          if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
          const known = readConceptPositions()
          const allPositioned = filtered.nodes.every((node) => known[node.id])
          const cy = cytoscape({
            container: cyContainerRef.current,
            elements: conceptElements,
            style: conceptGraphStyle(conceptMode),
            layout: { name: 'preset', positions: known, fit: false },
            minZoom: 0.15,
            maxZoom: 2.5,
            wheelSensitivity: 0.2,
            boxSelectionEnabled: false,
          })
          cyRef.current = cy
          if (!allPositioned) {
            cy.one('layoutstop', () => {
              try { cy.resize(); cy.fit(undefined, 60) } catch { /* ignore */ }
            })
            cy.layout({
              name: 'cose', animate: false, fit: true, padding: 50,
              nodeRepulsion: 24000, idealEdgeLength: 170, edgeElasticity: 120,
              gravity: 35, componentSpacing: 100, numIter: 900, randomize: true,
            }).run()
          } else {
            cy.fit(undefined, 50)
          }
          if (typeof ResizeObserver !== 'undefined' && cyContainerRef.current) {
            resizeObserver = new ResizeObserver(() => {
              if (!cyRef.current) return
              try { cyRef.current.resize() } catch { /* ignore */ }
            })
            resizeObserver.observe(cyContainerRef.current)
          }
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              if (!cyRef.current) return
              try { cy.resize(); cy.fit(undefined, 50) } catch { /* ignore */ }
            })
          }
          const persist = () => {
            const next = {}
            cy.nodes().forEach((node) => {
              const point = node.position()
              next[node.id()] = { x: Math.round(point.x), y: Math.round(point.y) }
            })
            saveConceptPositions(next)
          }
          cy.on('dragfree', 'node', persist)
          cy.on('tap', 'node', (event) => {
            cy.elements().unselect(); event.target.select()
            setSelected({ kind: 'node', id: event.target.id() })
            setConceptTip(null)
          })
          cy.on('tap', 'edge', (event) => {
            cy.elements().unselect(); event.target.select()
            setSelected({ kind: 'edge', id: event.target.id() })
            setConceptTip(null)
          })
          cy.on('tap', (event) => { if (event.target === cy) { cy.elements().unselect(); setSelected(null); setConceptTip(null) } })
          cy.on('mouseover', 'node', (event) => {
            const data = event.target.data()
            const rect = cyContainerRef.current?.getBoundingClientRect()
            if (!rect) return
            const source = event.originalEvent || {}
            setConceptTip({
              x: Math.min(Math.max(8, (source.clientX || 0) - rect.left + 14), Math.max(8, rect.width - 300)),
              y: Math.min(Math.max(8, (source.clientY || 0) - rect.top + 14), Math.max(8, rect.height - 220)),
              kind: data.type === 'paper' ? 'paper' : data.kind,
              text: String(data.title || data.name || data.label || '').slice(0, 220),
              meta: data.type === 'paper' ? '论文节点' : '概念节点',
            })
          })
          cy.on('mouseout', 'node', () => setConceptTip(null))
        }).catch((error) => {
          if (alive) setErr(String(error.message || '图引擎加载失败'))
        })
        return () => {
          alive = false
          if (resizeObserver) resizeObserver.disconnect()
          if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
        }
      }, [view, nodeKey, edgeKey])

      useEffect(() => {
        const cy = cyRef.current
        if (cy) cy.style(conceptGraphStyle(conceptMode))
      }, [themeMode])

      const fitConcept = () => {
        const cy = cyRef.current
        if (!cy) return
        try { cy.resize(); cy.fit(undefined, 60) } catch { /* ignore */ }
      }

      const relayoutConcept = () => {
        const cy = cyRef.current
        if (!cy) return
        try { window.localStorage?.removeItem('litkb.conceptPositions.v2') } catch { /* ignore */ }
        cy.one('layoutstop', () => { try { cy.fit(undefined, 60) } catch { /* ignore */ } })
        cy.layout({
          name: 'cose', animate: true, animationDuration: 350, fit: true, padding: 50,
          nodeRepulsion: 24000, idealEdgeLength: 170, edgeElasticity: 120,
          gravity: 35, componentSpacing: 100, numIter: 900, randomize: true,
        }).run()
      }

      const build = async (force) => {
        setStarting(true)
        setErr('')
        try {
          const data = await api('/api/litkb/graph/build', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ force: !!force }),
          })
          setJob(data.job || null)
          await load()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setStarting(false)
        }
      }

      const selectedNode = selected?.kind === 'node' ? filtered.nodes.find((node) => node.id === selected.id) : null
      const selectedEdge = selected?.kind === 'edge' ? filtered.edges.find((edge) => edge.id === selected.id) : null
      const relatedEdges = selectedNode
        ? filtered.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
        : []
      const pending = concepts?.pending || []
      const meta = graph?.meta || {}
      const topics = graph?.topics || []
      const modelReady = Boolean(llm && llm.available && llm.route)
      const currentGroup = (groups || []).find((group) => group.key === groupKey) || (groups || [])[0] || null

      const seg = (key, label) => h('button', {
        key, type: 'button', className: 'litkb-segBtn' + (view === key ? ' litkb-on' : ''),
        onClick: () => setView(key),
      }, label)

      const toolbar = h('div', { className: 'litkb-graphBar' },
        h('div', { className: 'litkb-seg' }, seg('graph', '图谱'), seg('compare', '可比组')),
        h('span', { className: 'litkb-muted' },
          `${meta.paperNodes || 0} 论文 · ${meta.conceptNodes || 0} 概念 · ${meta.edges || 0} 边 · 证据覆盖 ${Math.round((meta.evidenceCoverage || 0) * 100)}%`),
        h('span', { className: 'litkb-spacer' }),
        pending.length
          ? h('button', { type: 'button', className: 'litkb-btn litkb-btnGhost', onClick: () => setQueueOpen(true) },
              `待归一 ${pending.length}`)
          : null,
        h('button', { type: 'button', className: 'litkb-link', onClick: load }, '刷新'),
        h('button', { type: 'button', className: 'litkb-link', onClick: fitConcept }, '适应'),
        h('button', { type: 'button', className: 'litkb-link', onClick: relayoutConcept }, '重排'),
        h('button', {
          type: 'button', className: 'litkb-btn', disabled: starting || running || !modelReady,
          title: modelReady ? '' : '宿主未提供可用模型',
          onClick: () => build(false),
        }, running || starting ? '构建中…' : (meta.edges ? '增量构建' : '构建图谱')),
        meta.edges
          ? h('button', {
              type: 'button', className: 'litkb-btn litkb-btnGhost', disabled: starting || running || !modelReady,
              onClick: () => {
                if (typeof window.confirm === 'function'
                  && !window.confirm('强制重建会重新调用模型抽取所有有卡片的论文（会重新计费）。继续？')) return
                build(true)
              },
            }, '强制重建')
          : null,
        meta.edges
          ? h('a', { className: 'litkb-link', href: '/api/litkb/export?format=mermaid', download: 'litkb.mmd' }, 'Mermaid')
          : null,
        meta.edges
          ? h('a', { className: 'litkb-link', href: '/api/litkb/export?format=canvas', download: 'litkb.canvas' }, 'Canvas')
          : null)

      const filterBar = h('div', { className: 'litkb-graphFilters' },
        h('select', {
          className: 'litkb-input litkb-scope', value: filters.topic,
          onChange: (e) => setFilters({ ...filters, topic: e.target.value }),
        }, h('option', { value: '' }, '全部主题'), topics.map((topic) => h('option', { key: topic, value: topic }, topic))),
        h('input', {
          className: 'litkb-input litkb-year', type: 'number', placeholder: '起始年', value: filters.from,
          onChange: (e) => setFilters({ ...filters, from: e.target.value }),
        }),
        h('input', {
          className: 'litkb-input litkb-year', type: 'number', placeholder: '截止年', value: filters.to,
          onChange: (e) => setFilters({ ...filters, to: e.target.value }),
        }),
        h('div', { className: 'litkb-chips' },
          ['method', 'dataset', 'metric'].map((kind) => h('button', {
            key: kind, type: 'button',
            className: 'litkb-chip is-select' + (filters.kinds[kind] ? ' is-on' : ''),
            onClick: () => setFilters({ ...filters, kinds: { ...filters.kinds, [kind]: !filters.kinds[kind] } }),
          }, GRAPH_KIND_LABEL[kind]))),
        h('input', {
          className: 'litkb-input litkb-graphSearch', placeholder: '搜概念 / 论文…', value: filters.q,
          onChange: (e) => setFilters({ ...filters, q: e.target.value }),
        }),
        h('button', {
          type: 'button', className: 'litkb-link',
          onClick: () => setFilters({ topic: '', from: '', to: '', kinds: { method: true, dataset: true, metric: true }, q: '' }),
        }, '重置'))

      const detail = selectedNode
        ? h('div', { className: 'litkb-graphDetail' },
            h('div', { className: 'litkb-graphDetailHead' },
              h('span', { className: 'litkb-graphDot', style: { background: selectedNode.type === 'paper' ? '#4f8ef7' : GRAPH_KIND_COLOR[selectedNode.kind] } }),
              h('span', { className: 'litkb-blockTitle' }, selectedNode.name),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-link', onClick: () => setSelected(null) }, '收起')),
            h('div', { className: 'litkb-muted' },
              selectedNode.type === 'paper'
                ? `${selectedNode.year || '年份未知'} · ${selectedNode.paperType || ''} · ${selectedNode.cardStatus || '无卡片'}`
                : `${GRAPH_KIND_LABEL[selectedNode.kind] || selectedNode.kind} · 度数 ${selectedNode.degree || 0}`),
            selectedNode.type === 'paper'
              ? h('div', { className: 'litkb-inline' },
                  h('button', {
                    type: 'button', className: 'litkb-btn litkb-btnGhost',
                    onClick: () => onOpenPaper && onOpenPaper(selectedNode.id),
                  }, '打开卡片'))
              : (selectedNode.aliases?.length
                  ? h('div', { className: 'litkb-muted' }, '别名：' + selectedNode.aliases.join('、'))
                  : null),
            h('div', { className: 'litkb-graphRel' },
              h('div', { className: 'litkb-muted' }, `相连的边（${relatedEdges.length}）`),
              relatedEdges.slice(0, 12).map((edge) => h('button', {
                key: edge.id, type: 'button', className: 'litkb-graphRelRow',
                onClick: () => setSelected({ kind: 'edge', id: edge.id }),
              },
                h('span', { className: 'litkb-graphEdgeType', style: { color: graphEdgeColor(edge.type) } },
                  GRAPH_EDGE_LABEL[edge.type] || edge.type),
                h('span', { className: 'litkb-graphRelName' },
                  edge.source === selectedNode.id ? edge.targetName : edge.sourceName),
                h('span', { className: 'litkb-muted' }, `p.${edge.page}`)))))
        : null

      const edgeDetail = selectedEdge
        ? h('div', { className: 'litkb-graphDetail' },
            h('div', { className: 'litkb-graphDetailHead' },
              h('span', { className: 'litkb-graphDot', style: { background: graphEdgeColor(selectedEdge.type) } }),
              h('span', { className: 'litkb-blockTitle' }, GRAPH_EDGE_LABEL[selectedEdge.type] || selectedEdge.type),
              h('span', { className: 'litkb-spacer' }),
              h('button', { type: 'button', className: 'litkb-link', onClick: () => setSelected(null) }, '收起')),
            h('div', { className: 'litkb-graphEdgeLine' },
              h('span', {}, selectedEdge.sourceName),
              h('span', { className: 'litkb-graphArrow' }, '→'),
              h('span', {}, selectedEdge.targetName)),
            selectedEdge.type === 'reports'
              ? h('div', { className: 'litkb-muted' },
                  `${selectedEdge.metric} = ${selectedEdge.unit === '%' ? (selectedEdge.value * 100).toFixed(2) + '%' : selectedEdge.value}${selectedEdge.dataset ? ` · ${selectedEdge.dataset}` : ''}`)
              : null,
            h('div', { className: 'litkb-graphQuote' }, `“${selectedEdge.quote || '（无引文）'}”`),
            h('div', { className: 'litkb-quoteMeta' },
              h('button', {
                type: 'button', className: 'litkb-evPage',
                onClick: () => onOpenPdf && onOpenPdf(selectedEdge.paper, selectedEdge.page, selectedEdge.block),
              }, `p.${selectedEdge.page}`),
              h('span', { className: 'litkb-evId' }, selectedEdge.evidence),
              selectedEdge.block
                ? null
                : h('span', { className: 'litkb-evMissing', title: '这篇没有解析稿，或引文未能回贴到版面块；只能按页定位' }, '仅到页'),
              selectedEdge.block
                ? null
                : h('button', {
                    type: 'button', className: 'litkb-link',
                    onClick: () => onOpenPaper && onOpenPaper(selectedEdge.paper),
                  }, '去构建解析稿'),
              h('span', { className: 'litkb-muted' }, `置信度 ${selectedEdge.confidence ?? '—'}`),
              h('span', { className: 'litkb-spacer' }),
              h('button', {
                type: 'button', className: 'litkb-link',
                onClick: () => onOpenPaper && onOpenPaper(selectedEdge.paper),
              }, '打开论文')))
        : null

      const graphBody = loading && !graph
        ? h('div', { className: 'litkb-muted' }, '加载中…')
        : !meta.edges && !running
          ? h('div', { className: 'litkb-graphEmpty' },
              h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '◎'),
              h('div', { className: 'litkb-emptyTitle' }, '还没有图谱'),
              h('p', { className: 'litkb-emptyText' },
                '图谱从七段卡与证据里抽取方法 / 数据集 / 指标和四类边；每条边都能回到原文。没有卡片的论文会跳过。'),
              h('button', {
                type: 'button', className: 'litkb-btn', disabled: starting || !modelReady,
                onClick: () => build((meta.analyses || 0) > 0),
              }, starting ? '提交中…' : ((meta.analyses || 0) > 0 ? '重新抽取' : '构建图谱')),
              !modelReady ? h('div', { className: 'litkb-muted' }, '宿主没有可用模型，暂时不能构建') : null)
          : h('div', { className: 'litkb-graphMain' },
              h('div', { className: 'litkb-graphCanvasWrap is-' + conceptMode },
                h('div', {
                  ref: cyContainerRef, className: 'litkb-graphCanvas',
                  role: 'img', 'aria-label': '概念图谱',
                }),
                conceptTip
                  ? h('div', { className: 'litkb-kbTip', style: { left: conceptTip.x + 'px', top: conceptTip.y + 'px' } },
                      h('div', { className: 'litkb-kbTipKind is-' + conceptTip.kind }, conceptTip.kind === 'paper' ? '论文' : ({ method: '方法', dataset: '数据集', metric: '指标' }[conceptTip.kind] || '概念')),
                      h('div', { className: 'litkb-kbTipText' }, conceptTip.text),
                      h('div', { className: 'litkb-kbTipMeta' }, conceptTip.meta))
                  : null,
                h('div', { className: 'litkb-graphLegend' },
                  h('span', { className: 'litkb-graphLegendItem' },
                    h('span', { className: 'litkb-graphLegendDot', style: { background: conceptPalette.paperBg, borderColor: conceptPalette.paperBorder } }), '论文'),
                  h('span', { className: 'litkb-graphLegendItem' },
                    h('span', { className: 'litkb-graphLegendDot', style: { background: conceptPalette.methodBg, borderColor: conceptPalette.methodBorder } }), '方法'),
                  h('span', { className: 'litkb-graphLegendItem' },
                    h('span', { className: 'litkb-graphLegendDot', style: { background: conceptPalette.datasetBg, borderColor: conceptPalette.datasetBorder } }), '数据集'),
                  h('span', { className: 'litkb-graphLegendItem' },
                    h('span', { className: 'litkb-graphLegendDot', style: { background: conceptPalette.metricBg, borderColor: conceptPalette.metricBorder } }), '指标'),
                  h('span', { className: 'litkb-graphLegendSep' }),
                  ['uses', 'improves_on', 'evaluates_on', 'reports'].map((type) => h('span', { key: type, className: 'litkb-graphLegendItem' },
                    h('span', {
                      className: 'litkb-graphLegendLine',
                      style: { background: conceptPalette[{ uses: 'uses', improves_on: 'improves', evaluates_on: 'evaluates', reports: 'reports' }[type]] },
                    }),
                    GRAPH_EDGE_LABEL[type]))),
                running
                  ? h('div', { className: 'litkb-progress litkb-graphProgress' },
                      h('span', { className: 'litkb-pulse', 'aria-hidden': 'true' }),
                      `${job.step || '抽取中'} ${job.total ? `${job.done}/${job.total}` : ''}`)
                  : null),
              detail || edgeDetail || h('div', { className: 'litkb-graphHint' },
                h('div', { className: 'litkb-muted' }, '点节点看邻居，点边看原文引文。'),
                h('div', { className: 'litkb-muted' }, `当前显示 ${filtered.nodes.length} 节点 / ${filtered.edges.length} 边`),
                selected ? h('button', { type: 'button', className: 'litkb-link', onClick: () => setSelected(null) }, '清除选择') : null))

      const compareBody = groupLoading
        ? h('div', { className: 'litkb-muted' }, '加载中…')
        : !(groups || []).length
          ? h('div', { className: 'litkb-graphEmpty' },
              h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, '▤'),
              h('div', { className: 'litkb-emptyTitle' }, '还没有可比组'),
              h('p', { className: 'litkb-emptyText' }, '可比组来自 reports 边：同数据集 + 同指标才会进同一组。先构建图谱。'))
          : h('div', { className: 'litkb-compare' },
              h('div', { className: 'litkb-comparePick' },
                (groups || []).map((group) => h('button', {
                  key: group.key, type: 'button',
                  className: 'litkb-chip is-select' + (currentGroup?.key === group.key ? ' is-on' : ''),
                  onClick: () => setGroupKey(group.key),
                }, `${group.dataset} · ${group.metric}（${group.rows.length}）`))),
              currentGroup
                ? h('div', { className: 'litkb-compareTable' },
                    h('div', { className: 'litkb-compareRow is-head' },
                      h('span', {}, '论文'),
                      h('span', {}, '数值'),
                      h('span', {}, '年份'),
                      h('span', {}, '证据')),
                    currentGroup.rows.map((row) => h('div', { key: row.paper, className: 'litkb-compareRow' },
                      h('span', { className: 'litkb-compareTitle', title: row.title }, row.title),
                      h('span', { className: 'litkb-compareValue' },
                        row.unit === '%' ? (row.value * 100).toFixed(2) + '%' : row.value),
                      h('span', { className: 'litkb-muted' }, row.year || '—'),
                      h('button', {
                        type: 'button', className: 'litkb-evPage',
                        onClick: () => onOpenPdf && onOpenPdf(row.paper, row.page, null),
                      }, `p.${row.page}`))))
                : null)

      return h('div', { className: 'litkb-graph' },
        toolbar,
        err ? h('div', { className: 'litkb-error' }, err) : null,
        job && job.status === 'failed' && job.error
          ? h('div', { className: 'litkb-error' }, `构图失败：${job.error.message}`)
          : null,
        job && job.status === 'done' && job.summary
          ? h('div', { className: 'litkb-muted litkb-graphSummary' },
              `本轮：抽取 ${job.summary.analyzed} 篇 · 跳过 ${job.summary.skipped} 篇${job.summary.withoutCard ? ` · 无卡 ${job.summary.withoutCard} 篇` : ''} · 失败 ${job.summary.failed} 篇 · 边 ${job.summary.edges} 条 · 丢弃 ${job.summary.dropped} 条${job.summary.pending ? ` · 待归一 ${job.summary.pending}` : ''}`)
          : null,
        view === 'graph' ? filterBar : null,
        view === 'graph' ? graphBody : compareBody,
        queueOpen
          ? h(ConceptQueue, {
              data: concepts,
              onClose: () => setQueueOpen(false),
              onChanged: async () => { setQueueOpen(false); await load() },
            })
          : null)
    }


    /* ---------------- 个人工作台（v0.2.5：总览 + 三视图） ---------------- */
    function spacer() { return h('span', { className: 'litkb-spacer' }) }
    const MATCH_DEFAULTS = {
      minScore: 1.5, relative: 0.4, perPaper: 2, maxHits: 8, maxPapers: 6,
      keywordMode: 'require', tagMode: 'boost', yearFrom: 0, yearTo: 0, expand: true,
    }

    function ThemePage({ papers = [], tags = [], paperActions = {}, paperCount = 0, onOpenPaper, onOpenChain, onOpenDraft, onOpenLibrary, onOpenWriting }) {
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
            h('button', { type: 'button', className: 'litkb-btn', onClick: startNew }, '＋ 新建研究')),
          err ? h('div', { className: 'litkb-error' }, err) : null,
          notice ? h('div', { className: 'litkb-themeNotice' }, notice) : null,
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

      const views = h('div', { className: 'litkb-viewCards' },
        [
          ['papers', '▤', '参考论文', papersInTheme.length, '匹配论文'],
          ['chains', '☷', '证据链', chains.length, `${stats.confirmed || 0} 条已确认`],
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
            h('button', { type: 'button', className: 'litkb-miniBtn', onClick: generateSummary }, '生成'),
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

    function ConceptQueue({ data, onClose, onChanged }) {
      const [targets, setTargets] = useState({})
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const concepts = data?.concepts || []
      const pending = concepts.filter((concept) => concept.status === 'pending')
      const activeFor = (kind) => concepts.filter((concept) => concept.status === 'active' && concept.kind === kind)

      const merge = async (from) => {
        const into = targets[from]
        if (!into || busy) return
        setBusy(from)
        setErr('')
        try {
          await api('/api/litkb/concepts/merge', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from, into }),
          })
          await onChanged()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const approve = async (id) => {
        if (busy) return
        setBusy(id)
        setErr('')
        try {
          await api('/api/litkb/concepts/update', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, status: 'active' }),
          })
          await onChanged()
        } catch (e) {
          setErr(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      return h('div', { className: 'litkb-queueWrap', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'litkb-queueCard' },
          h('div', { className: 'litkb-drawerHead' },
            h('span', { className: 'litkb-blockTitle' }, `待归一概念（${pending.length}）`),
            h('span', { className: 'litkb-spacer' }),
            h('button', { type: 'button', className: 'litkb-close', onClick: onClose }, '×')),
          h('div', { className: 'litkb-queueBody' },
            h('div', { className: 'litkb-muted' },
              '这些概念和词表里的已有概念相似但没把握，所以先不进图。合并到已有概念，或批准为新概念。'),
            err ? h('div', { className: 'litkb-error' }, err) : null,
            pending.length
              ? pending.map((concept) => h('div', { key: concept.id, className: 'litkb-queueRow' },
                  h('div', { className: 'litkb-queueName' },
                    h('span', { className: 'litkb-chip is-type' }, GRAPH_KIND_LABEL[concept.kind] || concept.kind),
                    h('span', {}, concept.name),
                    concept.aliases?.length ? h('span', { className: 'litkb-muted' }, concept.aliases.join(' / ')) : null),
                  h('div', { className: 'litkb-queueActions' },
                    h('select', {
                      className: 'litkb-input litkb-queueSelect',
                      value: targets[concept.id] || '',
                      onChange: (e) => setTargets({ ...targets, [concept.id]: e.target.value }),
                    },
                    h('option', { value: '' }, '合并到…'),
                    activeFor(concept.kind).map((target) => h('option', { key: target.id, value: target.id }, target.name))),
                    h('button', {
                      type: 'button', className: 'litkb-btn litkb-btnGhost',
                      disabled: !targets[concept.id] || busy === concept.id,
                      onClick: () => merge(concept.id),
                    }, busy === concept.id ? '处理中…' : '合并'),
                    h('button', {
                      type: 'button', className: 'litkb-btn litkb-btnGhost',
                      disabled: busy === concept.id,
                      onClick: () => approve(concept.id),
                    }, '批准为新概念'))))
              : h('div', { className: 'litkb-muted' }, '没有待归一概念。'))))
    }

    function Empty({ icon, title, desc }) {
      return h('div', { className: 'litkb-empty' },
        h('div', { className: 'litkb-emptyIcon', 'aria-hidden': 'true' }, icon),
        h('div', { className: 'litkb-emptyTitle' }, title),
        h('p', { className: 'litkb-emptyText' }, desc))
    }


    const CSS = [
      ':root,.litkb-window,.litkb-overlay,.litkb-entry{--litkb-bg:var(--dsw-alias-bg-base,#0b0e14);--litkb-surface:var(--dsw-alias-bg-layer-1,#141922);--litkb-surface-2:var(--dsw-alias-bg-layer-2,#1b2230);--litkb-overlay:var(--dsw-alias-bg-overlay,#161b22);--litkb-border:var(--dsw-alias-border-l1,#262b36);--litkb-border-strong:var(--dsw-alias-border-l2,#3a4150);--litkb-text:var(--dsw-alias-label-primary,#e6e8eb);--litkb-text-2:color-mix(in srgb,var(--litkb-text) 72%,transparent);--litkb-text-3:color-mix(in srgb,var(--litkb-text) 60%,transparent);--litkb-accent:var(--dsw-alias-brand-primary,#4f8ef7);--litkb-accent-text:color-mix(in srgb,var(--litkb-accent) 72%,var(--litkb-text));--litkb-violet:var(--dsw-alias-state-accent-primary,#a371f7);--litkb-violet-text:color-mix(in srgb,var(--litkb-violet) 72%,var(--litkb-text));--litkb-success:var(--dsw-alias-state-success-primary,#3fb950);--litkb-warn:var(--dsw-alias-state-warn-primary,#d29922);--litkb-danger:var(--dsw-alias-state-error-primary,#f85149);--litkb-fill-1:color-mix(in srgb,var(--litkb-text) 6%,transparent);--litkb-fill-2:color-mix(in srgb,var(--litkb-text) 10%,transparent);--litkb-radius-sm:6px;--litkb-radius:10px;--litkb-radius-lg:14px;--litkb-shadow-1:0 1px 2px rgba(0,0,0,.06);--litkb-shadow-2:0 12px 32px rgba(0,0,0,.18)}',
      '.litkb-theme-light{--litkb-bg:#ffffff;--litkb-surface:#f6f7f9;--litkb-surface-2:#eceff3;--litkb-overlay:#ffffff;--litkb-border:#e3e6ea;--litkb-border-strong:#cfd4db;--litkb-text:#111827;--litkb-accent:#2563eb;--litkb-violet:#7c3aed;--litkb-success:#15803d;--litkb-warn:#b45309;--litkb-danger:#dc2626}',
      '.litkb-theme-dark{--litkb-bg:#0b0e14;--litkb-surface:#141922;--litkb-surface-2:#1b2230;--litkb-overlay:#161b22;--litkb-border:#262b36;--litkb-border-strong:#3a4150;--litkb-text:#e6e8eb;--litkb-accent:#4f8ef7;--litkb-violet:#a371f7;--litkb-success:#3fb950;--litkb-warn:#d29922;--litkb-danger:#f85149}',
      '.litkb-window :is(button,a,input,select,textarea,[role="button"]):focus-visible,.litkb-overlay :is(button,a,input,select,textarea,[role="button"]):focus-visible,.litkb-entry:focus-visible{outline:2px solid var(--litkb-accent);outline-offset:2px;border-radius:4px}',
      '.litkb-window button,.litkb-window a,.litkb-window input,.litkb-window select,.litkb-window textarea,.litkb-overlay button,.litkb-overlay a,.litkb-overlay input,.litkb-overlay select,.litkb-overlay textarea{transition:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease}',
      '.litkb-entry{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--litkb-text-2);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}',
      '.litkb-entry:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-entry.is-on{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-entryIcon{font-size:13px;opacity:.9}',
      '.litkb-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45)}',
      '.litkb-panel{position:relative;display:flex;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--litkb-bg);color:var(--litkb-text)}',
      '.litkb-panel,.litkb-panel *{box-sizing:border-box}',
      '.litkb-window.is-embedded{width:100%;height:100%;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none;background:transparent}',
      '.litkb-window{display:flex;flex-direction:column;position:relative;width:min(1120px,96vw);height:min(760px,90vh);overflow:hidden;border-radius:14px;border:1px solid var(--litkb-border);background:var(--litkb-bg);color:var(--litkb-text);box-shadow:0 24px 80px rgba(0,0,0,.5)}',
      '.litkb-window.is-drag{outline:2px dashed var(--litkb-accent);outline-offset:-6px}',
      '.litkb-head{display:flex;flex-direction:column;gap:0;padding:0;border-bottom:1px solid var(--litkb-border);background:linear-gradient(90deg,rgba(79,142,247,.05),transparent 60%)}',
      '.litkb-headTop{display:flex;align-items:center;gap:12px;padding:12px 22px 8px;flex-wrap:wrap;row-gap:8px}',
      '.litkb-headBottom{display:flex;align-items:center;gap:10px;padding:0 22px 10px;flex-wrap:wrap;row-gap:6px}',
      '.litkb-headSearch{flex:1;min-width:180px;max-width:440px}',
      '.litkb-headSearch .litkb-input{height:32px;background:var(--litkb-fill-1)}',
      '.litkb-headKpis{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-headHint{font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-brand{display:flex;align-items:center;gap:8px;flex:none}',
      '.litkb-logo{font-size:15px;color:var(--litkb-accent)}',
      '.litkb-title{font-size:14px;font-weight:600}',
      '.litkb-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid rgba(79,142,247,.35);color:var(--litkb-accent-text);background:rgba(79,142,247,.08)}',
      '.litkb-tabs{display:flex;gap:2px;flex:none;flex-wrap:wrap}',
      '.litkb-tab{display:flex;align-items:center;gap:6px;padding:6px 12px;border:0;border-bottom:2px solid transparent;background:none;color:var(--litkb-text-2);font:inherit;font-size:12.5px;cursor:pointer}',
      '.litkb-tab:hover{color:var(--litkb-text)}',
      '.litkb-tab.is-on{color:var(--litkb-text);border-bottom-color:var(--litkb-accent)}',
      '.litkb-count{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--litkb-danger);color:#fff;font-size:11px;line-height:16px;text-align:center}',
      '.litkb-close{flex:none;width:28px;height:28px;border:0;border-radius:8px;background:none;color:var(--litkb-text-2);font-size:18px;line-height:1;cursor:pointer}',
      '.litkb-close:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-body.is-writing{padding:0;overflow:hidden;display:flex}',
      '.litkb-searchPage{flex:1;min-height:0;width:100%;max-width:1020px;margin:0 auto;padding:24px 28px;overflow:auto;display:flex;flex-direction:column;gap:14px}',
      '.litkb-searchHero{display:flex;flex-direction:column;gap:8px}',
      '.litkb-searchTitle{font-size:20px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-searchSub{font-size:12px;color:var(--litkb-text-3)}',
      '.litkb-searchBar{display:flex;align-items:center;gap:8px}',
      '.litkb-searchInput{flex:1;height:38px;font-size:13px}',
      '.litkb-searchModes{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-searchFilters{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-searchFilter.litkb-input{width:auto;min-width:120px;height:30px;padding:0 8px;font-size:11px}',
      '.litkb-searchMode{padding:5px 10px;border:1px solid var(--litkb-border);border-radius:999px;background:var(--litkb-bg);color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-searchMode.is-on{border-color:var(--litkb-accent);background:var(--litkb-fill-1);color:var(--litkb-accent-text)}',
      '.litkb-searchHint{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-searchHistory{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px}',
      '.litkb-searchHistoryLabel{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-searchHistoryItem{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 9px;border:1px solid var(--litkb-border);border-radius:999px;background:var(--litkb-fill-1);color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-searchHistoryItem:hover{border-color:var(--litkb-border-strong);color:var(--litkb-text)}',
      '.litkb-searchEmpty{padding:34px 0;display:flex;flex-direction:column;gap:8px;align-items:flex-start}',
      '.litkb-searchResult{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-searchResultHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-searchResultTitle{font-size:14px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-searchWarn{padding:7px 9px;border:1px solid color-mix(in srgb,var(--litkb-warn) 32%,transparent);border-radius:8px;background:color-mix(in srgb,var(--litkb-warn) 8%,transparent);font-size:11px;line-height:1.65;color:var(--litkb-warn)}',
      '.litkb-searchAnswer{font-size:13px;line-height:1.85;color:var(--litkb-text)}',
      '.litkb-searchAnswer .litkb-mdP{margin:0 0 9px}',
      '.litkb-searchBlock{display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid var(--litkb-border)}',
      '.litkb-searchBlockTitle{font-size:12px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-searchCites{display:flex;flex-direction:column;gap:6px}',
      '.litkb-searchCite{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 9px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-searchCite:hover{border-color:var(--litkb-border-strong)}',
      '.litkb-searchCiteTitle{flex:none;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-searchCiteQuote{flex:1;min-width:0;font-size:11px;line-height:1.6;color:var(--litkb-text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-searchChain{display:flex;flex-direction:column;gap:3px;width:100%;padding:9px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-searchChain:hover{border-color:var(--litkb-accent)}',
      '.litkb-searchChainTitle{font-size:12px;line-height:1.6;color:var(--litkb-text)}',
      '.litkb-searchTrace{border-top:1px solid var(--litkb-border);padding-top:8px;font-size:11px;line-height:1.65}',
      '.litkb-searchTrace summary{cursor:pointer;color:var(--litkb-text-3)}',
      '.litkb-writing{display:grid;grid-template-columns:var(--litkb-write-draft,250px) 6px minmax(0,1fr) 6px var(--litkb-write-rail,330px);width:100%;height:100%;min-height:0;overflow:hidden}',
      '.litkb-writing.is-focus{grid-template-columns:minmax(0,1fr)}',
      '.litkb-writing.is-focus .litkb-draftList,.litkb-writing.is-focus .litkb-writeRail,.litkb-writing.is-focus .litkb-writeResizer{display:none}',
      '.litkb-draftList{display:flex;flex-direction:column;gap:4px;min-width:0;overflow:auto;padding:12px;border-right:1px solid var(--litkb-border)}',
      '.litkb-draftHead{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:8px}',
      '.litkb-draftRow{display:flex;align-items:center;gap:6px;padding:8px 9px;border:1px solid transparent;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-draftRowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.litkb-draftDel{flex:none;width:22px;height:22px;border:1px solid transparent;border-radius:6px;background:none;color:var(--litkb-text-3);font-size:14px;line-height:1;cursor:pointer}',
      '.litkb-draftDel:hover{color:var(--litkb-danger);border-color:rgba(248,81,73,.35);background:rgba(248,81,73,.08)}',
      '.litkb-draftRow:hover{background:var(--litkb-fill-1)}',
      '.litkb-draftRow.is-active{border-color:rgba(79,142,247,.5);background:rgba(79,142,247,.08);box-shadow:inset 3px 0 0 var(--litkb-accent)}',
      '.litkb-draftTitle{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-draftMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-writeMain{min-width:0;min-height:0;display:flex;flex-direction:column;padding:14px;gap:8px;overflow:hidden}',
      '.litkb-writeShell{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0}',
      '.litkb-writeModes{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--litkb-border);border-radius:7px}',
      '.litkb-writeModes .litkb-miniBtn{border:0;background:none}',
      '.litkb-miniBtn.is-on{color:var(--litkb-accent-text);background:rgba(79,142,247,.12)}',
      '.litkb-writeTools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px}',
      '.litkb-toolGroup{display:flex;align-items:center;gap:4px}',
      '.litkb-toolSep{width:1px;height:16px;background:var(--litkb-border);margin:0 4px;display:inline-block}',
      '.litkb-writePanes{flex:1;min-height:0;display:grid;gap:10px;overflow:hidden}',
      '.litkb-writePanes.is-split{gap:0}',
      '.litkb-writePanes>*{min-width:0}',
      '.litkb-writeSplitter{height:100%;background:var(--litkb-border)}',
      '.litkb-writePanes.is-split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}',
      '.litkb-writePanes.is-edit,.litkb-writePanes.is-preview{grid-template-columns:minmax(0,1fr)}',
      '.litkb-writePanes .litkb-writeArea{height:100%;width:100%}',
      '.litkb-mdPreview{min-width:0;min-height:0;height:100%;width:100%;max-width:860px;margin:0 auto;overflow:auto;overflow-wrap:anywhere;padding:16px 18px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);font-size:13px;line-height:1.9;color:var(--litkb-text)}',
      '.litkb-mdH{margin:10px 0 6px;color:var(--litkb-text);line-height:1.45}',
      '.litkb-mdH:first-child{margin-top:0}',
      '.litkb-mdP{margin:0 0 9px}',
      '.litkb-mdList{margin:0 0 9px;padding-left:22px}',
      '.litkb-mdList li{margin:2px 0}',
      '.litkb-mdQuote{margin:0 0 9px;padding:6px 10px;border-left:3px solid var(--litkb-border-strong);color:var(--litkb-text-3)}',
      '.litkb-mdCode{margin:0 0 9px;padding:10px 12px;border-radius:7px;background:var(--litkb-bg);overflow:auto;font-size:11.5px}',
      '.litkb-mdTable{border-collapse:collapse;width:100%;margin:0 0 9px;font-size:11.5px}',
      '.litkb-mdTable th,.litkb-mdTable td{border:1px solid var(--litkb-border);padding:5px 7px;text-align:left}',
      '.litkb-mdTable th{background:var(--litkb-fill-1)}',
      '.litkb-citeChip{display:inline-flex;align-items:center;padding:0 5px;margin:0 2px;border:1px solid rgba(79,142,247,.4);border-radius:5px;background:rgba(79,142,247,.1);color:var(--litkb-accent-text);font:inherit;font-size:11.5px;line-height:1.7;cursor:pointer;vertical-align:baseline}',
      '.litkb-citeChip:hover{border-color:var(--litkb-accent);background:rgba(79,142,247,.18)}',
      '.litkb-writeBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-writeTitle{flex:1;min-width:120px;font-size:14px;font-weight:600;height:34px}',
      '.litkb-writeBar .litkb-miniBtn{padding-left:6px;padding-right:6px}',
      '.litkb-writeArea{flex:1;min-height:0;resize:none;font-size:13px;line-height:1.9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--litkb-bg)}',
      '.litkb-writePreview{flex:1;min-height:0;overflow:auto;margin:0;padding:14px 16px;border:1px solid var(--litkb-border);border-radius:8px;white-space:pre-wrap;font-size:13px;line-height:1.9;color:var(--litkb-text-2);background:var(--litkb-fill-1)}',
      '.litkb-writeFoot{display:flex;align-items:center;gap:8px;font-size:11px}',
      '.litkb-writeEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--litkb-text-2)}',
      '.litkb-writeRail{display:flex;flex-direction:column;min-width:0;min-height:0;border-left:1px solid var(--litkb-border)}',
      '.litkb-writeTabs{display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-writeTab{min-height:32px;padding:5px 9px;border:0;border-bottom:2px solid transparent;background:none;color:var(--litkb-text-2);font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-writeTab.is-on{color:var(--litkb-text);border-bottom-color:var(--litkb-accent)}',
      '.litkb-writeRailBody{flex:1;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}',
      '.litkb-writeEv{display:flex;flex-direction:column;gap:5px;padding:9px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-fill-1)}',
      '.litkb-writeEvTop{display:flex;align-items:center;gap:8px;min-width:0}',
      '.litkb-writeEvTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--litkb-text-2)}',
      '.litkb-writeEvQuote{font-size:11px;line-height:1.7;color:var(--litkb-text-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-writeEvActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-refRow{display:flex;gap:6px;font-size:11px;line-height:1.7;color:var(--litkb-text-2)}',
      '.litkb-chainClaims{margin-top:14px}',
      '.litkb-claimRow{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-claimMain{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}',
      '.litkb-claimTag{font-size:11px;color:var(--litkb-accent-text)}',
      '.litkb-claimText{font-size:12px;line-height:1.75;color:var(--litkb-text-2)}',
      '.litkb-claimCustom{margin-top:10px}',
      '.litkb-autoDialog{width:min(820px,96vw)}',
      '.litkb-linkDialog{width:min(620px,96vw)}',
      '.litkb-linkBody{display:flex;flex-direction:column;gap:10px;padding:4px 2px 8px}',
      '.litkb-linkKinds{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.litkb-autoBody{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:2px}',
      '.litkb-autoModes{display:inline-flex;align-self:flex-start;gap:3px;padding:3px;border:1px solid var(--litkb-border);border-radius:9px;background:var(--litkb-bg)}',
      '.litkb-autoMode{padding:5px 9px;border:0;border-radius:6px;background:none;color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-autoMode.is-on{background:var(--litkb-fill-1);color:var(--litkb-text);box-shadow:inset 0 0 0 1px var(--litkb-border)}',
      '.litkb-autoRun{padding:12px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);display:flex;flex-direction:column;gap:8px}',
      '.litkb-autoRunTitle{font-size:12px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-autoChecks{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.litkb-autoCheck{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--litkb-text-2);cursor:pointer}',
      '.litkb-autoJob{display:flex;flex-direction:column;gap:5px;padding:9px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg)}',
      '.litkb-autoJobState{font-size:11px;font-weight:600;color:var(--litkb-accent-text)}',
      '.litkb-autoBar{height:4px;border-radius:99px;background:var(--litkb-fill-2);overflow:hidden}',
      '.litkb-autoBar span{display:block;height:100%;background:var(--litkb-accent);transition:width .2s}',
      '.litkb-autoReviewHead{display:flex;align-items:center;gap:8px}',
      '.litkb-autoList{display:flex;flex-direction:column;gap:8px}',
      '.litkb-autoRow{padding:10px 11px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);display:flex;flex-direction:column;gap:6px}',
      '.litkb-autoRowTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-autoConfidence{font-size:11px;color:var(--litkb-accent-text)}',
      '.litkb-autoClaim{font-size:12px;line-height:1.65;color:var(--litkb-text)}',
      '.litkb-autoWarn{font-size:11px;line-height:1.6;color:var(--litkb-warn)}',
      '.litkb-autoActions{display:flex;align-items:center;justify-content:flex-end;gap:6px}',
      '.litkb-chainModal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.52)}',
      '.litkb-chainDialog{display:flex;flex-direction:column;gap:10px;width:min(1080px,96vw);max-height:90vh;padding:18px;border:1px solid var(--litkb-border);border-radius:14px;background:var(--litkb-bg);box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden}',
      '.litkb-chainDraftPick{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.litkb-chainDraft{width:150px;height:28px;padding:0 6px;font-size:11px}',
      '.litkb-chainHead{display:flex;align-items:center;gap:10px;flex:none;padding-bottom:8px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-chainTitle{font-size:15px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-chainBody{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:minmax(0,1fr);gap:16px;overflow:hidden}',
      '.litkb-chainLeft{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;padding-right:4px}',
      '.litkb-chainPick{display:flex;flex-direction:column;gap:8px;min-height:0;padding-left:16px;border-left:1px solid var(--litkb-border)}',
      '.litkb-chainPickHead{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.litkb-chainPickTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-chainPickHint{font-size:11px;line-height:1.6;color:var(--litkb-text);opacity:.65}',
      '.litkb-chainPickList{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}',
      '.litkb-chainPickRow{padding:8px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-surface)}',
      '.litkb-chainPickTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.litkb-chainPickPaper{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--litkb-text);opacity:.68}',
      '.litkb-chainPickQuote{font-size:11.5px;line-height:1.7;color:var(--litkb-text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-chainPickMeta{font-size:11px;color:var(--litkb-text);opacity:.6;margin-top:2px}',
      '.litkb-chainField{display:flex;flex-direction:column;gap:4px}',
      '.litkb-chainLabel{font-size:11px;color:var(--litkb-text);opacity:.72}',
      '.litkb-chainClaim{min-height:96px;resize:vertical;font-size:13.5px;line-height:1.8;color:var(--litkb-text)}',
      '.litkb-chainActions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-chainWarn{padding:7px 9px;border:1px solid rgba(210,153,34,.4);border-radius:7px;background:rgba(210,153,34,.08);color:var(--litkb-warn);font-size:11px;line-height:1.7}',
      '.litkb-chainNodes{display:flex;flex-direction:column;gap:7px}',
      '.litkb-chainNode{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--litkb-border);border-radius:9px;background:var(--litkb-surface)}',
      '.litkb-chainNode.is-stale{border-color:rgba(210,153,34,.5);opacity:.85}',
      '.litkb-chainNodeTop{display:flex;align-items:center;gap:7px;min-width:0}',
      '.litkb-chainRel.litkb-input{width:88px;min-width:88px;height:28px;padding:0 24px 0 8px;font-size:11px;flex:none}',
      '.litkb-chainRel[data-relation="supports"]{color:var(--litkb-success);border-color:color-mix(in srgb,var(--litkb-success) 40%,var(--litkb-border))}',
      '.litkb-chainRel[data-relation="contradicts"]{color:var(--litkb-danger);border-color:color-mix(in srgb,var(--litkb-danger) 40%,var(--litkb-border))}',
      '.litkb-chainRel[data-relation="qualifies"]{color:var(--litkb-warn);border-color:color-mix(in srgb,var(--litkb-warn) 40%,var(--litkb-border))}',
      '.litkb-chainRel[data-relation="derives"]{color:var(--litkb-accent-text);border-color:color-mix(in srgb,var(--litkb-accent) 40%,var(--litkb-border))}',
      '.litkb-chainRel[data-relation="compares"]{color:var(--litkb-violet-text);border-color:color-mix(in srgb,var(--litkb-violet) 40%,var(--litkb-border))}',
      '.litkb-chainNodeTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--litkb-text);opacity:.68}',
      '.litkb-chainNodeQuote{font-size:12px;line-height:1.75;color:var(--litkb-text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-chainNodeQuote.is-open{display:block;overflow:visible}',
      '.litkb-chainQuoteToggle{align-self:flex-start;padding:0;border:0;background:none;color:var(--litkb-accent-text);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-chainNote{height:30px;font-size:11px}',
      '.litkb-chainSearch{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto}',
      '.litkb-chainSearchRow{display:flex;gap:8px;align-items:flex-start;padding:7px;border:1px solid var(--litkb-border);border-radius:7px}',
      '.litkb-chainSearchMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.litkb-chainSearchTitle{font-size:11px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-chainSearchQuote{font-size:11px;line-height:1.65;color:var(--litkb-text-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-chainFoot{display:flex;align-items:center;gap:8px;flex:none;padding-top:6px;border-top:1px solid var(--litkb-border)}',
      '.litkb-chainDel{color:var(--litkb-warn)}',
      '@media (max-width:900px){.litkb-chainBody{grid-template-columns:minmax(0,1fr);overflow:auto}.litkb-chainLeft{overflow:visible;padding-right:0}.litkb-chainPick{border-left:0;border-top:1px solid var(--litkb-border);padding-left:0;padding-top:12px;max-height:42vh}}',
      '.litkb-chainRailHead{display:flex;align-items:center;gap:6px}',
      '.litkb-chainRow{display:flex;flex-direction:column;gap:3px;padding:8px;border:1px solid var(--litkb-border);border-radius:8px;cursor:pointer;background:var(--litkb-fill-1)}',
      '.litkb-chainRow:hover{border-color:rgba(79,142,247,.45)}',
      '.litkb-chainRowTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.litkb-chainRowTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-chainRowClaim{font-size:11px;line-height:1.6;color:var(--litkb-text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-chainRowMeta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-refNo{flex:none;color:var(--litkb-accent-text)}',
      '.litkb-refText{min-width:0}',
      '@media (max-width:1100px){.litkb-writing{grid-template-columns:min(var(--litkb-write-draft,250px),220px) 6px minmax(0,1fr) 6px min(var(--litkb-write-rail,330px),300px)}}',
      '@media (max-width:1100px){.litkb-headKpis{display:none}.litkb-headSearch{max-width:300px}}',
      '@media (max-width:900px){.litkb-headTop{gap:8px}.litkb-headSearch{order:3;flex-basis:100%;max-width:none}.litkb-headKpis{display:none}.litkb-detailHead .litkb-detailTitle{font-size:13px}}',
      '@media (max-width:900px){.litkb-writing{grid-template-columns:minmax(0,1fr)}.litkb-draftList,.litkb-writeRail,.litkb-writeResizer{display:none}}',
      '.litkb-kpis{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none;padding:10px 16px;border-bottom:1px solid var(--litkb-border);background:var(--litkb-fill-1)}',
      '.litkb-kpi{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font:inherit;font-size:11px;color:var(--litkb-text-2);border:1px solid var(--litkb-border);background:var(--litkb-bg)}',
      '.litkb-kpi b{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-kpi.is-blue{border-color:rgba(79,142,247,.35);background:rgba(79,142,247,.08)}',
      '.litkb-kpi.is-blue b{color:var(--litkb-accent-text)}',
      '.litkb-kpi.is-green{border-color:rgba(63,185,80,.35);background:rgba(63,185,80,.07)}',
      '.litkb-kpi.is-green b{color:var(--litkb-success)}',
      '.litkb-kpi.is-amber{border-color:rgba(210,153,34,.35);background:rgba(210,153,34,.07)}',
      '.litkb-kpi.is-amber b{color:var(--litkb-warn)}',
      '.litkb-kpi.is-violet{border-color:rgba(163,113,247,.35);background:rgba(163,113,247,.07)}',
      '.litkb-kpi.is-violet b{color:var(--litkb-violet)}',
      '.litkb-kpi.is-neutral{color:var(--litkb-text-3)}',
      '.litkb-kpi.is-clickable{cursor:pointer}',
      '.litkb-kpi.is-clickable:hover{border-color:var(--litkb-border-strong);background:var(--litkb-surface)}',
      '.litkb-filters{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}',
      '.litkb-filter{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;border:1px solid var(--litkb-border);background:none;color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-filter:hover{color:var(--litkb-text);border-color:var(--litkb-border-strong)}',
      '.litkb-filter.is-on{color:var(--litkb-accent-text);border-color:rgba(79,142,247,.5);background:rgba(79,142,247,.1)}',
      '.litkb-filterCount{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-filter.is-on .litkb-filterCount{color:var(--litkb-accent-text)}',
      '.litkb-body{flex:1;overflow:auto;padding:22px 28px;position:relative}',
      '.litkb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:22px}',
      '.litkb-stat{padding:16px 16px 14px;border:1px solid var(--litkb-border);border-top:3px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1);min-width:0}',
      '.litkb-statTop{display:flex;align-items:center;gap:8px}',
      '.litkb-statIcon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;font-size:12px;background:rgba(79,142,247,.14);color:var(--litkb-accent-text)}',
      '.litkb-stat.is-amber .litkb-statIcon{background:rgba(210,153,34,.15);color:var(--litkb-warn)}',
      '.litkb-stat.is-violet .litkb-statIcon{background:rgba(163,113,247,.15);color:var(--litkb-violet)}',
      '.litkb-stat.is-green .litkb-statIcon{background:rgba(63,185,80,.15);color:var(--litkb-success)}',
      '.litkb-stat.is-blue{border-top-color:var(--litkb-accent);background:linear-gradient(180deg,rgba(79,142,247,.10),rgba(79,142,247,.02))}',
      '.litkb-stat.is-amber{border-top-color:var(--litkb-warn);background:linear-gradient(180deg,rgba(210,153,34,.10),rgba(210,153,34,.02))}',
      '.litkb-stat.is-violet{border-top-color:var(--litkb-violet);background:linear-gradient(180deg,rgba(163,113,247,.10),rgba(163,113,247,.02))}',
      '.litkb-stat.is-green{border-top-color:var(--litkb-success);background:linear-gradient(180deg,rgba(63,185,80,.10),rgba(63,185,80,.02))}',
      '.litkb-statLabel{font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-statValue{font-size:24px;font-weight:650;margin:8px 0 3px;letter-spacing:-.2px}',
      '.litkb-statHint{font-size:11px;color:var(--litkb-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-cardBlock{padding:18px;border:1px dashed var(--litkb-border-strong);border-radius:12px}',
      '.litkb-blockHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
      '.litkb-blockTitle{font-size:13px;font-weight:600}',
      '.litkb-list{display:flex;flex-direction:column;gap:4px}',
      '.litkb-listItem{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.litkb-listItem:hover{background:var(--litkb-fill-1)}',
      '.litkb-listItemTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}',
      '.litkb-listItemMeta{flex:none;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.litkb-spacer{flex:1}',
      '.litkb-muted{font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-table{display:flex;flex-direction:column;gap:8px}',
      '.litkb-skelList{display:flex;flex-direction:column;gap:8px}',
      '.litkb-skelRow{height:82px;padding:12px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);display:flex;flex-direction:column;gap:9px}',
      '.litkb-skelLine{height:10px;border-radius:6px;background:linear-gradient(90deg,var(--litkb-fill-1),var(--litkb-fill-2),var(--litkb-fill-1));background-size:200% 100%;animation:litkbShimmer 1.2s ease-in-out infinite}',
      '.litkb-skelLine.is-title{width:72%;height:12px}',
      '.litkb-skelLine.is-meta{width:48%}',
      '.litkb-skelLine.is-tags{width:34%}',
      '@keyframes litkbShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}',
      '.litkb-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:flex-start;padding:11px 12px;min-height:82px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);cursor:pointer}',
      '.litkb-row:hover{border-color:var(--litkb-border-strong);background:var(--litkb-fill-1)}',
      '.litkb-row.is-active{border-color:rgba(79,142,247,.55);background:rgba(79,142,247,.08);box-shadow:inset 3px 0 0 var(--litkb-accent)}',
      '.litkb-rowMain{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.litkb-rowTitleRow{display:flex;align-items:flex-start;gap:7px;min-width:0}',
      '.litkb-rowDot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none}',
      '.litkb-rowTitle{flex:1;min-width:0;font-size:13px;line-height:1.45;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-rowCardMark{width:7px;height:7px;border-radius:2px;background:var(--litkb-accent);margin-top:6px;flex:none}',
      '.litkb-rowMeta{font-size:11px;color:var(--litkb-text-3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-rowTags{display:flex;gap:4px;flex-wrap:wrap;align-items:center}',
      '.litkb-rowMore{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-rowRight{display:flex;align-items:flex-start;gap:8px;flex:none;padding-top:2px;justify-content:flex-end}',
      '.litkb-rowActions{display:none;align-items:center;gap:4px}',
      '.litkb-row:hover .litkb-rowActions,.litkb-row.is-active .litkb-rowActions{display:flex}',
      '.litkb-rowAct{height:22px;padding:0 6px;border:1px solid var(--litkb-border);border-radius:6px;background:var(--litkb-bg);color:var(--litkb-text-2);font:inherit;font-size:11px;line-height:1;cursor:pointer;white-space:nowrap}',
      '.litkb-rowAct:hover{border-color:var(--litkb-accent);color:var(--litkb-accent-text)}',
      '.litkb-status{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-chip{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--litkb-border);color:var(--litkb-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.litkb-chip.is-type{color:var(--litkb-warn);border-color:rgba(210,153,34,.35)}',
      '.litkb-chip.is-tag.tone-0{color:var(--litkb-accent-text);border-color:rgba(121,192,255,.32)}',
      '.litkb-chip.is-tag.tone-1{color:var(--litkb-success);border-color:rgba(86,211,100,.32)}',
      '.litkb-chip.is-tag.tone-2{color:var(--litkb-warn);border-color:rgba(227,179,65,.32)}',
      '.litkb-chip.is-tag.tone-3{color:var(--litkb-violet);border-color:rgba(188,140,255,.32)}',
      '.litkb-chip.is-tag.tone-4{color:#ff8b81;border-color:rgba(255,139,129,.32)}',
      '.litkb-chip.is-select{cursor:pointer;background:none;font:inherit;font-size:11px;padding:3px 9px}',
      '.litkb-chip.is-select.is-on{background:var(--litkb-fill-1);border-color:var(--litkb-accent);color:var(--litkb-text)}',
      '.litkb-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.litkb-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid var(--litkb-accent);background:var(--litkb-accent);color:#fff;font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-btn:disabled{opacity:.6;cursor:default}',
      '.litkb-btnGhost{background:none;color:var(--litkb-text-2);border-color:var(--litkb-border)}',
      '.litkb-progress{padding:6px 10px;margin-bottom:10px;border-radius:8px;background:rgba(79,142,247,.12);font-size:12px;color:var(--litkb-text-2)}',
      '.litkb-error{padding:6px 10px;margin-bottom:10px;border-radius:8px;background:rgba(248,81,73,.12);font-size:12px;color:var(--litkb-danger)}',
      '.litkb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:220px;text-align:center}',
      '.litkb-emptyIcon{font-size:28px;opacity:.35}',
      '.litkb-emptyTitle{font-size:14px;font-weight:600}',
      '.litkb-emptyText{max-width:520px;margin:0;font-size:12.5px;line-height:1.8;color:var(--litkb-text-2)}',
      '.litkb-foot{display:flex;align-items:center;gap:8px;padding:9px 16px;border-top:1px solid var(--litkb-border);font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-dot{width:7px;height:7px;border-radius:50%;background:var(--litkb-text-3);flex:none}',
      '.litkb-dot.is-ok{background:var(--litkb-success);box-shadow:0 0 5px var(--litkb-success)}',
      '.litkb-dot.is-err{background:var(--litkb-danger);box-shadow:0 0 5px var(--litkb-danger)}',
      '.litkb-health{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-link{border:0;background:none;color:var(--litkb-accent-text);font:inherit;font-size:11.5px;cursor:pointer;text-decoration:none;padding:1px 4px;border-radius:4px}',
      '.litkb-link:hover{color:var(--litkb-text);background:rgba(79,142,247,.12)}',
      '.litkb-dropHint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(79,142,247,.08);border:2px dashed var(--litkb-accent);border-radius:14px;font-size:15px;color:var(--litkb-text);pointer-events:none}',
      '.litkb-drawerWrap{position:absolute;inset:0;display:flex;justify-content:flex-end;background:rgba(0,0,0,.25)}',
      '.litkb-drawer{display:flex;flex-direction:column;width:min(480px,86%);height:100%;background:var(--litkb-bg);border-left:1px solid var(--litkb-border);box-shadow:-12px 0 40px rgba(0,0,0,.3)}',
      '.litkb-drawerHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-drawerHead.litkb-detailHead{flex-direction:column;align-items:stretch;justify-content:flex-start;gap:8px;padding:12px 22px 0}',
      '.litkb-detailTop{display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:6px}',
      '.litkb-detailHeadMain{flex:1;min-width:0}',
      '.litkb-detailHead .litkb-detailTitle{font-size:15px;line-height:1.4;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.litkb-detailMeta{font-size:11px;color:var(--litkb-text-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.litkb-detailHead .litkb-drawerTabs{padding-bottom:8px}',
      '.litkb-drawerBody{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
      '.litkb-drawerFoot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--litkb-border)}',
      '.litkb-field{display:flex;flex-direction:column;gap:6px}',
      '.litkb-fieldLabel{font-size:11px;color:var(--litkb-text-2)}',
      '.litkb-input{width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--litkb-border);background:var(--litkb-fill-1);color:var(--litkb-text);font:inherit;font-size:12.5px;outline:none;box-sizing:border-box}',
      '.litkb-input:focus{border-color:var(--litkb-accent)}',
      '.litkb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.litkb-inline{display:flex;gap:8px;align-items:center}',
      '.litkb-metaBlock{padding-top:10px;border-top:1px solid var(--litkb-border);display:flex;flex-direction:column;gap:6px}',
      '.litkb-metaLine{display:flex;justify-content:space-between;gap:12px;font-size:11.5px}',
      '.litkb-metaKey{color:var(--litkb-text-3);flex:none}',
      '.litkb-metaValue{color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-parseHint{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;margin-bottom:8px;border:1px solid rgba(79,142,247,.3);border-radius:7px;background:rgba(79,142,247,.06);font-size:11px;color:var(--litkb-text-2)}',
      '.litkb-numAudit .litkb-mdTable{font-size:11px}',
      '.litkb-numAudit .litkb-mdTable th,.litkb-numAudit .litkb-mdTable td{vertical-align:top}',
      '.litkb-numAudit tr.is-unverified td{background:rgba(210,153,34,.06)}',
      '.litkb-numBad{color:var(--litkb-warn);font-size:11px}',
      '.litkb-numQuote{max-width:360px;color:var(--litkb-text-3);line-height:1.6}',
      '.litkb-deepMd{font-size:13px;line-height:1.9;color:var(--litkb-text-2)}',
      '.litkb-deepMd .litkb-mdH{margin:16px 0 6px;font-size:14px;color:var(--litkb-text)}',
      '.litkb-deepMd .litkb-mdH:first-child{margin-top:0}',
      '.litkb-deepMd .litkb-mdP{margin:0 0 10px}',
      '.litkb-deepMd .litkb-mdList{margin:0 0 10px}',
      '.litkb-deepMd .litkb-mdTable{margin:8px 0 12px}',
      '.litkb-deep{display:flex;flex-direction:column;gap:14px;max-width:1040px;margin:0 auto;padding:2px 0 18px}',
      '.litkb-deepLayout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:start}',
      '.litkb-deepLayout.is-nav-hidden{grid-template-columns:minmax(0,1fr)}',
      '.litkb-deepNav{position:sticky;top:0;align-self:start;display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 230px);overflow:auto;padding:2px 6px 2px 0}',
      '.litkb-deepNavItem{text-align:left;padding:6px 8px;border:0;border-left:2px solid transparent;border-radius:0 6px 6px 0;background:none;color:var(--litkb-text-2);font:inherit;font-size:11.5px;line-height:1.5;cursor:pointer}',
      '.litkb-deepNavItem:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-deepNavItem.is-on{background:var(--litkb-fill-1);color:var(--litkb-text);border-left-color:var(--litkb-accent)}',
      '.litkb-deepMain{min-width:0;display:flex;flex-direction:column;gap:14px}',
      '.litkb-deepSection,.litkb-deepSec{scroll-margin-top:12px}',
      '.litkb-deepSection{padding-bottom:8px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-deepSection:last-of-type{border-bottom:0}',
      '.litkb-deepSectionTitle{margin:0 0 6px;font-size:14px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-deepSectionBody{font-size:13px;line-height:1.85;color:var(--litkb-text)}',
      '.litkb-deepSectionBody .litkb-mdP{margin:0 0 8px}',
      '.litkb-deepSectionBody .litkb-mdList{margin:0 0 8px;padding-left:18px}',
      '.litkb-deepHead{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--litkb-border)}',
      '@media (max-width:900px){.litkb-deepLayout{grid-template-columns:minmax(0,1fr)}.litkb-deepNav{position:relative;max-height:none;flex-direction:row;flex-wrap:wrap;overflow:visible;gap:4px;padding:0 0 6px;border-bottom:1px solid var(--litkb-border)}.litkb-deepNavItem{border-left:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;padding:4px 8px}.litkb-deepNavItem.is-on{border-left:0;border-bottom-color:var(--litkb-accent)}}',
      '.litkb-deepTitle{font-size:15px;font-weight:650;line-height:1.5;flex:1;min-width:220px}',
      '.litkb-deepSec{display:flex;flex-direction:column;gap:7px}',
      '.litkb-deepSecTitle{font-size:12px;font-weight:650;color:var(--litkb-text);padding-bottom:3px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-deepText{margin:0;font-size:12.5px;line-height:1.85;color:var(--litkb-text-2)}',
      '.litkb-deepList{margin:0;padding-left:22px;font-size:12px;line-height:1.85;color:var(--litkb-text-2)}',
      '.litkb-deepMuted{font-size:11px;line-height:1.8;color:var(--litkb-text-3)}',
      '.litkb-deepComponents{display:flex;flex-direction:column;gap:6px}',
      '.litkb-deepComponent{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:1px solid var(--litkb-border);border-radius:7px;background:var(--litkb-fill-1)}',
      '.litkb-deepCompName{font-size:12px;font-weight:600}',
      '.litkb-deepCompRole{font-size:11px;line-height:1.7;color:var(--litkb-text-2)}',
      '.litkb-deepEvRow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.litkb-deepGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;font-size:11.5px;line-height:1.7;color:var(--litkb-text-2)}',
      '.litkb-deepKey{display:inline-block;min-width:56px;color:var(--litkb-text-3)}',
      '.litkb-claims{display:flex;flex-direction:column;gap:7px}',
      '.litkb-claim{display:flex;flex-direction:column;gap:5px;padding:9px 11px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-fill-1)}',
      '.litkb-claim.is-unsupported{border-color:rgba(210,153,34,.45);background:rgba(210,153,34,.06)}',
      '.litkb-claimTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-claimType{font-size:11px;padding:1px 5px;border-radius:4px;background:rgba(79,142,247,.12);color:var(--litkb-accent-text)}',
      '.litkb-claimStrength{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-claimStatus{font-size:11px;color:var(--litkb-success)}',
      '.litkb-claim.is-unsupported .litkb-claimStatus{color:var(--litkb-warn)}',
      '.litkb-claimText{font-size:12px;line-height:1.8;color:var(--litkb-text)}',
      '.litkb-managePanel{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}',
      '.litkb-manageHead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;row-gap:6px;padding:12px 22px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-manageTabs{display:inline-flex;gap:2px}',
      '.litkb-manageTab{padding:5px 11px;border:0;border-bottom:2px solid transparent;background:none;color:var(--litkb-text-2);font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-manageTab.is-on{color:var(--litkb-text);border-bottom-color:var(--litkb-accent)}',
      '.litkb-manageBody{flex:1;min-height:0;overflow:auto;width:100%;max-width:920px;margin:0 auto;padding:22px 30px}',
      '.litkb-manageSection{display:flex;flex-direction:column;gap:12px}',
      '.litkb-tagAdd{display:flex;flex-direction:column;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-tagList{display:flex;flex-direction:column;gap:10px}',
      '.litkb-tagRow{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--litkb-border);border-radius:8px}',
      '.litkb-tagHead{display:flex;align-items:center;gap:8px}',
      '.litkb-tagName{font-size:12.5px;font-weight:600}',
      '.litkb-tagKeywords{display:flex}',
      '.litkb-toast{position:absolute;right:20px;bottom:56px;width:320px;padding:12px 14px;border-radius:10px;border:1px solid var(--litkb-border);background:var(--litkb-bg);box-shadow:0 12px 40px rgba(0,0,0,.35)}',
      '.litkb-toast.is-ok{border-color:rgba(63,185,80,.5)}',
      '.litkb-toast.is-warn{border-color:rgba(210,153,34,.5)}',
      '.litkb-toast.is-err{border-color:rgba(248,81,73,.5)}',
      '.litkb-toastTitle{font-size:12.5px;font-weight:600;margin-bottom:4px}',
      '.litkb-toastText{font-size:11.5px;color:var(--litkb-text-2);line-height:1.6;word-break:break-all}',
      '.litkb-toastActions{display:flex;align-items:center;gap:12px;margin-top:8px}',
      '.litkb-toastClose{margin-left:auto;border:0;background:none;color:var(--litkb-text-3);font-size:15px;cursor:pointer}',
      '.litkb-resultRow{padding:10px;border:1px solid var(--litkb-border);border-radius:8px;display:flex;flex-direction:column;gap:5px}',
      '.litkb-resultTop{display:flex;align-items:center;gap:8px}',
      '.litkb-resultName{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-resultStatus{flex:none;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--litkb-border)}',
      '.litkb-resultStatus.is-added{color:var(--litkb-success);border-color:rgba(63,185,80,.4)}',
      '.litkb-resultStatus.is-duplicate{color:var(--litkb-warn);border-color:rgba(210,153,34,.4)}',
      '.litkb-resultStatus.is-failed{color:var(--litkb-danger);border-color:rgba(248,81,73,.4)}',
      '.litkb-resultReason{font-size:11px;color:var(--litkb-text-3);line-height:1.5}',
      '.litkb-resultActions{display:flex;gap:8px}',
      '.litkb-paperPick{width:160px;min-width:120px;max-width:210px;height:28px;padding:2px 8px;font-size:11.5px}',
      '.litkb-filterPick{width:96px;min-width:86px;height:28px;padding:2px 6px;font-size:11px}',
      '.litkb-drawer.is-wide{width:min(780px,94%)}',
      '.litkb-drawerTabs{display:flex;gap:2px;flex-wrap:wrap}',
      '.litkb-dtab{padding:6px 10px;border:0;border-bottom:2px solid transparent;background:none;color:var(--litkb-text-2);font:inherit;font-size:12.5px;cursor:pointer}',
      '.litkb-dtab.is-on{color:var(--litkb-text);border-bottom-color:var(--litkb-accent)}',
      '.litkb-chip.is-card{color:var(--litkb-accent);border-color:rgba(79,142,247,.4)}',
      '.litkb-card{display:flex;flex-direction:column;gap:18px}',
      '.litkb-cardEmpty{display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:8px 0}',
      '.litkb-cardMeta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11.5px}',
      '.litkb-statusPill{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--litkb-border);background:var(--litkb-fill-1);white-space:nowrap}',
      '.litkb-statusPill.is-ok{color:var(--litkb-success);border-color:rgba(63,185,80,.45)}',
      '.litkb-statusPill.is-warn{color:var(--litkb-warn);border-color:rgba(210,153,34,.45)}',
      '.litkb-sec{display:flex;flex-direction:column;gap:10px}',
      '.litkb-secHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;row-gap:6px}',
      '.litkb-secNo{width:18px;height:18px;flex:none;border-radius:50%;background:rgba(79,142,247,.16);color:var(--litkb-accent);font-size:11px;line-height:18px;text-align:center}',
      '.litkb-secTitle{font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-secTag{font-size:11px;padding:1px 7px;border-radius:999px;color:var(--litkb-warn);border:1px solid rgba(210,153,34,.35)}',
      '.litkb-secBtn{display:inline-flex;align-items:center;gap:4px;flex:none;height:24px;padding:0 8px;border-radius:6px;font:inherit;font-size:11px;cursor:pointer;border:1px solid transparent;background:none}',
      '.litkb-secBtn.is-edit{color:var(--litkb-accent-text);border-color:rgba(79,142,247,.35);background:rgba(79,142,247,.08)}',
      '.litkb-secBtn.is-regen{color:var(--litkb-violet);border-color:rgba(163,113,247,.35);background:rgba(163,113,247,.08)}',
      '.litkb-secBtn:hover{filter:brightness(1.15)}',
      '.litkb-secBtn:disabled{opacity:.45;cursor:default}',
      '.litkb-miniBtn{height:24px;padding:0 7px;border-radius:6px;border:1px solid var(--litkb-border);background:var(--litkb-fill-1);color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-miniBtn:hover{color:var(--litkb-text);border-color:var(--litkb-border-strong)}',
      '.litkb-secText{margin:0;font-size:12.5px;line-height:1.85;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-quote{margin:0;padding:8px 12px;border-left:3px solid rgba(79,142,247,.5);background:var(--litkb-fill-1);border-radius:0 8px 8px 0;display:flex;flex-direction:column;gap:6px}',
      '.litkb-quoteText{font-size:12px;line-height:1.8;color:var(--litkb-text-2)}',
      '.litkb-quoteMeta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:4px;font-size:11px}',
      '.litkb-evPage{border:1px solid color-mix(in srgb,var(--litkb-accent) 32%,transparent);background:var(--litkb-fill-2);padding:1px 7px;border-radius:999px;color:var(--litkb-accent-text);font:inherit;font-size:11px;cursor:pointer;text-decoration:none}',
      '.litkb-evId{color:var(--litkb-text-3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.litkb-warnings{padding:10px 12px;border-radius:8px;background:rgba(210,153,34,.08);border:1px solid rgba(210,153,34,.28)}',
      '.litkb-warnTitle{font-size:11.5px;font-weight:600;color:var(--litkb-warn);margin-bottom:4px}',
      '.litkb-warnLine{font-size:11px;line-height:1.7;color:var(--litkb-text-2)}',
      '.litkb-body.is-split{padding:0;overflow:hidden;display:flex;flex-direction:column}',
      '.litkb-split{flex:1;min-height:0;display:grid;grid-template-columns:320px minmax(0,1fr);overflow:hidden}',
      '.litkb-split{display:grid;grid-template-columns:320px 6px minmax(0,1fr);gap:0;overflow:hidden}',
      '.litkb-resizer{position:relative;width:6px;cursor:col-resize;background:var(--litkb-border);flex:none;transition:background .15s}',
      '.litkb-resizer:hover,.litkb-resizer:active{background:var(--litkb-accent)}',
      '.litkb-listDrawerWrap{position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-start;background:rgba(0,0,0,.45)}',
      '.litkb-listDrawer{width:min(380px,92vw);height:100%;display:flex;flex-direction:column;background:var(--litkb-bg);border-right:1px solid var(--litkb-border);box-shadow:var(--litkb-shadow-2)}',
      '.litkb-listDrawerBody{flex:1;min-height:0;overflow:auto;padding:12px}',
      '.litkb-railDrawerWrap{position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-end;background:rgba(0,0,0,.45)}',
      '.litkb-railDrawer{width:min(560px,94vw);height:100%;display:flex;flex-direction:column;background:var(--litkb-bg);border-left:1px solid var(--litkb-border);box-shadow:var(--litkb-shadow-2)}',
      '.litkb-railDrawerBar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--litkb-border);flex:none}',
      '.litkb-railDrawer .litkb-pdfRail{flex:1;min-height:0;height:auto;border-left:0}',
      '.litkb-pdfRail{min-width:0;display:flex;flex-direction:column;overflow:hidden;border-left:0;background:var(--litkb-bg)}',
      '.litkb-pdfRailHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap;row-gap:4px;min-height:42px;height:auto;flex:none;padding:6px 8px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-pdfRailBody{flex:1;min-height:0;overflow:auto;padding:8px;background:var(--litkb-fill-1)}',
      '.litkb-pdfRailBody{position:relative;scroll-behavior:smooth}',
      '.litkb-pdfRailPage{position:relative;margin:0 auto 8px;border-radius:4px;overflow:hidden}',
      '.litkb-pdfRailPageNo{font-size:11px;color:var(--litkb-text-3);text-align:right;padding:2px 0 4px}',
      '.litkb-zoom{display:inline-flex;align-items:center;border:1px solid var(--litkb-border);border-radius:6px;overflow:hidden}',
      '.litkb-zoomValue{border:0;background:none;color:var(--litkb-text-2);font:inherit;font-size:11px;min-width:40px;min-height:24px;padding:2px 4px;cursor:pointer}',
      '.litkb-zoomValue:hover{color:var(--litkb-text)}',
      '.litkb-railTabs{display:flex;align-items:center;gap:2px;flex-wrap:wrap}',
      '.litkb-railTab{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:5px 9px;border:0;border-bottom:2px solid transparent;background:none;color:var(--litkb-text-2);font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-railTab.is-on{color:var(--litkb-text);border-bottom-color:var(--litkb-accent)}',
      '.litkb-pdfControls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-railTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-railPane{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}',
      '.litkb-railHint{font-size:11px;line-height:1.7;color:var(--litkb-text-3);padding:2px 0}',
      '.litkb-evRow{display:flex;flex-direction:column;gap:6px;width:100%;min-height:76px;padding:10px 11px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-evRow:hover{border-color:rgba(79,142,247,.45);background:rgba(79,142,247,.06)}',
      '.litkb-evSeg{display:flex;gap:4px;padding:2px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-fill-1)}',
      '.litkb-evSegBtn{flex:1;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--litkb-text-2);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-evSegBtn.is-on{background:rgba(79,142,247,.16);color:var(--litkb-text)}',
      '.litkb-evList{display:flex;flex-direction:column;gap:8px}',
      '.litkb-evItem{display:flex;flex-direction:column;gap:4px}',
      '.litkb-evItemActions{display:flex;justify-content:flex-end;gap:6px;padding-top:1px}',
      '.litkb-chainRail{display:flex;flex-direction:column;gap:8px}',
      '.litkb-chainRailHead{display:flex;align-items:center;gap:6px}',
      '.litkb-chainRailHead .litkb-btn{flex:1}',
      '.litkb-evRowTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-evRowText{font-size:12px;line-height:1.7;color:var(--litkb-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-railMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-infoTitle{font-size:12.5px;font-weight:600;line-height:1.5}',
      '.litkb-infoGrid{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-top:1px solid var(--litkb-border);border-bottom:1px solid var(--litkb-border)}',
      '.litkb-infoLine{display:grid;grid-template-columns:78px minmax(0,1fr);gap:8px;font-size:11px}',
      '.litkb-infoKey{color:var(--litkb-text-3)}',
      '.litkb-infoValue{color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-askRail{overflow:hidden;padding:8px}',
      '.litkb-askInline{display:flex;flex-direction:column;gap:10px;width:100%;height:100%;min-height:0;overflow:auto}',
      '.litkb-askInline .litkb-askCard{width:100%;max-height:none;border:0;border-radius:0;box-shadow:none;background:transparent;padding:2px}',
      '.litkb-pageInput{width:54px;min-width:54px;padding:3px 6px;font-size:11px}',

      '.litkb-pdfRailBody .litkb-shotInner{border-radius:4px}',
      '.litkb-pdfRailFoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;row-gap:4px;min-height:28px;height:auto;flex:none;padding:4px 8px;border-top:1px solid var(--litkb-border);font-size:11px}',
      '.litkb-pageBtn{padding:2px 8px;font-size:15px;line-height:1}',
      '.litkb-listPane{min-width:0;height:100%;overflow:auto;padding:14px 12px;border-right:0}',
      '.litkb-readPane{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
      '.litkb-detailInline{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}',
      '.litkb-detailInline .litkb-drawerHead.litkb-detailHead{padding:12px 22px 0;gap:8px;flex-wrap:nowrap}',
      '.litkb-detailInline .litkb-drawerTabs{flex:none}',
      '.litkb-detailTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}',
      '.litkb-detailInline .litkb-drawerBody{flex:1;min-height:0;overflow:auto;padding:22px 30px}',
      '.litkb-detailInline .litkb-drawerBody:not(.is-flush){width:100%;max-width:920px;margin:0 auto}',
      '.litkb-detailInline .litkb-drawerBody.is-flush{overflow:hidden;padding:14px 18px;display:flex}',
      '.litkb-detailInline .litkb-parsePane{max-width:none}',
      '.litkb-reader.is-flat{gap:0}',
      '.litkb-reader.is-flat .litkb-parsePane{flex:1;border:0;border-radius:0;padding:4px 8px}',
      '.litkb-reader.is-flat .litkb-pblockText{font-size:13px;line-height:1.9}',
      '.litkb-cardActions{display:flex;gap:8px;padding-top:6px}',
      '.litkb-cardActions a{text-decoration:none}',
      '.litkb-drawerBody.is-flush{overflow:hidden;display:flex;padding:12px}',
      '.litkb-reader{display:flex;gap:10px;flex:1;min-height:0}',
      '.litkb-parsePane,.litkb-pagePane{min-width:0;overflow:auto;border:1px solid var(--litkb-border);border-radius:8px;padding:10px}',
      '.litkb-parsePane{flex:1.15}',
      '.litkb-pagePane{flex:0.85;background:#0e1117}',
      '.litkb-parseHead{display:flex;align-items:center;gap:10px;padding-bottom:8px;position:sticky;top:-10px;background:var(--litkb-bg);z-index:2}',
      '.litkb-parsePage{padding-top:6px}',
      '.litkb-pageNo{font-size:11px;color:var(--litkb-text-3);margin:6px 0 4px}',
      '.litkb-pblock{padding:6px 8px;border-radius:6px;border:1px solid transparent;border-left:2px solid transparent;cursor:pointer;margin-bottom:2px;transition:background-color .12s,border-color .12s}',
      '.litkb-pblock:hover{background:var(--litkb-fill-1)}',
      '.litkb-pblock.litkb-focus{background:var(--litkb-fill-1);border-color:var(--litkb-border);box-shadow:inset 3px 0 0 var(--litkb-accent)}',
      '.litkb-pblock:hover{background:var(--litkb-fill-1)}',
      '.litkb-pblock.litkb-focus{border-color:var(--litkb-accent);background:rgba(79,142,247,.12)}',
      '.litkb-pblockText{font-size:13px;line-height:1.8;color:var(--litkb-text);white-space:pre-wrap}',
      '.litkb-pblock.is-heading1 .litkb-pblockText{font-weight:600;font-size:13px;color:var(--litkb-text)}',
      '.litkb-pblock.is-title .litkb-pblockText{font-weight:700;font-size:14px;color:var(--litkb-text)}',
      '.litkb-pblock.is-caption .litkb-pblockText{color:var(--litkb-warn)}',
      '.litkb-pblock.is-header .litkb-pblockText,.litkb-pblock.is-footer .litkb-pblockText{color:var(--litkb-text-3);font-size:11px}',
      '.litkb-pblockMeta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--litkb-text-3);margin-top:2px}',
      '.litkb-pblockRole{color:var(--litkb-text-3);font-size:11px}',
      '.litkb-pblockActions{display:flex;align-items:center;gap:4px;opacity:0;pointer-events:none;transition:opacity .12s}',
      '.litkb-pblock:hover .litkb-pblockActions,.litkb-pblock.litkb-focus .litkb-pblockActions{opacity:1;pointer-events:auto}',
      '.litkb-blockAct{height:24px;padding:0 7px;border:1px solid var(--litkb-border);border-radius:6px;background:var(--litkb-bg);color:var(--litkb-text-2);font:inherit;font-size:11px;line-height:1;cursor:pointer}',
      '.litkb-blockAct:hover{border-color:var(--litkb-border-strong);color:var(--litkb-text)}',
      '.litkb-blockAct.is-accent{border-color:var(--litkb-accent);color:var(--litkb-accent-text);background:var(--litkb-fill-1)}',
      '.litkb-shot{position:relative;margin-bottom:12px}',
      '.litkb-shotInner{position:relative;width:100%;height:0;overflow:hidden;border-radius:4px;background:#fff}',
      '.litkb-shotInner img{position:absolute;inset:0;width:100%;height:100%;display:block}',
      '.litkb-box{position:absolute;border:1px solid transparent;border-radius:2px;cursor:pointer}',
      '.litkb-box:hover{background:rgba(79,142,247,.16);border-color:rgba(79,142,247,.55)}',
      '.litkb-box.litkb-focus{border:2px solid var(--litkb-accent)}',
      '.litkb-pdfWrap{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--litkb-bg)}',
      '.litkb-pdfHead{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-pdfTitle{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-pdfBody{flex:1;overflow:auto;padding:12px;background:#0e1117}',
      '.litkb-pdfImg{width:100%;display:block;border-radius:4px;margin-bottom:12px}',
      '.litkb-statusSelect{width:auto;padding:2px 8px;font-size:11px;border-radius:6px}',
      '.litkb-evMissing{font-size:11px;color:var(--litkb-warn);border:1px solid rgba(210,153,34,.35);border-radius:999px;padding:1px 6px}',
      '.litkb-evContext{margin-top:6px;padding:6px 8px;border-radius:6px;background:var(--litkb-fill-1);display:flex;flex-direction:column;gap:4px}',
      '.litkb-evContextLine{font-size:11px;line-height:1.7;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-evContextLabel{display:inline-block;min-width:28px;color:var(--litkb-text-3);font-size:11px;margin-right:6px}',
      '.litkb-backlinkWrap{display:inline-flex;flex-direction:column;gap:4px;min-width:0}',
      '.litkb-backlinks{margin-top:6px;padding:6px 8px;border-left:2px solid var(--litkb-border-strong);display:flex;flex-direction:column;gap:4px}',
      '.litkb-backlink{display:flex;gap:8px;font-size:11px;line-height:1.6}',
      '.litkb-backlinkFile{flex:none;color:var(--litkb-accent);font-family:ui-monospace,Menlo,monospace;font-size:11px}',
      '.litkb-backlinkText{color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-cardActions{flex-wrap:wrap}',
      '.litkb-textarea{min-height:84px;resize:vertical;font:inherit;line-height:1.7;padding:8px 10px}',
      '.litkb-secEdit{display:flex;flex-direction:column;gap:6px}',
      '.litkb-notes{border-top:1px dashed var(--litkb-border);padding-top:10px}',
      '.litkb-note{display:flex;gap:10px;font-size:12px;line-height:1.7;padding:4px 0}',
      '.litkb-noteAt{flex:none;color:var(--litkb-text-3);font-size:11px;min-width:70px}',
      '.litkb-noteText{color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-noteAdd{display:flex;flex-direction:column;gap:6px;margin-top:6px;align-items:flex-start}',
      '.litkb-versions{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--litkb-border);border-radius:8px;margin-top:8px}',
      '.litkb-versionRow{display:flex;align-items:center;gap:10px;padding:4px 0;border-top:1px solid var(--litkb-border);font-size:11.5px}',
      '.litkb-versionTime{flex:0 0 120px;color:var(--litkb-text-2)}',
      '.litkb-transBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0 10px;border-bottom:1px solid var(--litkb-border);margin-bottom:8px}',
      '.litkb-seg{display:inline-flex;border:1px solid var(--litkb-border);border-radius:8px;overflow:hidden}',
      '.litkb-segBtn{padding:4px 10px;border:0;background:none;color:var(--litkb-text-2);font:inherit;font-size:11.5px;cursor:pointer}',
      '.litkb-segBtn.litkb-on{background:rgba(79,142,247,.2);color:var(--litkb-text)}',
      '.litkb-scope{width:auto;min-width:86px;padding:4px 8px;font-size:11.5px}',
      '.litkb-trans{margin-top:6px;padding:8px 10px;border-left:3px solid rgba(79,142,247,.55);background:rgba(79,142,247,.07);border-radius:0 6px 6px 0}',
      '.litkb-trans.is-stale{border-left-color:var(--litkb-warn);background:rgba(210,153,34,.06)}',
      '.litkb-trans.is-warn{border-left-color:var(--litkb-warn);background:rgba(210,153,34,.08)}',
      '.litkb-trans.is-failed{border-left-color:var(--litkb-danger);background:rgba(248,81,73,.08)}',
      '.litkb-trans.is-empty{border:0;background:none;padding:2px 0;display:flex;align-items:center;gap:8px}',
      '.litkb-transTop{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-transBadge{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid rgba(79,142,247,.4);color:var(--litkb-accent)}',
      '.litkb-transIssues{color:var(--litkb-warn);max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-transText{font-size:12px;line-height:1.8;color:var(--litkb-text-2);white-space:pre-wrap;margin-top:4px}',
      '.litkb-glossary{display:flex;flex-direction:column;gap:6px;padding:10px;margin-bottom:8px;border:1px solid var(--litkb-border);border-radius:8px;max-height:280px;overflow:auto;background:var(--litkb-fill-1)}',
      '.litkb-glossary.is-embedded{border:0;background:transparent;padding:0;margin:0;max-height:none;overflow:visible}',
      '.litkb-glossDirty{font-size:11px;color:var(--litkb-warn)}',
      '.litkb-glossNotice{font-size:11px;color:var(--litkb-success);max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-glossFoot{display:flex;align-items:center;gap:8px;position:sticky;bottom:-10px;padding:8px 0 2px;background:var(--litkb-bg)}',
      '.litkb-glossRow{display:flex;align-items:center;gap:8px}',
      '.litkb-glossSource{flex:0 0 30%;font-size:11.5px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-tokenForm{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px dashed var(--litkb-border-strong);border-radius:8px;margin:4px 0 8px;max-width:560px}',
      '.litkb-askFab{position:fixed;z-index:10002;padding:5px 12px;border-radius:999px;border:1px solid var(--litkb-accent);background:#1a2333;color:var(--litkb-text);font:inherit;font-size:12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4)}',
      '.litkb-askFab:hover{background:var(--litkb-accent);color:#fff}',
      '.litkb-askWrap{position:fixed;inset:0;z-index:10001;display:flex;align-items:flex-end;justify-content:flex-end;padding:20px;background:rgba(0,0,0,.35)}',
      '.litkb-askCard{display:flex;flex-direction:column;gap:10px;width:min(520px,94vw);max-height:80vh;overflow:auto;padding:14px 16px;border-radius:12px;border:1px solid var(--litkb-border);background:var(--litkb-bg);box-shadow:0 20px 60px rgba(0,0,0,.55)}',
      '.litkb-askHead{display:flex;align-items:center;gap:10px}',
      '.litkb-askTitle{font-size:13px;font-weight:600}',
      '.litkb-askSelection{padding:8px 10px;border-left:3px solid rgba(79,142,247,.6);background:rgba(79,142,247,.07);border-radius:0 6px 6px 0;font-size:12px;line-height:1.7;color:var(--litkb-text-2);white-space:pre-wrap;max-height:110px;overflow:auto}',
      '.litkb-askInputRow{display:flex;gap:8px;align-items:flex-end}',
      '.litkb-askInputRow .litkb-textarea{flex:1;min-height:64px}',
      '.litkb-askPresets{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-askBody{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--litkb-border);padding-top:10px}',
      '.litkb-askAnswer{font-size:12.5px;line-height:1.9;color:var(--litkb-text-2);white-space:pre-wrap;word-break:break-word}',
      '.litkb-cite{display:inline;padding:0 2px;border:0;border-radius:4px;background:rgba(79,142,247,.16);color:var(--litkb-accent);font:inherit;font-size:11.5px;cursor:pointer}',
      '.litkb-cite:hover{background:rgba(79,142,247,.3)}',
      '.litkb-cite.is-bad{color:var(--litkb-danger);background:rgba(248,81,73,.14);text-decoration:line-through;cursor:default}',
      '.litkb-askCites{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;background:var(--litkb-fill-1)}',
      '.litkb-askCitesTitle{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-askCite{display:flex;gap:8px;font-size:11px;line-height:1.6}',
      '.litkb-askCiteText{color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-askBadCites{font-size:11px;color:var(--litkb-danger)}',
      '.litkb-askActions{display:flex;align-items:center;gap:8px}',
      '.litkb-settingsPage{display:flex;flex-direction:column;gap:16px;max-width:780px}',
      '.litkb-settingsSection{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1)}',
      '.litkb-settingsTitle{font-size:13px;font-weight:600}',
      '.litkb-settingsRow{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;align-items:center;font-size:12px}',
      '.litkb-settingsLabel{font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-settingsCode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-settingsValue{font-size:12px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-settingsHint{font-size:11px;line-height:1.7;color:var(--litkb-text-3)}',
      '.litkb-settingsCheck{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-settingsActions{display:flex;align-items:center;gap:10px}',
      '.litkb-graph{display:flex;flex-direction:column;gap:10px}',
      '.litkb-graphPage{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.litkb-graphTabs{display:flex;align-items:center;gap:8px;flex:none;padding:10px 16px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-graphPage > .litkb-graph{flex:1;min-height:0;overflow:auto;padding:12px 16px}',
      '.litkb-kb{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.litkb-kbHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none;padding:10px 16px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-kbTitle{font-size:13px;font-weight:650;color:var(--litkb-text)}',
      '.litkb-kbStats{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-kbStat{padding:2px 8px;border:1px solid var(--litkb-border);border-radius:999px}',
      '.litkb-kbStat b{color:var(--litkb-text);font-size:12px}',
      '.litkb-kbStat.is-chain{border-color:rgba(96,165,250,.4);color:var(--litkb-accent-text)}',
      '.litkb-kbStat.is-evidence{border-color:rgba(74,222,128,.4);color:var(--litkb-success)}',
      '.litkb-kbStat.is-paper{border-color:rgba(192,132,252,.4);color:var(--litkb-violet-text)}',
      '.litkb-kbStat.is-unchained{border-color:rgba(100,116,139,.5);color:var(--litkb-text-2)}',
      '.litkb-kbStat.is-warn{border-color:rgba(245,158,11,.45);color:var(--litkb-warn)}',
      '.litkb-kbSearch{width:210px;height:28px;font-size:11px}',
      '.litkb-kbLegend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;padding:6px 16px;border-bottom:1px solid var(--litkb-border);font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-kbLegendItem{display:inline-flex;align-items:center;gap:4px}',
      '.litkb-kbDot{width:14px;height:2px;border-radius:2px;display:inline-block}',
      '.litkb-kbDot.is-dashed{height:0;border-top:1px dashed var(--litkb-warn);background:transparent}',
      '.litkb-kbNodeDot{width:9px;height:9px;border:1.5px solid var(--litkb-accent-text);border-radius:3px;display:inline-block}',
      '.litkb-kbNodeDot.is-paper{border-radius:50%}',
      '.litkb-kbNodeDot.is-unchained{background:#1e1b4b;border-color:#64748b;border-style:dashed}',
      '.litkb-kbLegendSep{width:1px;height:12px;background:rgba(148,163,184,.25);display:inline-block}',
      '.litkb-kbBanner{padding:8px 16px;border-bottom:1px solid rgba(100,116,139,.35);background:rgba(100,116,139,.12);color:var(--litkb-text-2);font-size:11px;line-height:1.6}',
      '.litkb-kbMuted{margin-left:auto;color:var(--litkb-text-3)}',
      '.litkb-kbMain{flex:1;min-height:0;display:flex;position:relative}',
      '.litkb-kbCanvasWrap{flex:1;min-width:0;position:relative;background:var(--litkb-bg)}',
      '.litkb-kbCanvasWrap.is-dark{background:radial-gradient(rgba(148,163,184,.1) 1px,transparent 1.2px) 0 0/22px 22px,radial-gradient(circle at 30% 20%,rgba(79,142,247,.08),transparent 60%),#0b0e14}',
      '.litkb-kbCanvasWrap.is-light{background:radial-gradient(rgba(15,23,42,.08) 1px,transparent 1.2px) 0 0/22px 22px,radial-gradient(circle at 30% 20%,rgba(37,99,235,.06),transparent 60%),#f8fafc}',
      '.litkb-kbCanvas{position:absolute;inset:0;cursor:grab}',
      '.litkb-kbCanvas:active{cursor:grabbing}',
      '.litkb-kbOverlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;background:color-mix(in srgb,var(--litkb-bg) 82%,transparent);color:var(--litkb-text-2);z-index:2}',
      '.litkb-kbEmpty{background:transparent}',
      '.litkb-kbSide{width:300px;flex:none;border-left:1px solid var(--litkb-border);overflow:auto;padding:14px;position:relative;background:var(--litkb-fill-1)}',
      '.litkb-kbSideClose{position:absolute;top:8px;right:8px}',
      '.litkb-kbSideBody{display:flex;flex-direction:column;gap:9px;padding-top:6px}',
      '.litkb-kbSideKind{font-size:11px;color:var(--litkb-accent-text);letter-spacing:.06em}',
      '.litkb-kbSideKind.is-claim{color:var(--litkb-accent-text)}',
      '.litkb-kbSideKind.is-evidence{color:var(--litkb-success)}',
      '.litkb-kbSideKind.is-paper{color:var(--litkb-violet-text)}',
      '.litkb-kbSideKind.is-edge{color:var(--litkb-warn)}',
      '.litkb-kbSideTitle{font-size:13px;font-weight:650;line-height:1.6;color:var(--litkb-text)}',
      '.litkb-kbSideText{font-size:13px;line-height:1.8;color:var(--litkb-text)}',
      '.litkb-kbSideMeta{font-size:11px;color:var(--litkb-text-3);line-height:1.6}',
      '.litkb-kbSideQuote{font-size:11.5px;line-height:1.75;color:var(--litkb-text-2);padding:8px;border-left:2px solid rgba(79,142,247,.4);background:rgba(79,142,247,.05)}',
      '.litkb-kbSideActions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}',
      '.litkb-kbWarn{font-size:11px;line-height:1.7;color:var(--litkb-warn);padding:6px 8px;border:1px solid rgba(210,153,34,.4);border-radius:6px;background:rgba(210,153,34,.08)}',
      '.litkb-kbTip{position:absolute;z-index:5;max-width:300px;padding:9px 11px;border:1px solid var(--litkb-border-strong);border-radius:9px;background:var(--litkb-surface-2);box-shadow:var(--litkb-shadow-2);pointer-events:none;display:flex;flex-direction:column;gap:4px}',
      '.litkb-kbTipKind{font-size:11px;letter-spacing:.06em;color:var(--litkb-accent-text)}',
      '.litkb-kbTipKind.is-evidence{color:var(--litkb-success)}',
      '.litkb-kbTipKind.is-paper{color:var(--litkb-violet-text)}',
      '.litkb-kbTipKind.is-method{color:var(--litkb-success)}',
      '.litkb-kbTipKind.is-dataset{color:var(--litkb-warn)}',
      '.litkb-kbTipKind.is-metric{color:var(--litkb-accent-text)}',
      '.litkb-kbTipText{font-size:11px;line-height:1.65;color:var(--litkb-text)}',
      '.litkb-kbTipMeta{font-size:11px;color:var(--litkb-text-2)}',
      '.litkb-graphBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.litkb-graphFilters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-fill-1)}',
      '.litkb-year{width:88px;min-width:88px}',
      '.litkb-graphSearch{width:160px;min-width:120px}',
      '.litkb-compareDeep{flex:1;min-height:0;overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px}',
      '.litkb-compareHead{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.litkb-comparePapers{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.litkb-compareScroll{min-height:0;overflow:auto;border:1px solid var(--litkb-border);border-radius:10px}',
      '.litkb-compareGrid{border-collapse:separate;border-spacing:0;width:100%;min-width:720px;font-size:12px;line-height:1.7}',
      '.litkb-compareGrid th,.litkb-compareGrid td{padding:9px 11px;vertical-align:top;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-compareGrid tr.is-diff .litkb-compareSection{box-shadow:inset 3px 0 0 var(--litkb-warn)}',
      '.litkb-compareGrid tr.is-diff .litkb-compareCell{background:color-mix(in srgb,var(--litkb-warn) 5%,var(--litkb-bg))}',
      '.litkb-compareSectionBtn{padding:0;border:0;background:none;color:inherit;font:inherit;font-size:11px;cursor:pointer;text-align:left}',
      '.litkb-compareDiffBadge{display:inline-block;margin-top:4px;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--litkb-warn) 12%,transparent);color:var(--litkb-warn);font-size:11px;font-weight:500}',
      '.litkb-compareChainBtn{margin-top:5px;padding:2px 7px;border:1px solid var(--litkb-border);border-radius:6px;background:var(--litkb-bg);color:var(--litkb-accent-text);font:inherit;font-size:11px;cursor:pointer}',
      '.litkb-compareChainBtn:disabled{opacity:.5;cursor:default}',
      '.litkb-compareNums{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}',
      '.litkb-compareNum{padding:1px 6px;border:1px solid var(--litkb-border);border-radius:999px;font-size:11px;color:var(--litkb-text-3);background:var(--litkb-fill-1)}',
      '.litkb-compareNum.is-diff{border-color:color-mix(in srgb,var(--litkb-warn) 45%,var(--litkb-border));color:var(--litkb-warn)}',
      '.litkb-compareCollapsed{color:var(--litkb-text-3);font-size:11px}',
      '.litkb-compareGrid thead th{position:sticky;top:0;z-index:1;background:var(--litkb-surface);color:var(--litkb-text);text-align:left;font-size:11px;font-weight:600}',
      '.litkb-compareSection{position:sticky;left:0;z-index:1;width:150px;background:var(--litkb-surface);color:var(--litkb-text-3);text-align:left;font-weight:500;white-space:nowrap}',
      '.litkb-comparePaperTitle{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-compareCell{min-width:220px;color:var(--litkb-text);background:var(--litkb-bg)}',
      '.litkb-compareCell .litkb-mdP{margin:0 0 6px}',
      '.litkb-graphMain{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:10px;align-items:start}',
      '.litkb-graphCanvasWrap{position:relative;min-width:0;border:1px solid var(--litkb-border);border-radius:10px;overflow:hidden}',
      '.litkb-graphCanvasWrap.is-dark{background:radial-gradient(circle at 50% 45%,rgba(79,142,247,.08),transparent 65%),#0b0e14}',
      '.litkb-graphCanvasWrap.is-light{background:radial-gradient(circle at 50% 45%,rgba(37,99,235,.05),transparent 65%),#f8fafc}',
      '.litkb-graphCanvas{display:block;width:100%;height:500px}',
      '.litkb-graphLegend{position:absolute;left:10px;bottom:10px;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100% - 20px);padding:5px 8px;border:1px solid var(--litkb-border);border-radius:7px;background:color-mix(in srgb,var(--litkb-bg) 84%,transparent);font-size:11px;color:var(--litkb-text-2)}',
      '.litkb-graphLegendItem{display:inline-flex;align-items:center;gap:4px}',
      '.litkb-graphLegendLine{width:12px;height:2px;border-radius:1px}',
      '.litkb-graphLegendDot{width:8px;height:8px;border-radius:50%;border:1px solid transparent;flex:none}',
      '.litkb-graphLegendSep{width:1px;height:14px;background:var(--litkb-border);margin:0 2px}',
      '.litkb-graphProgress{position:absolute;left:10px;top:10px;margin:0}',
      '.litkb-graphHint{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px dashed var(--litkb-border-strong);border-radius:10px;min-height:120px}',
      '.litkb-graphDetail{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1);max-height:500px;overflow:auto}',
      '.litkb-graphDetailHead{display:flex;align-items:center;gap:8px}',
      '.litkb-graphDot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.litkb-graphRel{display:flex;flex-direction:column;gap:3px;margin-top:4px}',
      '.litkb-graphRelRow{display:flex;align-items:center;gap:8px;padding:4px 6px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;font-size:11px;cursor:pointer;text-align:left}',
      '.litkb-graphRelRow:hover{background:var(--litkb-fill-1)}',
      '.litkb-graphEdgeType{flex:none;font-size:11px;font-weight:600}',
      '.litkb-graphRelName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--litkb-text-2)}',
      '.litkb-graphEdgeLine{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--litkb-text-2);flex-wrap:wrap}',
      '.litkb-graphArrow{color:var(--litkb-text-3)}',
      '.litkb-graphQuote{padding:8px 10px;border-left:3px solid rgba(79,142,247,.5);background:rgba(79,142,247,.06);border-radius:0 6px 6px 0;font-size:11.5px;line-height:1.75;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-graphEmpty{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;border:1px dashed var(--litkb-border-strong);border-radius:10px;max-width:640px}',
      '.litkb-graphSummary{font-size:11px}',
      '.litkb-compare{display:flex;flex-direction:column;gap:10px}',
      '.litkb-comparePick{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-compareTable{display:flex;flex-direction:column;border:1px solid var(--litkb-border);border-radius:10px;overflow:hidden}',
      '.litkb-compareRow{display:grid;grid-template-columns:minmax(0,1fr) 90px 64px 60px;gap:10px;align-items:center;padding:8px 12px;border-top:1px solid var(--litkb-border);font-size:12px}',
      '.litkb-compareRow.is-head{border-top:0;background:var(--litkb-fill-1);font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-compareTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-compareValue{font-weight:600;color:var(--litkb-success)}',
      '.litkb-queueWrap{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.4)}',
      '.litkb-queueCard{display:flex;flex-direction:column;width:min(720px,94vw);max-height:80vh;border-radius:12px;border:1px solid var(--litkb-border);background:var(--litkb-bg);box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}',
      '.litkb-queueBody{display:flex;flex-direction:column;gap:8px;padding:12px 16px;overflow:auto}',
      '.litkb-queueRow{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--litkb-border);border-radius:8px}',
      '.litkb-queueName{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}',
      '.litkb-queueActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-queueSelect{width:auto;min-width:150px;padding:4px 8px;font-size:11.5px}',
      '.litkb-pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--litkb-accent);margin-right:8px;animation:litkb-pulse 1.2s ease-in-out infinite}',
      '@keyframes litkb-pulse{0%,100%{opacity:.3}50%{opacity:1}}',
      '.litkb-badge.is-ok{border-color:color-mix(in srgb,var(--litkb-success) 35%,transparent);color:var(--litkb-success);background:color-mix(in srgb,var(--litkb-success) 8%,transparent)}',
      '.litkb-badge.is-warn{border-color:color-mix(in srgb,var(--litkb-warn) 35%,transparent);color:var(--litkb-warn);background:color-mix(in srgb,var(--litkb-warn) 8%,transparent)}',
      '.litkb-badge.is-danger{border-color:color-mix(in srgb,var(--litkb-danger) 35%,transparent);color:var(--litkb-danger);background:color-mix(in srgb,var(--litkb-danger) 8%,transparent)}',
      '.litkb-badge.is-muted{border-color:var(--litkb-border);color:var(--litkb-text-3);background:transparent}',
      '.litkb-themePage{flex:1;min-height:0;width:100%;max-width:1180px;margin:0 auto;padding:18px 24px 28px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      '.litkb-themeHero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.litkb-themeTitle{font-size:20px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeSub{font-size:12px;color:var(--litkb-text-3);margin-top:2px}',
      '.litkb-themeKpis{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-themeNotice{font-size:11.5px;color:var(--litkb-accent-text);background:var(--litkb-fill-1);border:1px solid var(--litkb-border);border-radius:8px;padding:6px 10px}',
      '.litkb-themeTable{display:flex;flex-direction:column;border:1px solid var(--litkb-border);border-radius:10px;overflow:hidden;background:var(--litkb-fill-1)}',
      '.litkb-themeRow{display:grid;grid-template-columns:minmax(0,1fr) 54px 62px 54px 52px 82px 88px;gap:10px;align-items:center;width:100%;padding:9px 12px;border:0;border-top:1px solid var(--litkb-border);background:transparent;color:var(--litkb-text-2);font:inherit;font-size:12px;text-align:left}',
      'button.litkb-themeRow{cursor:pointer}',
      'button.litkb-themeRow:hover{background:var(--litkb-fill-2);color:var(--litkb-text)}',
      '.litkb-themeRow.is-head{border-top:0;font-size:11px;color:var(--litkb-text-3);background:var(--litkb-fill-1)}',
      '.litkb-themeRow.is-papers{grid-template-columns:minmax(0,1.4fr) 52px 58px minmax(0,1fr) 44px 36px 96px}',
      '.litkb-themeRowTitle{display:flex;flex-direction:column;gap:2px;min-width:0;color:var(--litkb-text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-themeRowTitle.is-link{border:0;background:transparent;padding:0;font:inherit;font-weight:600;color:var(--litkb-text);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-themeRowTitle.is-link:hover{color:var(--litkb-accent-text)}',
      '.litkb-themeRowTags{font-style:normal;font-weight:400;font-size:11px;color:var(--litkb-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-themeRowTime{color:var(--litkb-text-3);font-size:11px}',
      '.litkb-themeRowFacets{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--litkb-text-2)}',
      '.litkb-themeRowOps{display:flex;justify-content:flex-end}',
      '.litkb-themeRow .is-ok{color:var(--litkb-success)}',
      '.litkb-themeRow .is-warn{color:var(--litkb-warn)}',
      '.litkb-themeRow .is-danger{color:var(--litkb-danger)}',
      '.litkb-themeEmpty{display:flex;flex-direction:column;gap:8px;align-items:flex-start;padding:28px 20px;border:1px dashed var(--litkb-border-strong);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-themeEmptyTitle{font-size:14px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeEmptyText{font-size:12px;color:var(--litkb-text-3);max-width:520px;line-height:1.7}',
      '.litkb-themeDetailHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:4px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-themeDetailTitle{font-size:16px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeStats{font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-themeSeg{display:flex;gap:4px;align-items:center;flex-wrap:wrap}',
      '.litkb-themeSegBtn{padding:5px 12px;border:1px solid var(--litkb-border);border-radius:999px;background:var(--litkb-bg);color:var(--litkb-text-2);font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-themeSegBtn.is-on{border-color:var(--litkb-accent);background:var(--litkb-fill-1);color:var(--litkb-accent-text)}',
      '.litkb-themePane{display:flex;flex-direction:column;gap:10px}',
      '.litkb-themeActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-themeHint{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-facetCard{display:flex;flex-direction:column;gap:7px;padding:12px 14px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1)}',
      '.litkb-facetHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-facetTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-facetMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-facetDesc{font-size:12px;color:var(--litkb-text-2);line-height:1.6}',
      '.litkb-facetPreview{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px dashed var(--litkb-border-strong);border-radius:8px;background:var(--litkb-bg)}',
      '.litkb-facetHit{display:flex;align-items:flex-start;gap:8px;justify-content:space-between;width:100%;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-facetHit:hover{background:var(--litkb-fill-1)}',
      '.litkb-facetHitQuote{font-size:11.5px;line-height:1.55;color:var(--litkb-text-2)}',
      '.litkb-facetHitMeta{font-size:11px;color:var(--litkb-text-3);white-space:nowrap}',
      '.litkb-facetGap{font-size:11.5px;color:var(--litkb-warn)}',
      '.litkb-facetActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-themeBlock{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1)}',
      '.litkb-themeBlockHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-themeBlockTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeSummary{font-size:12px;line-height:1.8;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-themeGaps{display:flex;flex-direction:column;gap:4px;padding:10px 14px;border:1px dashed color-mix(in srgb,var(--litkb-warn) 40%,transparent);border-radius:10px;background:color-mix(in srgb,var(--litkb-warn) 5%,transparent)}',
      '.litkb-themeGapsTitle{font-size:11.5px;font-weight:600;color:var(--litkb-warn)}',
      '.litkb-themeGapItem{font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-themeAddPaper{width:auto;min-width:200px;height:28px;font-size:11px}',
      '.litkb-themeDraftRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-themeDraftTitle{font-size:12.5px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeOutline{margin:0;padding:10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.7;color:var(--litkb-text-2);white-space:pre-wrap;max-height:320px;overflow:auto}',
      '.litkb-themeModalWrap{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.45)}',
      '.litkb-themeModal{display:flex;flex-direction:column;width:min(680px,94vw);max-height:86vh;border-radius:12px;border:1px solid var(--litkb-border);background:var(--litkb-bg);box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}',
      '.litkb-themeModal.is-small{width:min(420px,90vw)}',
      '.litkb-themeModalHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-themeModalTitle{font-size:14px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeModalBody{display:flex;flex-direction:column;gap:10px;padding:14px 16px;overflow:auto}',
      '.litkb-themeModalFoot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--litkb-border)}',
      '.litkb-themeField{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-themeFacetEdit{display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid var(--litkb-border)}',
      '.litkb-themeFacetEditHead{display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-themeFacetRow{display:grid;grid-template-columns:1.2fr 1.6fr 1fr auto;gap:6px;align-items:center}',
      '.litkb-themeReviewRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--litkb-border)}',
      '.litkb-themeReviewClaim{flex:1;min-width:200px;font-size:12px;color:var(--litkb-text)}',
      '.litkb-themeReviewOps{display:flex;gap:6px}',
      '.litkb-matrix{display:flex;flex-direction:column;overflow:auto;border:1px solid var(--litkb-border);border-radius:8px}',
      '.litkb-matrixRow{display:flex;align-items:center;min-height:28px;border-top:1px solid var(--litkb-border)}',
      '.litkb-matrixRow.is-head{border-top:0;background:var(--litkb-fill-1)}',
      '.litkb-matrixFacet{flex:0 0 150px;padding:4px 8px;font-size:11px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-matrixPaper{flex:0 0 56px;padding:4px;font-size:11px;color:var(--litkb-text-3);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-matrixCell{flex:0 0 56px;padding:4px;text-align:center;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-matrixCell.is-hit{color:var(--litkb-success);font-weight:600}',
      '.litkb-themeWorkbench{flex:1;min-height:0;display:flex;width:100%;overflow:hidden}',
      '.litkb-themeSide{width:250px;flex:0 0 250px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--litkb-border);background:var(--litkb-fill-1)}',
      '.litkb-themeSideHead{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--litkb-border)}',
      '.litkb-themeSideTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeSideList{flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:6px}',
      '.litkb-themeSideItem{display:flex;flex-direction:column;gap:3px;width:100%;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--litkb-text-2);font:inherit;text-align:left;cursor:pointer}',
      '.litkb-themeSideItem:hover{background:var(--litkb-fill-2)}',
      '.litkb-themeSideItem.is-on{background:var(--litkb-fill-2);border-color:var(--litkb-border-strong)}',
      '.litkb-themeSideName{font-size:12.5px;font-weight:600;color:var(--litkb-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-themeSideMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-themeSideState{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-themeSideEmpty{padding:14px 8px;font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-themeSideFoot{padding:8px 12px;border-top:1px solid var(--litkb-border);font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-themeMain{flex:1;min-width:0;overflow:auto;padding:18px 24px 28px;display:flex;flex-direction:column;gap:14px}',
      '.litkb-themeSection{display:flex;flex-direction:column;gap:10px;padding-top:8px;border-top:1px solid var(--litkb-border)}',
      '.litkb-themeSectionHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-themeSectionTitle{font-size:15px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-themeDetailTitleRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-themeSteps{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-themeStep{padding:4px 9px;border:1px solid var(--litkb-border);border-radius:999px;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-themeEmpty.is-inline{padding:16px;border-style:dashed;background:transparent}',
      '.litkb-matchRow{display:flex;flex-direction:column;gap:4px;padding:7px 0;border-top:1px solid var(--litkb-border)}',
      '.litkb-matchHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-matchFacet{font-size:12px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-writingFilterRow{padding:0 12px 8px}',
      '.litkb-writingFilter{width:100%;height:28px;font-size:11px}',
      '.litkb-draftMeta.is-research{color:var(--litkb-accent-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-subtabs{display:flex;align-items:center;gap:4px;margin-left:8px}',
      '.litkb-subtab{padding:3px 9px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--litkb-text-3);font:inherit;font-size:11.5px;cursor:pointer}',
      '.litkb-subtab:hover{background:var(--litkb-fill-1);color:var(--litkb-text-2)}',
      '.litkb-subtab.is-on{background:var(--litkb-fill-2);color:var(--litkb-text);border-color:var(--litkb-border)}',
      '.litkb-writingBack{padding:8px 10px 0}',
      '.litkb-themeSideMore{margin-top:auto;padding:6px;border-top:1px solid var(--litkb-border)}',
      '.litkb-wbPage{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:hidden;padding:18px 24px}',
      '.litkb-wbPage.is-detail{padding:12px 16px}',
      '.litkb-wbHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.litkb-wbTitle{font-size:20px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-wbSub{font-size:12px;color:var(--litkb-text-3);margin-top:2px}',
      '.litkb-themeCards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;overflow:auto;padding-bottom:8px}',
      '.litkb-themeCard{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-themeCard:hover{border-color:var(--litkb-border-strong);background:var(--litkb-fill-2)}',
      '.litkb-themeCardTitle{font-size:14px;font-weight:600;line-height:1.4;color:var(--litkb-text)}',
      '.litkb-themeCardStats{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-themeCardBar{display:block;height:5px;border-radius:999px;background:var(--litkb-fill-2);overflow:hidden}',
      '.litkb-themeCardBarFill{display:block;height:100%;border-radius:999px;background:var(--litkb-accent)}',
      '.litkb-themeCardFoot{display:flex;justify-content:space-between;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbDetailHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-wbDetailTitle{font-size:16px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-wbSplit{flex:1;min-height:0;display:grid;grid-template-columns:280px minmax(240px,1fr) minmax(320px,1.1fr);gap:10px;overflow:hidden}',
      '.litkb-wbPane{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding:12px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-wbPaneHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-wbPaneTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-wbDesc{font-size:11.5px;line-height:1.6;color:var(--litkb-text-2)}',
      '.litkb-wbActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-wbGroupTitle{font-size:11px;font-weight:600;color:var(--litkb-text-3);margin-top:4px}',
      '.litkb-wbFacets{display:flex;flex-direction:column;gap:4px}',
      '.litkb-wbFacet{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-wbFacet:hover{background:var(--litkb-fill-2)}',
      '.litkb-wbFacet.is-on{border-color:var(--litkb-border-strong);background:var(--litkb-fill-2)}',
      '.litkb-wbFacetTop{display:flex;align-items:center;justify-content:space-between;gap:6px}',
      '.litkb-wbFacetTitle{font-size:12px;font-weight:600;color:var(--litkb-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-wbFacetMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbPapers{display:flex;flex-direction:column;gap:3px}',
      '.litkb-wbPaper{display:flex;flex-direction:column;gap:2px;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-wbPaper:hover{background:var(--litkb-fill-1)}',
      '.litkb-wbPaperTitle{font-size:11.5px;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-wbPaperMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbSummary{font-size:11.5px;line-height:1.7;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-wbSummaryEdit{display:flex;flex-direction:column;gap:6px}',
      '.litkb-wbChainGroup{display:flex;flex-direction:column;gap:4px}',
      '.litkb-wbChainGroupHead{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 2px}',
      '.litkb-wbChainGroupTitle{font-size:11.5px;font-weight:600;color:var(--litkb-text-2)}',
      '.litkb-wbChain{display:flex;flex-direction:column;gap:3px;padding:8px 9px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-wbChain:hover{border-color:var(--litkb-border-strong)}',
      '.litkb-wbChain.is-on{border-color:var(--litkb-accent);background:var(--litkb-fill-1)}',
      '.litkb-wbChainClaim{font-size:12px;line-height:1.6;color:var(--litkb-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-wbChainMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbEmpty{display:flex;flex-direction:column;gap:6px;padding:18px;border:1px dashed var(--litkb-border-strong);border-radius:10px;font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-wbEmpty.is-inline{padding:10px;font-size:11px}',
      '.litkb-wbDetail{display:flex;flex-direction:column;gap:8px}',
      '.litkb-wbClaim{font-size:13px;font-weight:600;line-height:1.6;color:var(--litkb-text)}',
      '.litkb-wbDetailMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbWarn{font-size:11px;line-height:1.6;color:var(--litkb-warn);padding:6px 8px;border:1px solid color-mix(in srgb,var(--litkb-warn) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--litkb-warn) 6%,transparent)}',
      '.litkb-wbNodes{display:flex;flex-direction:column;gap:6px}',
      '.litkb-wbNode{display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-wbNode:hover{border-color:var(--litkb-border-strong)}',
      '.litkb-wbNodeTop{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.litkb-wbNodeTitle{font-size:11px;font-weight:600;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-wbNodePage{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-wbNodeQuote{font-size:11px;line-height:1.6;color:var(--litkb-text-2)}',
      '@media (max-width:1100px){.litkb-wbSplit{grid-template-columns:240px minmax(220px,1fr);overflow:auto}.litkb-wbRight{grid-column:1/-1;max-height:340px}}',
      '.litkb-wbPaperRow{display:flex;align-items:center;gap:2px}',
      '.litkb-wbPaperRow .litkb-wbPaper{flex:1;min-width:0}',
      '.litkb-wbPaperDel{flex:0 0 auto;border:0;background:transparent;color:var(--litkb-text-3);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px}',
      '.litkb-wbPaperDel:hover{color:var(--litkb-danger)}',
      '.litkb-wbAddPaper{width:100%;height:26px;font-size:11px;margin-top:2px}',
      '.litkb-explore{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px;width:100%;max-width:1100px}',
      '.litkb-exSection{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-exHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-exTitle{font-size:14px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-exHint{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-exAdd{width:auto;min-width:180px;height:26px;font-size:11px}',
      '.litkb-exTable{display:flex;flex-direction:column;border:1px solid var(--litkb-border);border-radius:8px;overflow:hidden}',
      '.litkb-exRow{display:grid;grid-template-columns:minmax(0,1.6fr) 44px 56px minmax(0,1fr) 40px 170px;gap:8px;align-items:center;padding:7px 10px;border-top:1px solid var(--litkb-border);font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-exRow.is-head{border-top:0;background:var(--litkb-fill-1);font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-exPaper{border:0;background:transparent;padding:0;font:inherit;font-weight:600;color:var(--litkb-text);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-exPaper:hover{color:var(--litkb-accent-text)}',
      '.litkb-exFacets{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-exOps{display:flex;gap:4px;justify-content:flex-end}',
      '.litkb-exEmpty{padding:14px;border:1px dashed var(--litkb-border-strong);border-radius:8px;font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-exGroup{display:flex;flex-direction:column;gap:5px;padding-top:6px;border-top:1px solid var(--litkb-border)}',
      '.litkb-exGroup:first-of-type{border-top:0;padding-top:0}',
      '.litkb-exGroupHead{display:flex;align-items:center;gap:8px}',
      '.litkb-exGroupTitle{font-size:12px;font-weight:600;color:var(--litkb-text-2)}',
      '.litkb-exChain{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-exChain:hover{border-color:var(--litkb-border-strong)}',
      '.litkb-exChainClaim{font-size:12px;line-height:1.6;color:var(--litkb-text)}',
      '.litkb-exChainMeta{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-exGap{padding:8px 10px;border:1px dashed color-mix(in srgb,var(--litkb-warn) 40%,transparent);border-radius:8px;font-size:11px;color:var(--litkb-warn)}',
      '.litkb-exProgress{padding:6px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-fill-1);font-size:11.5px;color:var(--litkb-accent-text)}',
      '.litkb-exNodes{display:flex;flex-direction:column;gap:8px}',
      '.litkb-exNode{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg)}',
      '.litkb-exNodeTop{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.litkb-exNodeTitle{font-size:11.5px;font-weight:600;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-exNodePage{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-exNodeQuote{font-size:11.5px;line-height:1.65;color:var(--litkb-text-2)}',
      '.litkb-exNodeOps{display:flex;gap:6px}',
      '.litkb-wbPage .litkb-drawerWrap{z-index:60}',
      '.litkb-module{display:flex;flex:1;min-height:0;min-width:0;width:100%}',
      '.litkb-module.is-hidden{display:none}',
      '.litkb-wbOverview{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-wbOverviewMain{display:flex;flex-direction:column;gap:6px}',
      '.litkb-wbOverviewStats{font-size:11.5px;color:var(--litkb-text-3)}',
      '.litkb-wbOverviewFacets{display:flex;gap:6px;flex-wrap:wrap}',
      '.litkb-wbOverviewFacets .litkb-chip.is-off{opacity:.5;text-decoration:line-through}',
      '.litkb-wbSeg{display:flex;gap:4px;flex-wrap:wrap}',
      '.litkb-wbSegBtn{padding:5px 12px;border:1px solid var(--litkb-border);border-radius:999px;background:var(--litkb-bg);color:var(--litkb-text-2);font:inherit;font-size:12px;cursor:pointer}',
      '.litkb-wbSegBtn.is-on{border-color:var(--litkb-accent);background:var(--litkb-fill-1);color:var(--litkb-accent-text)}',
      '.litkb-wbBody{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.litkb-rp{flex:1;min-height:0;display:grid;grid-template-columns:280px minmax(0,1fr);gap:10px}',
      '.litkb-rpList{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto;padding:10px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-rpHead{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}',
      '.litkb-rpHeadTitle{font-size:12px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-rpItems{display:flex;flex-direction:column;gap:3px}',
      '.litkb-rpItem{display:flex;align-items:center;gap:2px;border:1px solid transparent;border-radius:8px}',
      '.litkb-rpItem.is-on{border-color:var(--litkb-border-strong);background:var(--litkb-fill-2)}',
      '.litkb-rpMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:7px 8px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.litkb-rpTitle{font-size:12px;font-weight:600;color:var(--litkb-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-rpMeta{font-size:11px;color:var(--litkb-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-rpDel{border:0;background:transparent;color:var(--litkb-text-3);font:inherit;font-size:12px;cursor:pointer;padding:2px 5px}',
      '.litkb-rpDel:hover{color:var(--litkb-danger)}',
      '.litkb-rpAdd{width:auto;min-width:150px;height:32px;font-size:12px;margin-top:0}',
      '.litkb-rpDetail{display:flex;flex-direction:column;min-height:0;overflow:auto;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-rpDetail .litkb-detailInline{border:0;background:transparent}',
      '.litkb-cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(260px,38%) minmax(0,1fr);gap:10px}',
      '.litkb-col{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding:12px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-fill-1)}',
      '.litkb-colHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.litkb-colTitle{font-size:13px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-cd{display:flex;flex-direction:column;gap:8px}',
      '.litkb-cdTop{display:flex;align-items:center;gap:8px}',
      '.litkb-cdFacet{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-cdSummary{font-size:12.5px;line-height:1.8;color:var(--litkb-text-2);white-space:pre-wrap}',
      '.litkb-cdChain{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg)}',
      '.litkb-cdChainTop{display:flex;align-items:center;gap:6px}',
      '.litkb-cdChainClaim{font-size:12px;line-height:1.65;color:var(--litkb-text)}',
      '.litkb-themeCardTop{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}',
      '.litkb-themeCardTop .litkb-themeCardTitle{flex:1;min-width:0}',
      '.litkb-wbOverviewHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-wbOverviewTitle{font-size:12px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-wbBar{height:4px;border-radius:999px;background:var(--litkb-fill-2);overflow:hidden}',
      '.litkb-wbBarFill{display:block;height:100%;border-radius:999px;background:var(--litkb-accent)}',
      '.litkb-chip.is-ok{border-color:color-mix(in srgb,var(--litkb-success) 40%,transparent);color:var(--litkb-success);background:color-mix(in srgb,var(--litkb-success) 7%,transparent)}',
      '.litkb-chip.is-warn{border-color:color-mix(in srgb,var(--litkb-warn) 40%,transparent);color:var(--litkb-warn);background:color-mix(in srgb,var(--litkb-warn) 7%,transparent)}',
      '.litkb-chip.is-muted{color:var(--litkb-text-3)}',
      '.litkb-wbOverviewFacets .litkb-chip{cursor:pointer;font:inherit;font-size:11px}',
      '.litkb-rpSearch{height:26px;font-size:11px}',
      '.litkb-miniBtn.is-on{border-color:var(--litkb-accent);color:var(--litkb-accent-text);background:var(--litkb-fill-1)}',
      '@media (max-width:1100px){.litkb-rp{grid-template-columns:240px minmax(0,1fr)}.litkb-cols{grid-template-columns:1fr;grid-auto-rows:minmax(220px,1fr);overflow:auto}}',
      '@media (max-width:820px){.litkb-rp{grid-template-columns:1fr;grid-template-rows:200px minmax(0,1fr)}}',
      '.litkb-wbDetailTitle{flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-wbDetailHead{min-width:0}',
      '.litkb-wbDetailHead>*{min-width:0}',
      '.litkb-themeCardTitle{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}',
      '.litkb-themeCard{transition:transform .12s ease,border-color .12s ease,background-color .12s ease}',
      '.litkb-themeCard:hover{transform:translateY(-1px)}',
      '.litkb-exChain{transition:border-color .12s ease,background-color .12s ease}',
      '.litkb-exChain.is-draft{border-left:3px solid var(--litkb-warn)}',
      '.litkb-exChain.is-confirmed{border-left:3px solid var(--litkb-success)}',
      '.litkb-exChainClaim{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-cdChainClaim{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.litkb-exRow>*{min-width:0}',
      '.litkb-exGroup{min-width:0}',
      '.litkb-rpItem{min-width:0}',
      '.litkb-col>*{min-width:0}',
      '.litkb-chip{max-width:220px}',
      '.litkb-themeNotice{white-space:pre-wrap;line-height:1.7}',
      '.litkb-drawerHead{min-width:0}',
      '.litkb-drawerHead .litkb-blockTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-wbSegBtn.is-on{background:var(--litkb-accent);border-color:var(--litkb-accent);color:#fff;font-weight:600}',
      '.litkb-miniBtn.is-on{border-color:var(--litkb-accent);color:var(--litkb-accent-text);background:var(--litkb-fill-1);font-weight:600}',
      '.litkb-rpItem.is-on .litkb-rpMain{box-shadow:inset 3px 0 0 var(--litkb-accent)}',
      '.litkb-wbOverview{background:linear-gradient(180deg,var(--litkb-fill-1),transparent)}',
      '@media (max-width:720px){.litkb-themeFacetRow{grid-template-columns:1fr 1fr}}',
      /* ---- v0.3.0 视觉重设计：柔和浅底 + 青色主色 + 左侧导航 ---- */
      '.litkb-theme-light{--litkb-bg:#f6f7fc;--litkb-surface:#ffffff;--litkb-surface-2:#eef2f8;--litkb-overlay:#ffffff;--litkb-border:#e9eef6;--litkb-border-strong:#d7e0ec;--litkb-text:#1f2a37;--litkb-text-2:#5b6b7e;--litkb-text-3:#8b97a6;--litkb-accent:#14808f;--litkb-accent-text:#0f6b77;--litkb-violet:#7a6cf0;--litkb-success:#1f9d6b;--litkb-warn:#c97716;--litkb-danger:#dd5a5a;--litkb-fill-1:#f7f9fc;--litkb-fill-2:#eaf0f7;--litkb-shadow-1:0 1px 2px rgba(31,42,55,.04);--litkb-shadow-2:0 14px 34px rgba(31,42,55,.08)}',
      '.litkb-theme-dark{--litkb-bg:#0e1520;--litkb-surface:#141e2b;--litkb-surface-2:#1a2737;--litkb-overlay:#141e2b;--litkb-border:#223143;--litkb-border-strong:#2f4258;--litkb-text:#e8eef6;--litkb-text-2:#a9b8c9;--litkb-text-3:#7d8ea3;--litkb-accent:#35b6c9;--litkb-accent-text:#6fd7e6;--litkb-violet:#9a8cf7;--litkb-success:#3ecf8e;--litkb-warn:#e0a03a;--litkb-danger:#ef7272;--litkb-fill-1:#16212f;--litkb-fill-2:#1d2b3c;--litkb-shadow-1:0 1px 2px rgba(0,0,0,.25);--litkb-shadow-2:0 14px 34px rgba(0,0,0,.35)}',
      '.litkb-shell{display:flex;flex:1;min-width:0;min-height:0}',
      '.litkb-shellMain{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}',
      '.litkb-nav{width:196px;flex:0 0 196px;display:flex;flex-direction:column;gap:16px;padding:18px 12px;border-right:1px solid var(--litkb-border);background:var(--litkb-surface)}',
      '.litkb-brand{display:flex;align-items:center;gap:10px;padding:2px 8px 4px}',
      '.litkb-brandMark{width:36px;height:36px;flex:0 0 36px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1aa7b8,#0f7c8c);color:#fff;font-size:15px;font-weight:700;box-shadow:0 8px 18px rgba(20,128,143,.28)}',
      '.litkb-brandText{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.litkb-brandName{font-size:14px;font-weight:700;color:var(--litkb-text);letter-spacing:.2px;white-space:nowrap}',
      '.litkb-brandSub{font-size:11px;color:var(--litkb-text-3);white-space:nowrap}',
      '.litkb-navList{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}',
      '.litkb-navItem{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;border-radius:12px;background:transparent;color:var(--litkb-text-2);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}',
      '.litkb-navItem:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-navItem.is-on{background:var(--litkb-accent);color:#fff;box-shadow:0 10px 22px rgba(20,128,143,.26)}',
      '.litkb-navIcon{display:flex;align-items:center;justify-content:center;width:20px;flex:0 0 20px}',
      '.litkb-navLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-navFoot{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:12px;background:var(--litkb-fill-1);font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-navStat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '@media (max-width:980px){.litkb-nav{width:64px;flex:0 0 64px;padding:16px 8px;gap:10px}.litkb-brandText,.litkb-navLabel,.litkb-navFoot{display:none}.litkb-brand{justify-content:center;padding:0}.litkb-navItem{justify-content:center;padding:11px 0}.litkb-navItem.is-on{box-shadow:none}}',
      '.litkb-head{background:var(--litkb-surface);border-bottom:1px solid var(--litkb-border);box-shadow:none}',
      '.litkb-headTop{padding:16px 24px 10px}',
      '.litkb-headBottom{padding:0 24px 12px}',
      '.litkb-pageTitle{display:flex;align-items:center;gap:8px;min-width:0}',
      '.litkb-body{background:var(--litkb-bg)}',
      '.litkb-foot{background:var(--litkb-surface);border-top:1px solid var(--litkb-border)}',
      '.litkb-subtabs{display:inline-flex;align-items:center;gap:2px;margin-left:0;padding:3px;border-radius:999px;background:var(--litkb-fill-1)}',
      '.litkb-subtab{border:0;border-radius:999px;padding:5px 12px;font-size:12px}',
      '.litkb-subtab.is-on{background:var(--litkb-surface);color:var(--litkb-accent);border-color:transparent;box-shadow:0 2px 6px rgba(31,42,55,.08)}',
      '.litkb-kpi{border-radius:999px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-1)}',
      '.litkb-btn{border:0;border-radius:999px;background:var(--litkb-accent);box-shadow:0 8px 18px rgba(20,128,143,.22);padding:8px 16px;font-weight:600}',
      '.litkb-btn:hover{filter:brightness(1.06)}',
      '.litkb-miniBtn{border-radius:999px;background:var(--litkb-surface);border-color:var(--litkb-border)}',
      '.litkb-miniBtn:hover{border-color:var(--litkb-border-strong);color:var(--litkb-text)}',
      '.litkb-themeCards{grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}',
      '.litkb-themeCard{border:1px solid transparent;border-radius:18px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-2);padding:18px}',
      '.litkb-themeCard:hover{border-color:var(--litkb-border-strong);background:var(--litkb-surface);transform:translateY(-2px)}',
      '.litkb-themeCardStats{font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-themeCardBar{height:6px;background:var(--litkb-fill-2)}',
      '.litkb-wbOverview{flex-direction:row;align-items:center;gap:18px;padding:18px 20px;border:1px solid transparent;border-radius:20px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-2)}',
      '.litkb-wbOverviewMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}',
      '.litkb-wbOverviewHead{gap:10px}',
      '.litkb-wbOverviewStats{font-size:12px;color:var(--litkb-text-2)}',
      '.litkb-wbDonut{position:relative;flex:0 0 74px;width:74px;display:flex;flex-direction:column;align-items:center;gap:2px}',
      '.litkb-wbDonutText{position:absolute;top:23px;font-size:13px;font-weight:700;color:var(--litkb-text)}',
      '.litkb-wbDonutLabel{font-size:11px;color:var(--litkb-text-3);margin-top:-6px}',
      '.litkb-wbSeg{display:inline-flex;gap:2px;padding:4px;border-radius:999px;background:var(--litkb-fill-1);width:fit-content}',
      '.litkb-wbSegBtn{border:0;background:transparent;border-radius:999px;padding:7px 16px;font-size:12px;color:var(--litkb-text-2)}',
      '.litkb-wbSegBtn.is-on{background:var(--litkb-surface);color:var(--litkb-accent);border-color:transparent;box-shadow:0 2px 8px rgba(31,42,55,.08);font-weight:600}',
      '.litkb-exSection,.litkb-col,.litkb-rpList,.litkb-rpDetail,.litkb-wbPane{border:1px solid transparent;border-radius:18px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-2)}',
      '.litkb-exSection{padding:18px 20px}',
      '.litkb-col,.litkb-rpList,.litkb-rpDetail{padding:16px}',
      '.litkb-exChain,.litkb-cdChain{background:var(--litkb-fill-1);border-color:transparent;border-radius:14px;padding:10px 12px}',
      '.litkb-exChain:hover{background:var(--litkb-fill-2);border-color:transparent}',
      '.litkb-exChain.is-on{border-color:var(--litkb-accent);background:color-mix(in srgb,var(--litkb-accent) 7%,var(--litkb-surface))}',
      '.litkb-rpItem{border-radius:12px}',
      '.litkb-rpItem.is-on{background:color-mix(in srgb,var(--litkb-accent) 9%,transparent);border-color:transparent}',
      '.litkb-rpMain{padding:8px 10px}',
      '.litkb-rpSearch,.litkb-exAdd,.litkb-themeAddPaper{border-radius:999px;background:var(--litkb-fill-1);border-color:transparent;padding:0 12px}',
      '.litkb-themeModal{border-radius:20px;border-color:var(--litkb-border);box-shadow:0 30px 80px rgba(31,42,55,.22)}',
      '.litkb-drawer{border-left:1px solid var(--litkb-border);box-shadow:-20px 0 60px rgba(31,42,55,.14);background:var(--litkb-surface)}',
      '.litkb-exEmpty,.litkb-wbEmpty{border:1px dashed var(--litkb-border-strong);border-radius:14px;background:var(--litkb-fill-1)}',
      '.litkb-themeNotice{border:1px solid color-mix(in srgb,var(--litkb-accent) 24%,transparent);background:color-mix(in srgb,var(--litkb-accent) 7%,transparent);color:var(--litkb-accent-text);border-radius:12px;padding:8px 12px}',
      '.litkb-theme-dark .litkb-navItem.is-on,.litkb-theme-dark .litkb-btn{color:#06222a}',
      '.litkb-theme-dark .litkb-navItem.is-on svg{stroke:#06222a}',
      '.litkb-theme-light .litkb-wbOverview{box-shadow:0 10px 30px rgba(31,42,55,.06)}',
      '.litkb-themeCard.is-new{display:flex;align-items:center;justify-content:center;gap:8px;min-height:150px;border:1.5px dashed var(--litkb-border-strong);background:transparent;box-shadow:none;color:var(--litkb-text-3)}',
      '.litkb-themeCard.is-new:hover{border-color:var(--litkb-accent);color:var(--litkb-accent);background:color-mix(in srgb,var(--litkb-accent) 4%,transparent);transform:none}',
      '.litkb-themeCardPlus{font-size:22px;line-height:1}',
      '.litkb-themeCardNewText{font-size:12.5px;font-weight:600}',
      '.litkb-wbPage{max-width:1240px;padding:24px 32px 32px;gap:16px}',
      '.litkb-wbPage.is-detail{padding:18px 32px 28px}',
      '.litkb-pageTitle .litkb-brandMark{width:30px;height:30px;flex:0 0 30px;border-radius:10px;font-size:13px}',
      '.litkb-window .litkb-btn{color:#fff}',
      '.litkb-window .litkb-btn.litkb-btnGhost{background:var(--litkb-surface);color:var(--litkb-text-2);border:1px solid var(--litkb-border);box-shadow:none}',
      '.litkb-theme-dark .litkb-btn.litkb-btnGhost{color:var(--litkb-text-2)}',
      '.litkb-statRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
      '.litkb-statCard{display:flex;align-items:center;gap:14px;padding:16px 18px;border:1px solid transparent;border-radius:18px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-2);font:inherit;color:inherit;text-align:left;cursor:default}',
      'button.litkb-statCard{cursor:pointer}',
      'button.litkb-statCard:hover{transform:translateY(-1px);border-color:var(--litkb-border-strong)}',
      '.litkb-statIcon{width:44px;height:44px;flex:0 0 44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:18px;background:color-mix(in srgb,var(--litkb-violet) 13%,transparent);color:var(--litkb-violet)}',
      '.litkb-statCard.is-green .litkb-statIcon{background:color-mix(in srgb,var(--litkb-success) 13%,transparent);color:var(--litkb-success)}',
      '.litkb-statCard.is-blue .litkb-statIcon{background:color-mix(in srgb,var(--litkb-accent) 13%,transparent);color:var(--litkb-accent)}',
      '.litkb-statMain{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.litkb-statValue{font-size:24px;font-weight:700;line-height:1.05;color:var(--litkb-text)}',
      '.litkb-statLabel{font-size:12px;color:var(--litkb-text-2)}',
      '.litkb-statHint{margin-left:auto;font-size:11px;color:var(--litkb-text-3);white-space:nowrap}',
      '.litkb-viewCards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
      '.litkb-viewCard{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid transparent;border-radius:16px;background:var(--litkb-surface);box-shadow:var(--litkb-shadow-2);font:inherit;color:inherit;text-align:left;cursor:pointer}',
      '.litkb-viewCard:hover{transform:translateY(-1px);border-color:var(--litkb-border-strong)}',
      '.litkb-viewCard.is-on{border-color:var(--litkb-accent);background:color-mix(in srgb,var(--litkb-accent) 7%,var(--litkb-surface));box-shadow:0 10px 24px rgba(20,128,143,.18)}',
      '.litkb-viewIcon{width:38px;height:38px;flex:0 0 38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--litkb-fill-1);color:var(--litkb-accent);font-size:16px}',
      '.litkb-viewMain{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.litkb-viewValue{font-size:20px;font-weight:700;line-height:1.05;color:var(--litkb-text)}',
      '.litkb-viewLabel{font-size:12.5px;font-weight:600;color:var(--litkb-text-2)}',
      '.litkb-viewHint{margin-left:auto;font-size:11px;color:var(--litkb-text-3);white-space:nowrap}',
      '@media (max-width:900px){.litkb-statRow,.litkb-viewCards{grid-template-columns:1fr}.litkb-wbPage,.litkb-wbPage.is-detail{padding:18px 18px 24px}}',
      '.litkb-btn,.litkb-btnGhost,.litkb-miniBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;font-size:12px;line-height:1;border-radius:999px;white-space:nowrap}',
      '.litkb-btn svg,.litkb-miniBtn svg{width:14px;height:14px}',
      '.litkb-deepHead .litkb-btn,.litkb-deepHead .litkb-miniBtn,.litkb-headTop .litkb-btn,.litkb-headTop .litkb-miniBtn,.litkb-wbDetailHead .litkb-btn,.litkb-wbDetailHead .litkb-miniBtn{height:32px;padding:0 14px;font-size:12.5px}',
      'select.litkb-input{appearance:none;-webkit-appearance:none;-moz-appearance:none;height:32px;padding:0 30px 0 12px;font-size:12px;line-height:30px;border-radius:10px;border:1px solid var(--litkb-border);background-color:var(--litkb-surface);background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%278%27 viewBox=%270 0 12 8%27%3E%3Cpath d=%27M1 1.5 6 6.5l5-5%27 fill=%27none%27 stroke=%27%238b97a6%27 stroke-width=%271.6%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;color:var(--litkb-text);cursor:pointer}',
      'select.litkb-input:focus{border-color:var(--litkb-accent);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--litkb-accent) 14%,transparent)}',
      '.litkb-exAdd.litkb-input,.litkb-themeAddPaper.litkb-input,.litkb-rpAdd.litkb-input,.litkb-writingFilter.litkb-input,.litkb-searchFilter.litkb-input,.litkb-queueSelect.litkb-input,.litkb-chainRel.litkb-input{height:32px;font-size:12px;padding:0 30px 0 12px;line-height:30px}',
      '.litkb-rpSearch{height:32px;font-size:12px}',
      '.litkb-batchBar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border:1px dashed var(--litkb-border);border-radius:10px;background:var(--litkb-fill-1)}',
      '.litkb-batchCount{font-size:11.5px;color:var(--litkb-text-2);margin-right:2px}',
      '.litkb-exChainRow{display:flex;align-items:center;gap:6px}',
      '.litkb-exChainRow .litkb-exChain{flex:1;min-width:0}',
      '.litkb-chainCheck{width:14px;height:14px;flex:0 0 14px;accent-color:var(--litkb-accent);cursor:pointer}',
      '.litkb-stale{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid color-mix(in srgb,var(--litkb-warn) 40%,transparent);border-radius:10px;background:color-mix(in srgb,var(--litkb-warn) 7%,transparent);font-size:11.5px;color:var(--litkb-warn)}',
      '.litkb-stale.is-legacy{border-style:dashed;color:var(--litkb-text-3);background:var(--litkb-fill-1)}',
      '.litkb-matchGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}',
      '.litkb-yearRow{display:flex;align-items:center;gap:6px}',
      '.litkb-yearRow .litkb-input{flex:1;min-width:0;height:32px}',
      '.litkb-themeCheck{display:flex;align-items:center;gap:8px;grid-column:1/-1;font-size:12px;color:var(--litkb-text-2)}',
      '.litkb-themeCheck input{width:15px;height:15px;accent-color:var(--litkb-accent)}',
      '.litkb-matchMergePreview{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;background:var(--litkb-fill-1);font-size:11.5px;color:var(--litkb-text-2)}',
      '.litkb-mdGroup{display:flex;flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--litkb-border)}',
      '.litkb-mdGroup:first-child{border-top:0;padding-top:0}',
      '.litkb-mdHead{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.litkb-mdTitle{font-size:12.5px;font-weight:600;color:var(--litkb-text)}',
      '.litkb-mdHit{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--litkb-border);border-radius:8px;background:var(--litkb-bg)}',
      '.litkb-mdHitTop{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.litkb-mdPaper{font-size:11.5px;font-weight:600;color:var(--litkb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.litkb-mdScore{font-size:12px;font-weight:700;color:var(--litkb-accent)}',
      '.litkb-mdQuote{font-size:11.5px;line-height:1.6;color:var(--litkb-text-2)}',
      '.litkb-mdParts{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-mdTerms{font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-mdTerms.is-expanded{color:var(--litkb-accent-text)}',
      '.litkb-mdOps{display:flex;gap:6px;margin-top:2px}',
      '@media (max-width:720px){.litkb-matchGrid{grid-template-columns:1fr}}',
      '.litkb-rpExcluded{display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px dashed var(--litkb-border-strong)}',
      '.litkb-rpExcludedTitle{font-size:11px;color:var(--litkb-text-3);padding:0 4px}',
      '.litkb-rpItem.is-excluded{opacity:.75}',
      '.litkb-wbPage{position:relative}',
      '.litkb-wbPage .litkb-drawerWrap{background:rgba(15,23,42,.32);backdrop-filter:blur(2px)}',
      '.litkb-wbPage .litkb-drawer.is-wide{width:min(720px,100%);max-width:100%;overflow:hidden}',
      '.litkb-wbPage .litkb-drawerHead{position:relative;z-index:2;flex:0 0 auto;min-height:48px;background:var(--litkb-surface)}',
      '.litkb-wbPage .litkb-drawerBody{min-width:0;overflow-x:hidden}',
      '.litkb-wbPage .litkb-deepLayout{grid-template-columns:minmax(0,1fr);gap:12px}',
      '.litkb-wbPage .litkb-deepNav{position:relative;max-height:none;flex-direction:row;flex-wrap:wrap;overflow:visible;border-bottom:1px solid var(--litkb-border);padding:0 0 6px}',
      '.litkb-wbPage .litkb-deepNavItem{border-left:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;padding:4px 8px}',
      '@media (max-width:900px){.litkb-wbPage .litkb-drawer.is-wide{width:100%}}',
      '.litkb-exportMenu{position:relative;display:inline-block}',
      '.litkb-exportMenu>summary{list-style:none;cursor:pointer}',
      '.litkb-exportMenu>summary::-webkit-details-marker{display:none}',
      '.litkb-exportMenuList{position:absolute;right:0;bottom:calc(100% + 6px);z-index:30;display:flex;flex-direction:column;min-width:150px;padding:6px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-surface);box-shadow:0 14px 34px rgba(31,42,55,.14)}',
      '.litkb-exportMenuList a{padding:8px 10px;border-radius:8px;font-size:12px;color:var(--litkb-text-2);text-decoration:none}',
      '.litkb-exportMenuList a:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-graphModes{display:flex;align-items:center;gap:8px;padding:10px 14px 0}',
      '.litkb-moreMenu{position:relative;display:inline-block}',
      '.litkb-moreMenu>summary{list-style:none;cursor:pointer}',
      '.litkb-moreMenu>summary::-webkit-details-marker{display:none}',
      '.litkb-moreList{position:absolute;right:0;top:calc(100% + 6px);z-index:40;display:flex;flex-direction:column;min-width:140px;padding:6px;border:1px solid var(--litkb-border);border-radius:12px;background:var(--litkb-surface);box-shadow:0 14px 34px rgba(31,42,55,.16)}',
      '.litkb-moreList button{padding:8px 10px;border:0;border-radius:8px;background:transparent;font:inherit;font-size:12px;text-align:left;color:var(--litkb-text-2);cursor:pointer}',
      '.litkb-moreList button:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-moreList button.is-danger{color:var(--litkb-danger)}',
      '.litkb-chainBatchRel{display:flex;align-items:center;gap:8px;padding:6px 0}',
      '.litkb-exportMenu.is-down .litkb-exportMenuList{top:calc(100% + 6px);bottom:auto}',
      '.litkb-exProgress{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.litkb-selFab{position:fixed;z-index:10002;display:flex;gap:6px}',
      '.litkb-selFab .litkb-askFab{position:static}',
      '.litkb-askFab.is-accent{border-color:var(--litkb-accent);background:var(--litkb-accent);color:#fff}',
      '.litkb-noteQuote{margin-top:2px;font-size:11px;color:var(--litkb-text-3)}',
      '.litkb-selFab{position:fixed;z-index:10002;display:flex;gap:2px;padding:3px;border:1px solid var(--litkb-border);border-radius:10px;background:var(--litkb-surface);box-shadow:0 10px 28px rgba(31,42,55,.2)}',
      '.litkb-selFab .litkb-askFab{position:static;padding:5px 9px;border:0;border-radius:7px;background:transparent;color:var(--litkb-text-2);box-shadow:none;font-size:12px}',
      '.litkb-selFab .litkb-askFab:hover{background:var(--litkb-fill-1);color:var(--litkb-text)}',
      '.litkb-selFab .litkb-askFab.is-accent{background:var(--litkb-accent);color:#fff}',
    ].join('\n')


    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', 'dsh-litkb')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-litkb: styles')

      ctx.slots.inject(
        'sidebar.panellist',
        () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-litkb',
          order: 20,
          label: () => '文献工作台',
        }, LitkbIcon),
        'dsh-litkb: sidebar panel icon'
      )

      ctx.slots.inject(
        'main',
        () => ctx.slots.register({ name: 'main', key: 'dsh-litkb' }, LibraryPage),
        'dsh-litkb: native main panel'
      )

      ctx.slots.inject(
        'settings.section',
        () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-litkb',
          order: 30,
          label: () => '文献工作台',
        }, LitkbSettings),
        'dsh-litkb: settings section'
      )
    }

    return { name: 'dsh-litkb', inject: ['slots'], apply }
  },
})
