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
                h('span', { className: 'litkb-noteText' }, note.text)))
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
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: `/api/litkb/evidence/export?id=${encodeURIComponent(paper.id)}&format=json`,
            download: paper.id + '.evidence.json',
          }, '导出 JSON'),
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: `/api/litkb/evidence/export?id=${encodeURIComponent(paper.id)}&format=csv`,
            download: paper.id + '.evidence.csv',
          }, '导出 CSV'),
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: `/api/litkb/export?format=bibtex&id=${encodeURIComponent(paper.id)}`,
            download: paper.id + '.bib',
          }, 'BibTeX'),
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: `/api/litkb/export?format=gbt&id=${encodeURIComponent(paper.id)}`,
            download: paper.id + '.gbt.txt',
          }, 'GB/T'),
          h('a', {
            className: 'litkb-btn litkb-btnGhost',
            href: `/api/litkb/export?format=card&id=${encodeURIComponent(paper.id)}`,
            download: paper.id + '.md',
          }, '卡片 MD')),
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
          ? h('button', {
              type: 'button', className: 'litkb-askFab', style: { left: selHint.x, top: selHint.y },
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => { if (onAsk) onAsk(selHint); setSelHint(null) },
            }, '追问')
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
    function PdfRail({ paper, page = 1, blockId, nonce, askSelection, onClearAsk, cardRevision = 0, chainRevision = 0, onChanged, onBuildChain, onOpenChain }) {
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
              className: 'litkb-box' + (block.id === focusBlock ? ' litkb-focus' : ''),
              style: {
                left: `${block.bbox[0] * 100}%`,
                top: `${block.bbox[1] * 100}%`,
                width: `${(block.bbox[2] - block.bbox[0]) * 100}%`,
                height: `${(block.bbox[3] - block.bbox[1]) * 100}%`,
                background: block.id === focusBlock ? 'rgba(79,142,247,.16)' : 'transparent',
                border: block.id === focusBlock ? '2px solid var(--litkb-accent)' : '1px solid transparent',
                boxShadow: block.id === focusBlock ? '0 0 0 2px rgba(79,142,247,.2)' : 'none',
                pointerEvents: block.id === focusBlock ? 'auto' : 'none',
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

    function ParsePanel({ paper, onOpenPdf, onAsk, onDeep, onBuildChain, flat = false }) {
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

      const focus = (block, from) => {
        setActive(block.id)
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

      const visible = (block) => showHeaders || (block.role !== 'header' && block.role !== 'footer')
      const pages = doc?.pages || []
      const sections = [...new Set(pages.flatMap((p) => (p.blocks || []).map((b) => b.section)).filter(Boolean))]

      const head = h('div', { className: 'litkb-parseHead' },
        h('span', { className: 'litkb-muted' },
          doc ? `${doc.parser} · ${doc.stats?.blocks ?? 0} 块 · 质量 ${doc.quality?.layout ?? '—'}` : '解析中'),
        h('span', { className: 'litkb-spacer' }),
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
        pages.map((page) => h('div', { key: page.page, className: 'litkb-parsePage' },
          h('div', { className: 'litkb-pageNo' }, `p.${page.page}`),
          (page.blocks || []).filter(visible).map((block) => h('div', {
            key: block.id, id: 'blk-' + block.id,
            className: 'litkb-pblock is-' + block.role + (active === block.id ? ' litkb-focus' : ''),
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
                const rect = selection.getRangeAt(0).getBoundingClientRect()
                x = Math.min(Math.max(12, rect.left), (window.innerWidth || 900) - 96)
                y = Math.min(Math.max(12, rect.bottom + 8), (window.innerHeight || 700) - 56)
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
              className: 'litkb-box is-' + block.role + (active === block.id ? ' litkb-focus' : ''),
              style: {
                left: `${block.bbox[0] * 100}%`,
                top: `${block.bbox[1] * 100}%`,
                width: `${(block.bbox[2] - block.bbox[0]) * 100}%`,
                height: `${(block.bbox[3] - block.bbox[1]) * 100}%`,
                background: 'transparent',
                border: active === block.id ? '2px solid var(--litkb-accent)' : '1px solid transparent',
                boxShadow: active === block.id ? '0 0 0 2px rgba(79,142,247,.18)' : 'none',
              },
              title: String(block.text || '').slice(0, 90),
              onClick: () => focus(block, 'page'),
            }))))))

      return h('div', { className: 'litkb-reader' + (flat && !showPage ? ' is-flat' : '') }, parsePane, showPage ? pagePane : null,
        selHint
          ? h('button', {
              type: 'button', className: 'litkb-askFab', style: { left: selHint.x, top: selHint.y },
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => { if (onAsk) onAsk(selHint); setSelHint(null) },
            }, '追问')
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

