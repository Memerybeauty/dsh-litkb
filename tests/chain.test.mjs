/**
 * P4.10 论证链：论点候选、三种提议、落库、失效识别、插入文稿。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-chain-'))

const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard, readCard } = await import('../lib/cards.js')
const { createDraft, parseCitations, readDraft, saveDraft } = await import('../lib/drafts.js')
const {
  claimCandidates,
  proposeFromClaim,
  proposeFromQuestion,
  proposeFromEvidence,
  proposeFromBlock,
  saveChain,
  readChain,
  listChains,
  deleteChain,
  chainParagraph,
  normalizeClaimText,
  chainGraph,
  writeChainLayout,
  readChainLayout,
  shortText,
  autoChainDrafts,
} = await import('../lib/chains.js')

ensureLibrary()

const records = [
  {
    id: 'p-c1',
    citekey: 'p-c1',
    title: '极坐标变换用于视盘边界分割',
    authors: 'Wu B.',
    year: 2024,
    venue: 'Journal',
    doi: '',
    type: '学术期刊',
    topics: [],
    status: '精读',
    file: 'p-c1.pdf',
    pages: 6,
    chars: 2000,
    quality: 0.9,
    added: new Date().toISOString(),
  },
  {
    id: 'p-c2',
    citekey: 'p-c2',
    title: '视盘边界的多中心验证',
    authors: 'Li C.',
    year: 2025,
    venue: 'Conference',
    doi: '',
    type: '会议',
    topics: [],
    status: '精读',
    file: 'p-c2.pdf',
    pages: 6,
    chars: 2000,
    quality: 0.9,
    added: new Date().toISOString(),
  },
]

const decks = {
  'p-c1': [
    {
      id: 'q-aaaa1111',
      page: 5,
      block: 'b-011',
      quote: 'We propose a polar transform that improves the optic disc boundary segmentation.',
    },
    { id: 'q-bbbb2222', page: 3, block: 'b-022', quote: 'The evaluation is limited to a single public dataset.' },
    {
      id: 'q-cccc3333',
      page: 2,
      block: 'b-033',
      quote: 'The polar transform improves Dice to 0.95 on the public dataset.',
    },
  ],
  'p-c2': [
    {
      id: 'q-dddd4444',
      page: 4,
      block: 'b-044',
      quote: 'Our polar-based method also improves boundary Dice on REFUGE.',
    },
  ],
}

for (const record of records) {
  upsert(record)
  writeCard(
    {
      paperId: record.id,
      status: 'ready',
      model: 'fake',
      generatedAt: new Date().toISOString(),
      sections:
        record.id === 'p-c2'
          ? [
              {
                key: 'oneLine',
                title: '一句话',
                text: '极坐标方法在 REFUGE 多中心验证中改善视盘边界分割。',
                evidence: ['q-dddd4444'],
              },
              { key: 'method', title: '方法', text: '采用极坐标变换处理边界。', evidence: ['q-dddd4444'] },
            ]
          : [
              { key: 'oneLine', title: '一句话', text: '提出方法。', evidence: [] },
              { key: 'method', title: '方法', text: '极坐标变换。', evidence: [] },
            ],
      evidence: decks[record.id].map((ev) => ({ ...ev, kind: 'author_claim', before: '', after: '' })),
      annotations: [],
      warnings: [],
      statusHistory: [],
    },
    record,
  )
}

const deepread = {
  paperId: 'p-c1',
  markdown: '',
  numbers: [],
  evidence: [],
  sections: [
    { key: 'profile', title: '文献基本资料', index: 1, markdown: '- 标题：极坐标变换' },
    {
      key: 'conclusion',
      title: '结论',
      index: 7,
      markdown:
        '作者结论是：极坐标变换改善视盘边界分割 [[p-c1#^q-aaaa1111|p.5]]。适用范围仅限于单一公开数据集 [[p-c1#^q-bbbb2222|p.3]]。',
    },
    {
      key: 'takeaways',
      title: '核心要点',
      index: 11,
      markdown: '- 极坐标变换把边界 Dice 提高到 0.95 [p.2]。\n- 需要更多数据集验证。',
    },
    { key: 'limitations', title: '局限性', index: 9, markdown: '仅在一个数据集上验证 [[p-c1#^q-bbbb2222|p.3]]。' },
  ],
}
writeFileSync(join(PATHS.deepread, 'p-c1.json'), JSON.stringify(deepread), 'utf8')
writeFileSync(
  join(PATHS.blocks, 'p-c1.json'),
  JSON.stringify({
    schema: 1,
    parser: 'fake',
    numPages: 5,
    pages: [
      {
        page: 4,
        width: 1000,
        height: 1000,
        blocks: [
          {
            id: 'b-100',
            role: 'paragraph',
            section: 'results',
            bbox: [0, 0, 1, 1],
            text: 'The proposed polar transform also reduces the cup-to-disc ratio error on the REFUGE dataset.',
          },
          { id: 'b-101', role: 'header', section: 'other', bbox: [0, 0, 1, 1], text: 'Journal header line' },
        ],
      },
    ],
  }),
  'utf8',
)

let passed = 0
const pending = []
function test(name, fn) {
  pending.push({ name, fn })
}

test('论点候选：切句、去引用、保留 q-id 与页码', () => {
  const claims = claimCandidates('p-c1')
  assert.ok(claims.length >= 2)
  const first = claims.find((item) => item.text.includes('极坐标变换改善视盘边界分割'))
  assert.ok(first)
  assert.equal(first.sectionTitle, '结论')
  assert.deepEqual(first.evidenceIds, ['q-aaaa1111'])
  assert.ok(first.pages.includes(5))
  assert.ok(!first.text.includes('[['))
  assert.ok(!first.text.includes('q-'))
  const byPage = claims.find((item) => item.text.includes('0.95'))
  assert.ok(byPage.pages.includes(2))
})

test('论点先行：从同句引用提证据，页码/块以卡片为准', () => {
  const claims = claimCandidates('p-c1')
  const target = claims.find((item) => item.text.includes('改善视盘边界分割'))
  const result = proposeFromClaim({ paperId: 'p-c1', claim: target.text })
  assert.ok(result.nodes.length >= 1)
  assert.equal(result.matched, true)
  const node = result.nodes[0]
  assert.equal(node.evidenceId, 'q-aaaa1111')
  assert.equal(node.page, 5)
  assert.equal(node.block, 'b-011')
  assert.equal(node.relation, 'supports')
  assert.ok(!result.warnings.length)
})

test('问题先行：跨论文检索，每篇最多两条', () => {
  const result = proposeFromQuestion({ question: '极坐标 视盘边界' })
  assert.ok(result.nodes.length >= 2)
  const papers = new Set(result.nodes.map((node) => node.paperId))
  assert.equal(papers.size, 2)
  assert.ok(result.nodes.every((node) => node.quote && node.page))
  assert.ok(!result.warnings.some((text) => text.includes('只找到 1 篇')))
})

test('证据先行：优先用引用这些证据的精读句子当论点', () => {
  const result = proposeFromEvidence({ evidenceIds: ['q-aaaa1111', 'q-bbbb2222'] })
  assert.equal(result.nodes.length, 2)
  assert.ok(result.claim.includes('极坐标变换'))
  assert.ok(!/q-[0-9a-f]{8}/.test(result.claim))
})

test('保存/读取/列表：空论点或空证据拒绝落库', () => {
  assert.throws(() => saveChain({ claim: { text: '   ' }, nodes: [] }), /论点不能为空/)
  assert.throws(
    () => saveChain({ claim: { text: '一个没有证据的论点' }, nodes: [{ evidenceId: 'q-ffffffff' }] }),
    /至少要有一个有效证据节点/,
  )
  const claims = claimCandidates('p-c1')
  const target = claims.find((item) => item.text.includes('改善视盘边界分割'))
  const draftChain = {
    claim: { text: target.text, paperId: 'p-c1', sectionKey: 'conclusion', source: 'deepread' },
    origin: 'claim',
    status: 'confirmed',
    question: '极坐标是否改善边界？',
    nodes: [
      { paperId: 'p-c1', evidenceId: 'q-aaaa1111', relation: 'supports' },
      { paperId: 'p-c1', evidenceId: 'q-bbbb2222', relation: 'qualifies' },
    ],
  }
  const saved = saveChain(draftChain)
  assert.match(saved.id, /^c-[a-z0-9]{8}$/)
  assert.equal(saved.nodes.length, 2)
  assert.equal(saved.nodes[1].relation, 'qualifies')
  const again = readChain(saved.id)
  assert.equal(again.claim.text, target.text)
  assert.equal(again.nodes[0].stale, false)
  const list = listChains()
  assert.equal(list.length, 1)
  assert.equal(list[0].nodes, 2)
})

test('插入文稿：论证段带引用，反链/参考文献能解析', () => {
  const chain = listChains()[0]
  const paragraph = chainParagraph(readChain(chain.id))
  assert.ok(paragraph.text.includes('极坐标变换'))
  assert.ok(paragraph.text.includes('[[p-c1#^q-aaaa1111|Wu B. 2024, p.5]]'))
  assert.ok(paragraph.text.includes('需要限定的条件是'))
  assert.equal(paragraph.skipped.length, 0)
  const draft = createDraft({ title: '链测试' })
  saveDraft(draft.id, { body: paragraph.text })
  const parsed = parseCitations(readDraft(draft.id).body)
  assert.equal(parsed.missing.length, 0)
  assert.equal(parsed.citations.length, 2)
  assert.ok(parsed.papers.some((paper) => paper.paperId === 'p-c1'))
})

test('原文段落建链：自动补 q-id，重复调用不重复建证据', () => {
  const before = readCard('p-c1').evidence.length
  const first = proposeFromBlock({ paperId: 'p-c1', blockId: 'b-100' })
  assert.equal(first.origin, 'block')
  assert.equal(first.nodes.length, 1)
  assert.equal(first.nodes[0].block, 'b-100')
  assert.equal(first.nodes[0].page, 4)
  assert.ok(first.claim.length >= 8)
  assert.ok(!first.claim.includes('[['))
  assert.equal(first.notice.includes('已把这一段补为证据'), true)
  const after = readCard('p-c1').evidence.length
  assert.equal(after, before + 1)
  const again = proposeFromBlock({ paperId: 'p-c1', blockId: 'b-100' })
  assert.equal(again.nodes[0].evidenceId, first.nodes[0].evidenceId)
  assert.equal(readCard('p-c1').evidence.length, after)
  assert.throws(() => proposeFromBlock({ paperId: 'p-c1', blockId: 'b-101' }), /页眉页脚/)
  assert.throws(() => proposeFromBlock({ paperId: 'p-c1', blockId: 'b-999' }), /找不到这个版面块/)
})

test('失效显式：证据被删后节点标 stale，插入跳过', () => {
  const chain = listChains()[0]
  const record = records[0]
  const card = readCard('p-c1')
  card.evidence = card.evidence.filter((ev) => ev.id !== 'q-aaaa1111')
  writeCard(card, record)
  const stale = readChain(chain.id)
  assert.equal(stale.nodes.find((node) => node.evidenceId === 'q-aaaa1111').stale, true)
  assert.equal(stale.nodes.find((node) => node.evidenceId === 'q-bbbb2222').stale, false)
  const paragraph = chainParagraph(stale)
  assert.deepEqual(paragraph.skipped, ['q-aaaa1111'])
  assert.equal(paragraph.citations, 1)
  assert.ok(!paragraph.text.includes('q-aaaa1111'))
})

test('论点清洗：拒绝带引用/过长/空话的输出', () => {
  assert.equal(normalizeClaimText('论点：极坐标变换改善边界。'), '极坐标变换改善边界。')
  assert.equal(normalizeClaimText('极坐标 [[p-c1#^q-aaaa1111]] 改善边界'), '极坐标 改善边界')
  assert.equal(normalizeClaimText('太短'), '')
  assert.equal(normalizeClaimText('x'.repeat(240)), '')
})

test('节点短标签：中文 ≤10 字，英文 ≤14 字符', () => {
  assert.ok(shortText('极坐标变换改善视盘边界').length <= 10)
  assert.ok(shortText('作者结论是：将任意步扩散反演超分（ASDI）作为融合前的步骤').length <= 10)
  assert.ok(shortText('The evaluation is limited to a single public dataset.').length <= 14)
  assert.equal(shortText('').length, 0)
})

test('证据链图：claim→evidence→paper，关系与 stale 保留', () => {
  const graph = chainGraph()
  assert.ok(graph.stats.chains >= 1)
  assert.ok(graph.stats.evidence >= 1)
  const kinds = new Set(graph.nodes.map((node) => node.data.kind))
  assert.ok(kinds.has('claim'))
  assert.ok(kinds.has('evidence'))
  assert.ok(kinds.has('paper'))
  const relation = graph.edges.find((edge) => edge.data.kind === 'qualifies')
  assert.ok(relation, '限定关系进图')
  const staleEdge = graph.edges.find((edge) => edge.data.stale)
  assert.ok(staleEdge, '失效证据边保留并标记')
  for (const node of graph.nodes) {
    assert.ok(node.data.short, '每个节点都有短标签')
    assert.ok(node.data.short.length <= 14, `短标签过长：${node.data.short}`)
  }
  assert.equal(graph.stats.unchainedPapers, 1, 'p-c2 没有链，应算未建链论文')
  const unchained = graph.nodes.find((node) => node.data.kind === 'paper' && node.data.unchained)
  assert.ok(unchained)
  assert.equal(unchained.data.chains, 0)
  const claim = graph.nodes.find((node) => node.data.kind === 'claim')
  const saved = writeChainLayout({
    [claim.data.id]: { x: 12.6, y: -3.2 },
    'bad id!': { x: 1, y: 2 },
    [claim.data.id + 'x']: { x: 'no', y: 2 },
  })
  assert.deepEqual(saved[claim.data.id], { x: 13, y: -3 })
  assert.equal(Object.keys(saved).length, 1)
  assert.deepEqual(readChainLayout()[claim.data.id], { x: 13, y: -3 })
  const again = chainGraph()
  assert.deepEqual(again.positions[claim.data.id], { x: 13, y: -3 })
})

test('自动建链：精读优先，无精读用七段卡兜底', () => {
  const auto = autoChainDrafts('p-c1')
  assert.equal(auto.paperId, 'p-c1')
  assert.ok(auto.scanned >= 1)
  assert.ok(auto.drafts.length >= 1)
  const draft = auto.drafts[0]
  assert.equal(draft.origin, 'auto')
  assert.equal(draft.status, 'draft')
  assert.ok(draft.confidence > 0 && draft.confidence <= 0.95)
  assert.ok(draft.nodes.length >= 1)
  for (const node of draft.nodes) {
    assert.match(node.evidenceId, /^q-[0-9a-f]{8}$/)
    assert.ok(node.page >= 1)
  }
  const fallback = autoChainDrafts('p-c2')
  assert.ok(fallback.drafts.length >= 1, '无精读但有七段卡时应可兜底')
  assert.equal(fallback.drafts[0].provenance.source, 'card')
  assert.ok(fallback.drafts[0].warnings.some((item) => item.includes('七段卡')))
})

test('删除', () => {
  const chain = listChains()[0]
  assert.equal(deleteChain(chain.id), true)
  assert.equal(readChain(chain.id), null)
  assert.equal(listChains().length, 0)
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
