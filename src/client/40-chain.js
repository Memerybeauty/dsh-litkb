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

