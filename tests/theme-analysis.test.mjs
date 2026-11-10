/** 方向分析：全文抽取、q-id 锚定、观点合成、观点链。 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-analysis-'))
process.env.LITKB_LIBRARY = root
const { PATHS, ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard, readCard } = await import('../lib/cards.js')
const { saveTheme } = await import('../lib/themes.js')
const {
  analysisScope,
  analysisStats,
  createViewpointChain,
  extractPaperAnalysis,
  pruneAnalysis,
  readAnalysis,
  saveAnalysis,
  synthesizeFacet,
} = await import('../lib/theme-analysis.js')
ensureLibrary()

const theme = saveTheme({
  title: '视盘分割研究方向',
  description: '关注坐标注意力与非对称解码。',
  facets: [
    { title: '坐标注意力', description: '位置信息与注意力', keywords: ['coordinate', 'attention'] },
    { title: '数据集与指标', description: '用了哪些数据与 Dice', keywords: ['dataset', 'Dice'] },
  ],
})

const record = {
  id: 'p-analysis',
  citekey: 'p-analysis',
  title: 'Coordinate Attention for Segmentation',
  authors: 'Hou Q.',
  year: 2026,
  venue: 'CVPR',
  doi: '',
  type: '会议',
  topics: ['分割'],
  status: '略读',
  file: 'p-analysis.pdf',
  pages: 2,
  chars: 500,
  quality: 0.9,
  added: new Date().toISOString(),
}
upsert(record)

const card = {
  paperId: record.id,
  status: 'ready',
  model: 'fake',
  generatedAt: new Date().toISOString(),
  sections: [{ key: 'method', title: '方法', text: '使用坐标注意力。', evidence: ['q-aaaaaaaa'] }],
  evidence: [
    {
      id: 'q-aaaaaaaa',
      page: 1,
      quote: 'We use coordinate attention to encode position information.',
      before: '',
      after: '',
      kind: 'author_claim',
    },
  ],
  annotations: [],
  warnings: [],
  statusHistory: [],
}
writeCard(card, record)

writeFileSync(
  join(PATHS.blocks, 'p-analysis.json'),
  JSON.stringify({
    schema: 1,
    pages: [
      {
        page: 1,
        blocks: [
          {
            id: 'b1',
            role: 'paragraph',
            order: 1,
            text: 'We use coordinate attention to encode position information.',
          },
          { id: 'b2', role: 'paragraph', order: 2, text: 'The method is evaluated on REFUGE with Dice.' },
        ],
      },
      {
        page: 2,
        blocks: [
          {
            id: 'b3',
            role: 'paragraph',
            order: 1,
            text: 'This is a long exact quote about asymmetric decoder refinement.',
          },
        ],
      },
    ],
  }),
  'utf8',
)

function fakeCtx(responses) {
  let index = 0
  return {
    get(name) {
      if (name !== 'llm') return undefined
      return {
        stream() {
          const text = responses[Math.min(index, responses.length - 1)]
          index += 1
          return (async function* () {
            yield { type: 'text-delta', text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
}

const route = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
const ctx = fakeCtx([
  JSON.stringify({
    facets: {
      f1: {
        relevance: 3,
        stance: 'supports',
        summary: '坐标注意力编码位置信息。',
        rationale: '直接相关。',
        claims: [{ text: '坐标注意力编码位置信息。', role: 'method', evidenceIds: ['q-aaaaaaaa'] }],
      },
      f2: {
        relevance: 2,
        stance: 'mentions',
        summary: '在 REFUGE 上评估 Dice。',
        rationale: '数据与指标相关。',
        claims: [
          {
            text: '使用 REFUGE 和 Dice。',
            role: 'data',
            quote: 'The method is evaluated on REFUGE with Dice.',
            page: 1,
          },
        ],
      },
    },
  }),
  JSON.stringify({
    facets: {
      f1: {
        relevance: 2,
        stance: 'qualifies',
        summary: '非对称解码细化。',
        rationale: '部分相关。',
        claims: [
          {
            text: '非对称解码细化。',
            role: 'method',
            quote: 'This is a long exact quote about asymmetric decoder refinement.',
            page: 2,
          },
        ],
      },
      f2: { relevance: 0, stance: 'not_relevant', summary: '', rationale: '未涉及。', claims: [] },
    },
  }),
  JSON.stringify({
    viewpoints: [
      {
        statement: '坐标注意力通过位置编码提升分割。',
        papers: ['p-analysis'],
        evidenceIds: ['q-aaaaaaaa'],
        agreements: ['都认为位置信息重要'],
        disagreements: ['数据设置不同'],
      },
    ],
    agreements: ['位置信息重要'],
    disagreements: ['数据设置不同'],
    gaps: [],
  }),
])

const first = await extractPaperAnalysis({ ctx, route, theme, record, facetKeys: ['f1', 'f2'] })
assert.equal(first.facets.f1.relevance, 3)
assert.deepEqual(first.facets.f1.claims[0].evidenceIds, ['q-aaaaaaaa'])
assert.equal(first.facets.f2.claims[0].supported, true, '新引文应回贴为 q-id')
const updated = readCard(record.id)
assert.ok(
  updated.evidence.some((ev) => ev.quote.includes('REFUGE')),
  '新证据应写回卡片',
)

const second = await extractPaperAnalysis({
  ctx,
  route,
  theme,
  record: { ...record, id: record.id },
  facetKeys: ['f1', 'f2'],
})
assert.equal(second.facets.f1.claims[0].supported, true)
const synthesized = await synthesizeFacet({
  ctx,
  route,
  theme,
  facet: theme.facets[0],
  papers: [first, second],
})
assert.equal(synthesized.viewpoints.length, 1)
assert.equal(synthesized.viewpoints[0].evidence[0].evidenceId, 'q-aaaaaaaa')

const saved = saveAnalysis({
  themeId: theme.id,
  runId: 'run-test',
  at: new Date().toISOString(),
  model: 'fake',
  papers: { [first.paperId]: first, [second.paperId]: second },
  facets: { f1: synthesized },
  stats: analysisStats({ papers: { [first.paperId]: first, [second.paperId]: second }, facets: { f1: synthesized } }),
})
assert.equal(readAnalysis(theme.id).runId, 'run-test')
assert.equal(saved.stats.viewpoints, 1)

const chain = createViewpointChain({ themeId: theme.id, facetKey: 'f1', viewpointId: 'v1' })
assert.equal(chain.status, 'draft')
assert.equal(chain.origin, 'topic')
assert.equal(chain.provenance.viewpointId, 'v1')
assert.equal(chain.claim.text, '坐标注意力通过位置编码提升分割。')
assert.ok(chain.nodes.length >= 1)
const again = createViewpointChain({ themeId: theme.id, facetKey: 'f1', viewpointId: 'v1' })
assert.equal(again.id, chain.id, '同一观点重跑应更新草稿')
const { saveChain } = await import('../lib/chains.js')
saveChain({ ...chain, status: 'confirmed', review: { action: 'accepted' } })
const supplement = createViewpointChain({ themeId: theme.id, facetKey: 'f1', viewpointId: 'v1' })
assert.notEqual(supplement.id, chain.id, 'confirmed 后应生成补充草稿')
assert.equal(supplement.provenance.previousChainId, chain.id)

/* ---------- 观点综合截断：回退为逐篇观点 ---------- */
const synthTruncCtx = {
  get(name) {
    if (name !== 'llm') return undefined
    return {
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        })()
      },
    }
  },
}
const fallbackSynth = await synthesizeFacet({
  ctx: synthTruncCtx,
  route,
  theme,
  facet: theme.facets[0],
  papers: [first, second],
})
assert.equal(fallbackSynth.fallback, true)
assert.equal(fallbackSynth.viewpoints.length, 2)
assert.ok(fallbackSynth.viewpoints.every((item) => item.papers.length === 1))

/* ---------- 截断回退：逐条研究内容重跑 ---------- */
let truncIndex = 0
const truncResponses = [
  null,
  JSON.stringify({ facets: { f1: { relevance: 2, stance: 'supports', summary: '逐条回退 f1', claims: [] } } }),
  JSON.stringify({ facets: { f2: { relevance: 1, stance: 'mentions', summary: '逐条回退 f2', claims: [] } } }),
]
const truncCtx = {
  get(name) {
    if (name !== 'llm') return undefined
    return {
      stream() {
        const response = truncResponses[Math.min(truncIndex, truncResponses.length - 1)]
        truncIndex += 1
        return (async function* () {
          if (!response) {
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
            return
          }
          yield { type: 'text-delta', text: response }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
  },
}
const split = await extractPaperAnalysis({ ctx: truncCtx, route, theme, record, facetKeys: ['f1', 'f2'] })
assert.equal(split.facets.f1.summary, '逐条回退 f1')
assert.equal(split.facets.f2.summary, '逐条回退 f2')

/* ---------- 删除论文后动态清理矩阵/观点 ---------- */
const pruned = pruneAnalysis(
  {
    stats: { papers: 2, relevant: 1, viewpoints: 2, gaps: 0 },
    papers: {
      'p-a': { paperId: 'p-a', facets: { f1: { relevance: 2 } } },
      'p-b': { paperId: 'p-b', facets: { f1: { relevance: 0 } } },
    },
    facets: {
      f1: {
        relevantCount: 1,
        viewpoints: [
          {
            id: 'v1',
            statement: '共同观点',
            papers: ['p-a', 'p-b'],
            evidence: [
              { paperId: 'p-a', evidenceId: 'q-aaaaaaaa' },
              { paperId: 'p-b', evidenceId: 'q-bbbbbbbb' },
            ],
          },
          {
            id: 'v2',
            statement: '只属于 b',
            papers: ['p-b'],
            evidence: [{ paperId: 'p-b', evidenceId: 'q-bbbbbbbb' }],
          },
        ],
        gaps: [],
      },
    },
  },
  new Set(['p-a']),
)
assert.equal(pruned.changed, true)
assert.deepEqual(Object.keys(pruned.analysis.papers), ['p-a'])
assert.equal(pruned.analysis.facets.f1.viewpoints.length, 1)
assert.deepEqual(pruned.analysis.facets.f1.viewpoints[0].papers, ['p-a'])
assert.deepEqual(
  pruned.analysis.facets.f1.viewpoints[0].evidence.map((item) => item.paperId),
  ['p-a'],
)
assert.equal(pruned.analysis.stats.papers, 1)

/* ---------- 论文移出研究的参考清单后，分析范围也要跟着缩小 ---------- */
const inTheme = { ...record, id: 'p-scope001' }
const outTheme = { ...record, id: 'p-scope002' }
upsert(inTheme)
upsert(outTheme)
const scopeTheme = {
  ...theme,
  papers: {
    include: [],
    exclude: [outTheme.id],
    lastMatch: {
      at: new Date().toISOString(),
      papers: [{ paperId: inTheme.id }, { paperId: outTheme.id }],
    },
  },
}
const scope = analysisScope(scopeTheme)
assert.ok(scope.has(inTheme.id), '留在参考清单里的论文应仍在分析范围内')
assert.ok(!scope.has(outTheme.id), '被移出的论文必须从分析范围里剔除')

const scoped = pruneAnalysis(
  {
    themeId: theme.id,
    papers: {
      [inTheme.id]: { paperId: inTheme.id, title: '留', facets: { f1: { relevance: 2, stance: 'supports' } } },
      [outTheme.id]: { paperId: outTheme.id, title: '走', facets: { f1: { relevance: 0, stance: 'not_relevant' } } },
    },
    facets: {
      f1: {
        relevantCount: 1,
        viewpoints: [
          {
            id: 'v1',
            papers: [inTheme.id, outTheme.id],
            evidence: [{ paperId: inTheme.id, evidenceId: 'q-aaaaaaaa' }],
          },
        ],
        gaps: [],
      },
    },
  },
  scope,
)
assert.equal(scoped.changed, true)
assert.deepEqual(Object.keys(scoped.analysis.papers), [inTheme.id])
assert.deepEqual(scoped.analysis.facets.f1.viewpoints[0].papers, [inTheme.id])
assert.equal(scoped.analysis.stats.papers, 1, '统计要跟着参考论文数走')

console.log('theme analysis tests passed')
