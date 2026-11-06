/**
 * P3 概念归一 / 边抽取 / 图谱 / 可比组（不联网）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-graph-'))

const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { blocksPath, findBlockForQuote } = await import('../lib/blocks.js')
const {
  ANALYSIS_DIR, EDGES_PATH, conceptId, ensureConcept, findConcept, mergeConcepts,
  normalizeTerm, readConcepts, readEdges, rebuildEdges, updateConcept, writeAnalysis, writeConcepts,
} = await import('../lib/concepts.js')
const {
  buildAll, compareGroups, looksSimilar, normalizeExtraction, readGraph,
} = await import('../lib/graph.js')

ensureLibrary()
const record = {
  id: 'p-aaaaaaaa', citekey: 'p-aaaaaaaa', title: 'CA-UNet on REFUGE', authors: '',
  year: 2024, type: '学术期刊', topics: ['分割骨干'], status: '精读',
  file: 'p-aaaaaaaa.pdf', pages: 6, chars: 2000, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
const card = {
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [
    { key: 'oneLine', title: '一句话', text: '提出 CA-UNet。', evidence: ['q-11111111'] },
    { key: 'problem', title: '问题与动机', text: 'U-Net 边界差。', evidence: ['q-22222222'] },
    { key: 'method', title: '方法', text: '用 Coordinate Attention 改进 U-Net。', evidence: ['q-11111111'] },
    { key: 'data', title: '数据与实验', text: '在 REFUGE 上评测。', evidence: ['q-33333333'] },
    { key: 'results', title: '结果', text: 'OC Dice 0.8937。', evidence: ['q-33333333'] },
    { key: 'limits', title: '局限', text: '单中心。', evidence: [] },
    { key: 'relevance', title: '与我的课题', text: '可当 baseline。', evidence: [] },
  ],
  evidence: [
    { id: 'q-11111111', page: 3, quote: 'We propose Coordinate Attention to improve U-Net.', block: 'b-1' },
    { id: 'q-22222222', page: 2, quote: 'U-Net suffers from blurry boundaries.', block: 'b-2' },
    { id: 'q-33333333', page: 5, quote: 'On REFUGE, our method achieves OC Dice 0.8937.', block: 'b-3' },
  ],
  annotations: [], warnings: [],
}
writeCard(card, record)
writeFileSync(blocksPath(record.id), JSON.stringify({
  pages: [{
    page: 5,
    blocks: [
      { id: 'b-r', text: 'On REFUGE, our method achieves OC Dice 0.8937.' },
      { id: 'b-table', text: '<table><tr><td>w/o SAAG</td><td>69.88</td><td>55.26</td></tr></table>' },
    ],
  }],
}))

const extraction = {
  concepts: [
    { kind: 'method', name: 'Coordinate Attention', aliases: ['CA'] },
    { kind: 'method', name: 'U-Net', aliases: ['UNet'] },
    { kind: 'method', name: 'CA-UNet', proposed: true },
    { kind: 'dataset', name: 'REFUGE' },
    { kind: 'metric', name: 'OC Dice' },
  ],
  edges: [
    { type: 'uses', target: 'Coordinate Attention', evidence: 'q-11111111', confidence: 0.9 },
    { type: 'uses', target: 'CA-UNet', evidence: 'q-11111111' },
    { type: 'improves_on', source: 'CA-UNet', target: 'U-Net', evidence: 'q-22222222' },
    { type: 'evaluates_on', target: 'REFUGE', evidence: 'q-33333333' },
    { type: 'reports', target: 'OC Dice', value: 0.8937, dataset: 'REFUGE', evidence: 'q-33333333' },
    { type: 'reports', target: 'OC Dice', value: 0.99, evidence: 'q-99999999' },
    { type: 'uses', target: 'Nonexistent', evidence: 'q-11111111' },
  ],
}

function fakeCtx(text) {
  let calls = 0
  return {
    calls: () => calls,
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [{ id: 'fake' }],
          stream() {
            calls += 1
            return (async function* () {
              yield { type: 'text-delta', text }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake' }) }
      return undefined
    },
  }
}

let passed = 0
const pending = []
function test(name, fn) { pending.push({ name, fn }) }

test('概念归一：大小写/连字符/别名同名，ID 稳定', () => {
  assert.equal(normalizeTerm('U-Net'), 'unet')
  assert.equal(normalizeTerm('UNet'), 'unet')
  assert.equal(normalizeTerm('u net'), 'unet')
  const store = { concepts: [] }
  const first = ensureConcept(store, { kind: 'method', name: 'U-Net' })
  assert.equal(first.id, conceptId('method', 'UNet'))
  const second = ensureConcept(store, { kind: 'method', name: 'UNet', aliases: ['U-Net backbone'] })
  assert.equal(second.id, first.id)
  assert.equal(store.concepts.length, 1)
  assert.ok(store.concepts[0].aliases.includes('U-Net backbone'))
  assert.equal(findConcept(store, 'method', 'u-net'), first)
  assert.equal(findConcept(store, 'method', 'U-Net backbone'), first)
})

test('相似判定：res14/res15 不合并，U-Net/UNet 归一', () => {
  assert.equal(looksSimilar('U-Net', 'UNet'), true)
  assert.equal(looksSimilar('res14', 'res15'), false)
  assert.equal(looksSimilar('res14', 'res16'), false)
})

test('概念改名：ID 不变，旧名进别名', () => {
  const store = { concepts: [] }
  const concept = ensureConcept(store, { kind: 'dataset', name: 'REFUGE' })
  const result = updateConcept(store, concept.id, { name: 'REFUGE 数据集' })
  assert.equal(result.ok, true)
  assert.equal(result.concept.id, concept.id)
  assert.equal(result.concept.name, 'REFUGE 数据集')
  assert.ok(result.concept.aliases.includes('REFUGE'))
})

test('边校验：丢无证据/无目标/无数字，页码以证据为准', () => {
  const store = { concepts: [] }
  const mapping = new Map()
  for (const item of extraction.concepts) {
    const concept = ensureConcept(store, { kind: item.kind, name: item.name, aliases: item.aliases || [] })
    mapping.set(`${item.kind}:${normalizeTerm(item.name)}`, concept)
  }
  const result = normalizeExtraction({ parsed: extraction, record, card, store, mapping })
  assert.equal(result.edges.length, 5)
  assert.equal(result.dropped, 2)
  assert.ok(result.warnings.some((w) => w.includes('证据不存在')))
  const report = result.edges.find((edge) => edge.type === 'reports')
  assert.equal(report.page, 5)
  assert.equal(report.block, 'b-3')
  assert.equal(report.quote, 'On REFUGE, our method achieves OC Dice 0.8937.')
  assert.equal(report.value, 0.8937)
  assert.equal(report.dataset, 'REFUGE')
})

test('版面块回贴：HTML 表格与跨块前缀也能定位', () => {
  const doc = {
    pages: [{
      page: 59,
      blocks: [
        { id: 'b-table', text: '<table><tr><td>w/o SAAG</td><td>69.88</td><td>55.26</td><td>60.60</td><td>67.14</td></tr></table>' },
        { id: 'b-long', text: 'SuperRev-Fusion achieves the best results on five metrics, including SF, AG and SCD.' },
      ],
    }],
  }
  assert.equal(findBlockForQuote(doc, 59, 'w/o SAAG 69.88 55.26 60.60 67.14').id, 'b-table')
  assert.equal(findBlockForQuote(doc, 59, 'SuperRev-Fusion achieves the best results on five metrics, including SF,\none MRI-PET image pair').id, 'b-long')
})

test('构建图谱：落盘、证据覆盖 100%、增量跳过', async () => {
  const ctx = fakeCtx(JSON.stringify(extraction))
  const summary = await buildAll({ ctx, onProgress: () => {} })
  assert.equal(summary.analyzed, 1)
  assert.equal(summary.edges, 5)
  assert.equal(summary.dropped, 2)
  const edges = readEdges()
  assert.equal(edges.length, 5)
  assert.ok(edges.every((edge) => edge.evidence && edge.page && edge.quote))
  const lines = readFileSync(EDGES_PATH, 'utf8').trim().split('\n')
  assert.equal(lines.length, 5)
  const graph = readGraph()
  assert.equal(graph.meta.evidenceCoverage, 1)
  assert.equal(graph.edges.length, 5)
  const reportEdge = graph.edges.find((edge) => edge.type === 'reports')
  assert.equal(reportEdge.block, 'b-r', '边应带上版面块，点 p.N 才能高亮')
  const again = await buildAll({ ctx, onProgress: () => {} })
  assert.equal(again.analyzed, 0)
  assert.equal(again.skipped, 1)
  assert.equal(ctx.calls(), 1)
})

test('待归一并列合并：边重指到目标概念并重建', () => {
  const store = readConcepts()
  const unet = findConcept(store, 'method', 'U-Net')
  const pending = ensureConcept(store, { kind: 'method', name: 'UNet++ + CA', status: 'pending' })
  writeAnalysis('p-bbbbbbbb', {
    paperId: 'p-bbbbbbbb', title: 'pending', year: 2025,
    edges: [{
      id: 'e-pending001', source: 'p-bbbbbbbb', target: pending.id, type: 'uses',
      paper: 'p-bbbbbbbb', evidence: 'q-11111111', page: 1, quote: 'x', confidence: 0.7,
    }],
    candidates: [],
  })
  const merged = mergeConcepts(store, pending.id, unet.id)
  assert.equal(merged.ok, true)
  writeConcepts(store)
  const edges = rebuildEdges()
  assert.ok(edges.some((edge) => edge.id === 'e-pending001' && edge.target === unet.id))
  assert.ok(!edges.some((edge) => edge.target === pending.id))
  assert.ok(readConcepts().concepts.every((concept) => concept.id !== pending.id))
  assert.ok(readConcepts().concepts.find((concept) => concept.id === unet.id).aliases.includes('UNet++ + CA'))
})

test('可比组：同数据集同指标分组，按数值降序、同篇取最新', () => {
  const store = readConcepts()
  const metric = findConcept(store, 'metric', 'OC Dice')
  const dataset = findConcept(store, 'dataset', 'REFUGE')
  writeAnalysis('p-cccccccc', {
    paperId: 'p-cccccccc', title: 'better', year: 2025,
    edges: [
      { id: 'e-r1', source: 'p-cccccccc', target: metric.id, type: 'reports', paper: 'p-cccccccc', evidence: 'q-1', page: 4, quote: 'q', metric: 'OC Dice', value: 0.91, dataset: 'REFUGE', at: '2026-01-01T00:00:00Z' },
      { id: 'e-r2', source: 'p-cccccccc', target: metric.id, type: 'reports', paper: 'p-cccccccc', evidence: 'q-2', page: 4, quote: 'q', metric: 'OC Dice', value: 0.95, dataset: 'REFUGE', at: '2026-02-01T00:00:00Z' },
    ],
    candidates: [],
  })
  upsert({ ...record, id: 'p-cccccccc', citekey: 'p-cccccccc', title: 'better', year: 2025 })
  rebuildEdges()
  const groups = compareGroups()
  const group = groups.find((item) => item.dataset === 'REFUGE' && item.metric === 'OC Dice')
  assert.ok(group)
  assert.equal(group.rows[0].paper, 'p-cccccccc')
  assert.equal(group.rows[0].value, 0.95)
  assert.equal(group.rows.find((row) => row.paper === record.id).value, 0.8937)
  assert.ok(group.rows[0].value >= group.rows[1].value)
  assert.ok(group.rows.every((row) => row.evidence && row.page))
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
