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
                      h('button', { type: 'button', className: 'litkb-miniBtn', onClick: () => onOpenChain && onOpenChain(chain.id) }, '查看'),
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

