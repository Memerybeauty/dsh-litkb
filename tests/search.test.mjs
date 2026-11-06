/** P4.11 检索：BM25 召回证据与链，过滤与中文分词。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-search-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain } = await import('../lib/chains.js')
const { searchLibrary, tokenize } = await import('../lib/search.js')

ensureLibrary()
const papers = [
  { id: 'p-s1', citekey: 'p-s1', title: '极坐标变换与视盘边界分割', authors: 'Wu B.', year: 2024, venue: 'Journal', doi: '', type: '学术期刊', topics: ['分割'], status: '精读', file: 'p-s1.pdf', pages: 5, chars: 1000, quality: 0.9, added: new Date().toISOString() },
  { id: 'p-s2', citekey: 'p-s2', title: '多中心视盘分割验证', authors: 'Li C.', year: 2025, venue: 'Conference', doi: '', type: '会议', topics: ['分割', '验证'], status: '精读', file: 'p-s2.pdf', pages: 5, chars: 1000, quality: 0.9, added: new Date().toISOString() },
]
for (const paper of papers) {
  upsert(paper)
  writeCard({
    paperId: paper.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '方法。', evidence: [] }],
    evidence: paper.id === 'p-s1'
      ? [{ id: 'q-11111111', page: 5, block: 'b-1', quote: 'We propose a polar transform that improves optic disc boundary segmentation.', kind: 'author_claim' }]
      : [{ id: 'q-22222222', page: 4, block: 'b-2', quote: 'The polar method also improves Dice on a multi-center dataset.', kind: 'author_claim' }],
    annotations: [], warnings: [], statusHistory: [],
  }, paper)
}

saveChain({
  title: '极坐标改善视盘边界',
  claim: { text: '极坐标变换改善视盘边界分割。', paperId: 'p-s1', source: 'manual' },
  origin: 'claim', status: 'confirmed',
  nodes: [{ paperId: 'p-s1', evidenceId: 'q-11111111', page: 5, block: 'b-1', quote: 'We propose a polar transform that improves optic disc boundary segmentation.', relation: 'supports' }],
})

const tokens = tokenize('极坐标 视盘边界 Dice')
assert.ok(tokens.includes('dice'))
assert.ok(tokens.some((token) => token.includes('极坐标') || token === '极坐' || token === '坐标'))
assert.ok(tokens.some((token) => token.includes('视盘') || token === '视盘' || token === '盘边'))

const hit = searchLibrary('极坐标 视盘边界')
assert.ok(hit.chains.length >= 1)
assert.equal(hit.chains[0].title, '极坐标改善视盘边界')
assert.ok(hit.evidence.length >= 1)
assert.ok(hit.evidence.some((item) => item.evidenceId === 'q-11111111'))
assert.ok(hit.chains[0].citations[0].evidenceId === 'q-11111111')
assert.ok(hit.took >= 0)

const english = searchLibrary('Dice multi-center')
assert.ok(english.evidence.some((item) => item.evidenceId === 'q-22222222'))

const filtered = searchLibrary('polar', { paperId: 'p-s1' })
assert.ok(filtered.evidence.every((item) => item.paperId === 'p-s1'))
assert.ok(filtered.chains.every((chain) => chain.paperIds.includes('p-s1')))

const noHit = searchLibrary('量子引力')
assert.equal(noHit.chains.length, 0)
assert.equal(noHit.evidence.length, 0)
console.log('  ✓ BM25：中文/英文召回')
console.log('  ✓ 链/证据聚合与引用节点')
console.log('  ✓ 论文过滤与空结果')
console.log('\n3 passed')
