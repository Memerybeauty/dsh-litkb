/** 图谱页 / 追问面板渲染冒烟（假 React，不跑浏览器）。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (o) => {
      captured = o
    },
  },
  devicePixelRatio: 2,
  getSelection: () => null,
  confirm: () => true,
  innerWidth: 1200,
  innerHeight: 800,
}
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(
  "return { name: 'dsh-litkb', inject: ['slots'], apply }",
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { ConceptGraphPanel, AskPanel, ConceptQueue, computeForceLayout, drawGraph, applyGraphFilters } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(9).filter((c) => c != null),
})
const ReactStub = {
  createElement: h,
  useState: (v) => {
    const index = globalThis.__i++
    const preset = globalThis.__s[index]
    return [preset !== undefined ? preset : typeof v === 'function' ? v() : v, () => {}]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}
const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error(name)
})
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ setAttribute() {}, remove() {}, style: {} }),
  getElementById: () => null,
}
mod.apply({ effect: (fn) => fn(), slots: { inject: () => {}, register: () => {} } })

function render(component, props, states) {
  globalThis.__i = 0
  globalThis.__s = states
  return JSON.stringify(mod.__test[component](props))
}

const graph = {
  nodes: [
    {
      id: 'p-1',
      type: 'paper',
      name: 'CA-UNet',
      title: 'CA-UNet',
      year: 2024,
      paperType: '学术期刊',
      topics: ['分割'],
      degree: 1,
    },
    { id: 'c-1', type: 'concept', kind: 'method', name: 'U-Net', aliases: ['UNet'], degree: 1 },
  ],
  edges: [
    {
      id: 'e-1',
      source: 'p-1',
      target: 'c-1',
      sourceName: 'CA-UNet',
      targetName: 'U-Net',
      sourceType: 'paper',
      targetType: 'concept',
      type: 'uses',
      paper: 'p-1',
      evidence: 'q-1',
      page: 3,
      quote: 'we use U-Net',
      confidence: 0.9,
    },
  ],
  meta: { papers: 1, paperNodes: 1, conceptNodes: 1, edges: 1, evidenceCoverage: 1, pending: 0, concepts: 1 },
  topics: ['分割'],
}
const filters = { topic: '', from: '', to: '', kinds: { method: true, dataset: true, metric: true }, q: '' }

const graphHtml = render('ConceptGraphPanel', { papers: [], onOpenPaper() {}, onOpenPdf() {} }, [
  graph,
  null,
  { available: true, route: { provider: 'p', model: 'm' } },
  { concepts: [], pending: [] },
  false,
  false,
  '',
  'graph',
  filters,
  null,
  new Map(),
  false,
  null,
  '',
  false,
])
assert.ok(graphHtml.includes('证据覆盖 100%'))
assert.ok(graphHtml.includes('增量构建'))
assert.ok(graphHtml.includes('点节点看邻居'))
assert.ok(graphHtml.includes('可比组'))

const emptyHtml = render('ConceptGraphPanel', { papers: [], onOpenPaper() {}, onOpenPdf() {} }, [
  { nodes: [], edges: [], meta: { edges: 0, paperNodes: 0, conceptNodes: 0 }, topics: [] },
  null,
  { available: true, route: { provider: 'p', model: 'm' } },
  { concepts: [], pending: [] },
  false,
  false,
  '',
  'graph',
  filters,
  null,
  new Map(),
  false,
  null,
  '',
  false,
])
assert.ok(emptyHtml.includes('还没有图谱'))
assert.ok(emptyHtml.includes('构建图谱'))

const askHtml = render(
  'AskPanel',
  {
    paper: { id: 'p-1' },
    selection: { text: 'Coordinate Attention', page: 3, blockId: 'b-1' },
    onClose() {},
    onOpenPdf() {},
  },
  [
    '',
    {
      answer: '它用注意力改进 U-Net [p.3]，另一处 [p.9] 越界。',
      citations: [{ page: 3, snippets: ['we use U-Net'] }],
      invalidCitations: [9],
      warnings: ['回答里有 1 个页码不在本次材料内：p.9，请核对'],
      pagesUsed: [3],
      model: 'fake/fake',
    },
    false,
    '',
    false,
    false,
  ],
)
assert.ok(askHtml.includes('需要核对'))
assert.ok(askHtml.includes('越界页码'))
assert.ok(askHtml.includes('存为批注'))
assert.ok(askHtml.includes('p.9'))
assert.ok(askHtml.includes('依据'))

const queueHtml = render(
  'ConceptQueue',
  {
    data: {
      concepts: [
        { id: 'c-9', kind: 'method', name: 'UNet', aliases: [], status: 'pending' },
        { id: 'c-1', kind: 'method', name: 'U-Net', aliases: [], status: 'active' },
      ],
    },
    onClose() {},
    onChanged: async () => {},
  },
  [],
)
assert.ok(queueHtml.includes('待归一概念（1）'))
assert.ok(queueHtml.includes('批准为新概念'))

const graphPositions = mod.__test.computeForceLayout(graph.nodes, graph.edges, 900, 500)
let drawCalls = 0
const ctx = new Proxy(
  {},
  {
    get: (target, key) => {
      if (key === 'canvas') return { width: 900, height: 500 }
      return () => {
        drawCalls += 1
      }
    },
    set: () => true,
  },
)
mod.__test.drawGraph({ clientWidth: 900, getContext: () => ctx }, graph, graphPositions, { kind: 'edge', id: 'e-1' })
assert.ok(drawCalls > 5, 'canvas 绘制调用了绘制 API')
const filtered = mod.__test.applyGraphFilters(graph, filters)
assert.equal(filtered.nodes.length, 2)
assert.equal(filtered.edges.length, 1)
const noTopic = mod.__test.applyGraphFilters(graph, { ...filters, topic: '不存在的主题' })
assert.equal(noTopic.nodes.length, 0)

const many = Array.from({ length: 300 }, (_, i) => ({
  id: i < 150 ? `p-${i}` : `c-${i}`,
  type: i < 150 ? 'paper' : 'concept',
  kind: i < 150 ? undefined : ['method', 'dataset', 'metric'][i % 3],
  name: `node-${i}`,
  topics: ['t'],
  year: 2024,
  degree: 2,
}))
const manyEdges = many.map((node, i) => ({
  id: `e-${i}`,
  source: node.id,
  target: many[(i + 1) % many.length].id,
  type: 'uses',
  paper: 'p-0',
}))
const started = Date.now()
const positions = mod.__test.computeForceLayout(many, manyEdges, 900, 500)
const elapsed = Date.now() - started
assert.equal(positions.size, 300)
assert.ok(elapsed < 2000, `300 节点布局耗时 ${elapsed}ms`)
console.log(`  ✓ 300 节点力导向布局：${elapsed}ms`)
console.log('  ✓ 图谱页：统计 / 过滤 / 画布 / 空态')
console.log('  ✓ 追问面板：页码越界 / 依据 / 存批注')
console.log('  ✓ 待归一并列：合并 / 批准')
console.log('\n3 passed')
