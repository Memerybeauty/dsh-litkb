/** P4.11 30 篇规模回归：BM25 检索 + 链答案在 30 篇/300 证据下可用。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-scale-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain } = await import('../lib/chains.js')
const { searchLibrary } = await import('../lib/search.js')
const { answerQuestion } = await import('../lib/answer.js')
ensureLibrary()
const topics = ['视盘分割', '多模态情绪', '医学融合', '检索增强']
const created = []
for (let i = 0; i < 30; i += 1) {
  const id = `p-scale${String(i).padStart(2, '0')}`
  const record = {
    id,
    citekey: id,
    title: `${topics[i % topics.length]}研究 ${i}`,
    authors: `Author ${i}`,
    year: 2020 + (i % 6),
    venue: 'Journal',
    doi: '',
    type: '学术期刊',
    topics: [topics[i % topics.length]],
    status: '精读',
    file: `${id}.pdf`,
    pages: 5,
    chars: 1000,
    quality: 0.9,
    added: new Date().toISOString(),
  }
  upsert(record)
  const evidence = Array.from({ length: 10 }, (_, j) => ({
    id: `q-${i.toString(16).padStart(2, '0')}${j.toString(16).padStart(2, '0')}a1b2`,
    page: 1 + (j % 5),
    block: `b-${j}`,
    quote: `${topics[i % topics.length]} method ${i} reports improvement number ${j} on dataset ${i % 4}.`,
    kind: 'author_claim',
  }))
  writeCard(
    {
      paperId: id,
      status: 'ready',
      model: 'fake',
      generatedAt: new Date().toISOString(),
      sections: [{ key: 'oneLine', title: '一句话', text: `${topics[i % topics.length]}。`, evidence: [] }],
      evidence,
      annotations: [],
      warnings: [],
      statusHistory: [],
    },
    record,
  )
  saveChain({
    title: `${topics[i % topics.length]}链 ${i}`,
    claim: { text: `${topics[i % topics.length]}方法 ${i} 改善结果。`, paperId: id, source: 'manual' },
    origin: 'claim',
    status: 'confirmed',
    nodes: [
      {
        paperId: id,
        evidenceId: evidence[0].id,
        page: evidence[0].page,
        block: evidence[0].block,
        quote: evidence[0].quote,
        relation: 'supports',
      },
    ],
  })
  created.push(id)
}
assert.equal(created.length, 30)
const started = Date.now()
const hit = searchLibrary('视盘分割 改善', { limit: 12 })
const elapsed = Date.now() - started
assert.ok(hit.evidence.length >= 1)
assert.ok(hit.chains.length >= 1)
assert.ok(elapsed < 1500, `检索耗时 ${elapsed}ms`)
const answer = await answerQuestion({ ctx: null, question: '视盘分割有什么改善？', limit: 8 })
assert.equal(answer.mode, 'extractive')
assert.ok(answer.citations.length >= 1)
assert.ok(answer.answer.includes('[['))
console.log(`  ✓ 30 篇/300 证据检索 ${elapsed}ms`)
console.log('  ✓ 30 篇规模链答案带引用')
console.log('\n2 passed')
