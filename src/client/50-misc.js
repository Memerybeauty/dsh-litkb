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

