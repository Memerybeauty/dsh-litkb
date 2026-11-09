/** P5.0 研究工作台内核：研究读写、细分描述、匹配、主题链候选、结论/提纲。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-theme-'))

const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { writeDeepRead } = await import('../lib/deepread.js')
const { listChains, saveChain } = await import('../lib/chains.js')
const {
  listThemes, readTheme, saveTheme, deleteTheme, themeChains, themePapers, themeStats,
  matchFacet, themeChainDrafts, buildThemeSummary, buildThemeOutline,
  setThemePaper, updateThemeSummary, recordThemeMatch,
} = await import('../lib/themes.js')

ensureLibrary()

const records = [
  {
    id: 'p-th1', citekey: 'p-th1', title: 'Polar transform for optic disc segmentation',
    authors: 'Wu B.', year: 2024, venue: 'Journal', doi: '', type: '学术期刊',
    topics: ['分割'], status: '精读', file: 'p-th1.pdf', pages: 8, chars: 2000, quality: 0.9,
    added: new Date().toISOString(),
  },
  {
    id: 'p-th2', citekey: 'p-th2', title: 'Multicenter validation of optic disc boundary',
    authors: 'Li C.', year: 2025, venue: 'Conference', doi: '', type: '会议',
    topics: ['临床验证'], status: '精读', file: 'p-th2.pdf', pages: 6, chars: 1800, quality: 0.9,
    added: new Date().toISOString(),
  },
  {
    id: 'p-th3', citekey: 'p-th3', title: 'Lightweight segmentation network',
    authors: 'Zhang Y.', year: 2023, venue: 'Journal', doi: '', type: '学术期刊',
    topics: ['轻量化'], status: '精读', file: 'p-th3.pdf', pages: 5, chars: 1500, quality: 0.9,
    added: new Date().toISOString(),
  },
]

const decks = {
  'p-th1': [
    { id: 'q-a1a1a1a1', page: 3, block: 'b-01', quote: 'Polar transform improves Dice to 0.95 on REFUGE.' },
    { id: 'q-b2b2b2b2', page: 4, block: 'b-02', quote: 'The method uses a polar coordinate transform for boundaries.' },
    { id: 'q-c3c3c3c3', page: 5, block: 'b-03', quote: 'We also test attention modules in the ablation.' },
  ],
  'p-th2': [
    { id: 'q-d4d4d4d4', page: 2, block: 'b-04', quote: 'Multicenter validation improves boundary Dice on REFUGE.' },
    { id: 'q-e5e5e5e5', page: 6, block: 'b-05', quote: 'Attention modules improve robustness across centers.' },
  ],
  'p-th3': [
    { id: 'q-f6f6f6f6', page: 2, block: 'b-06', quote: 'The lightweight network runs at 30 FPS on CPU.' },
  ],
}

for (const record of records) {
  upsert(record)
  writeCard({
    paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '概述。', evidence: [] }],
    evidence: decks[record.id].map((ev) => ({ ...ev, kind: 'author_claim', before: '', after: '' })),
    annotations: [], warnings: [], statusHistory: [],
  }, record)
}

writeDeepRead({
  paperId: 'p-th3',
  sections: [{
    key: 'conclusion', title: '结论',
    markdown: 'Mobile deployment matters for clinical use [[p-th3#^q-f6f6f6f6|Zhang 2023, p.2]].',
  }],
})

/* ---------- 研究读写 ---------- */
const theme = saveTheme({
  title: '视盘分割研究',
  description: '用于综述第二章，关注极坐标、临床验证与失败模式。',
  tags: ['分割'],
  facets: [
    { title: '极坐标变换', description: 'polar transform for boundaries', keywords: ['polar'] },
    { title: '临床验证', description: 'multicenter validation', keywords: ['multicenter'] },
    { title: '量子计算', description: 'quantum computing', keywords: [] },
  ],
})
assert.match(theme.id, /^t-[a-z0-9]{8}$/)
assert.deepEqual(theme.facets.map((facet) => facet.key), ['f1', 'f2', 'f3'])
assert.equal(theme.facets[0].mode, 'compare')
assert.equal(theme.facets[0].enabled, true)

const listed = listThemes()
assert.equal(listed.length, 1)
assert.equal(listed[0].title, '视盘分割研究')
assert.equal(listed[0].stats.facets, 3)

const updated = saveTheme({
  id: theme.id,
  title: '视盘分割研究 v2',
  facets: [
    { key: 'f1', title: '极坐标变换', description: 'polar transform', keywords: ['polar'] },
    { title: '注意力机制', description: 'attention modules', keywords: ['attention'] },
    { title: '量子计算', description: 'quantum computing', keywords: [] },
  ],
})
assert.equal(updated.facets[0].key, 'f1')
assert.equal(updated.facets[1].key, 'f2')
assert.equal(updated.facets[2].key, 'f3')
assert.equal(updated.title, '视盘分割研究 v2')
assert.equal(updated.facets.length, 3)

assert.throws(() => saveTheme({ title: '   ' }), (error) => error.code === 'empty_title')

/* ---------- 匹配 ---------- */
const t = readTheme(theme.id)
const polar = matchFacet(t, t.facets[0])
assert.equal(polar.gap, false)
assert.ok(polar.hits.length >= 1)
assert.ok(polar.hits.every((hit) => hit.quote.toLowerCase().includes('polar')))
assert.ok(polar.hits.filter((hit) => hit.paperId === 'p-th1').length <= 2)
assert.ok(polar.hits.every((hit) => /^q-[0-9a-f]{8}$/.test(hit.evidenceId)))

const quantum = matchFacet(t, { key: 'f9', title: '量子计算', description: 'quantum computing', keywords: [], mode: 'compare', enabled: true })
assert.equal(quantum.gap, true)
assert.equal(quantum.hits.length, 0)
assert.ok(quantum.reason.length > 0)

const mobile = matchFacet(t, { key: 'f8', title: 'mobile deployment', description: 'mobile deployment', keywords: [], mode: 'compare', enabled: true })
assert.ok(mobile.hits.some((hit) => hit.source === 'claim' && hit.evidenceId === 'q-f6f6f6f6'), '精读句子也应能命中')

/* ---------- 主题链候选 ---------- */
const first = themeChainDrafts(t)
assert.equal(first.drafts.length, 2)
assert.equal(first.gaps.length, 1)
assert.equal(first.gaps[0].facetKey, 'f3')
assert.equal(first.drafts[0].origin, 'topic')
assert.equal(first.drafts[0].provenance.themeId, t.id)
assert.equal(first.drafts[0].provenance.matcher, 'theme-match.v1')
assert.ok(first.drafts[0].nodes.every((node) => /^q-[0-9a-f]{8}$/.test(node.evidenceId)))
assert.ok(first.drafts[0].confidence > 0 && first.drafts[0].confidence <= 0.95)
assert.ok(first.drafts[0].warnings.some((text) => text.includes('只有 1 篇论文')))

const savedDraft = saveChain(first.drafts[0])
const savedSecond = saveChain(first.drafts[1])
assert.equal(savedDraft.status, 'draft')
assert.equal(themeChains(t.id).list.length, 2)

const rerun = themeChainDrafts(t)
const again = rerun.drafts.find((draft) => draft.provenance.facetKey === 'f1')
assert.equal(again.existingChainId, savedDraft.id)
const resaved = saveChain({ ...again, id: again.existingChainId })
assert.equal(resaved.id, savedDraft.id)
assert.equal(themeChains(t.id).list.length, 2, '重跑应原地更新而不是新增')

saveChain({ ...savedDraft, status: 'confirmed' })
const confirmedRun = themeChainDrafts(t)
const supplement = confirmedRun.drafts.find((draft) => draft.provenance.facetKey === 'f1')
assert.equal(supplement.existingChainId, undefined)
assert.ok(supplement.warnings.some((text) => text.includes('已有确认链')))
assert.equal(supplement.provenance.previousChainId, savedDraft.id)

/* ---------- 论文与统计 ---------- */
const stats = themeStats(readTheme(t.id))
assert.ok(stats.confirmed >= 1)
assert.ok(stats.drafts >= 1)
assert.ok(stats.papers >= 2)

const papers = themePapers(readTheme(t.id))
assert.ok(papers.some((row) => row.paperId === 'p-th1' && row.chainCount >= 1))
setThemePaper(t.id, { paperId: 'p-th1', action: 'exclude' })
const afterExclude = themePapers(readTheme(t.id))
assert.ok(!afterExclude.some((row) => row.paperId === 'p-th1'), '移出的论文不应出现')
setThemePaper(t.id, { paperId: 'p-th1', action: 'restore' })
assert.ok(themePapers(readTheme(t.id)).some((row) => row.paperId === 'p-th1'))

recordThemeMatch(t.id, [{ paperId: 'p-th2', score: 4.2, facets: ['f2'], hits: 2 }])
const matched = readTheme(t.id)
assert.equal(matched.papers.lastMatch.papers[0].paperId, 'p-th2')
assert.equal(matched.papers.lastMatch.papers[0].score, 4.2)
assert.equal(themeStats(matched).gaps, 1, '没有命中过且没有链的细分才算缺口')

/* ---------- 综合结论与提纲 ---------- */
const outline = buildThemeOutline(readTheme(t.id))
assert.ok(outline.markdown.startsWith('# 视盘分割研究 v2'))
assert.ok(outline.markdown.includes('## 极坐标变换'))
assert.ok(outline.markdown.includes('[[p-th1#^q-a1a1a1a1|'))
assert.ok(outline.missing.includes('注意力机制'), '未确认的细分描述应列入缺口')

const summary = buildThemeSummary(readTheme(t.id))
assert.ok(summary.text.includes('极坐标变换'))
assert.ok(summary.citations >= 1)

updateThemeSummary(t.id, { text: '手写结论', model: null })
assert.equal(readTheme(t.id).summary.text, '手写结论')

/* ---------- 删除 ---------- */
assert.equal(deleteTheme(t.id), true)
assert.equal(readTheme(t.id), null)
assert.equal(listThemes().length, 0)
assert.equal(deleteTheme('t-00000000'), false)

console.log('  ✓ 研究读写 / facet key 稳定')
console.log('  ✓ 匹配：关键词硬过滤 / 每篇上限 / 缺口 / 精读句命中')
console.log('  ✓ 主题链候选：q-id 锚定 / 幂等重跑 / confirmed 不覆盖')
console.log('  ✓ 论文增删 / lastMatch / 结论 / 提纲')
console.log('\n4 passed')
