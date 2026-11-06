/** P4.11 链优先问答：无模型时抽取式答案也必须带 q-id。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-answer-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain } = await import('../lib/chains.js')
const { answerQuestion } = await import('../lib/answer.js')

ensureLibrary()
const record = {
  id: 'p-a1', citekey: 'p-a1', title: '极坐标视盘分割', authors: 'Wu B.', year: 2024,
  venue: 'Journal', doi: '', type: '学术期刊', topics: ['分割'], status: '精读',
  file: 'p-a1.pdf', pages: 5, chars: 900, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
writeCard({
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '方法。', evidence: [] }],
  evidence: [
    { id: 'q-abc12345', page: 5, block: 'b-1', quote: 'Polar transform improves the optic disc boundary Dice.', kind: 'author_claim' },
  ],
  annotations: [], warnings: [], statusHistory: [],
}, record)
saveChain({
  title: '极坐标改善边界',
  claim: { text: '极坐标变换改善视盘边界。', paperId: record.id, source: 'manual' },
  origin: 'claim', status: 'confirmed',
  nodes: [{ paperId: record.id, evidenceId: 'q-abc12345', page: 5, block: 'b-1', quote: 'Polar transform improves the optic disc boundary Dice.', relation: 'supports' }],
})

const answer = await answerQuestion({ ctx: null, question: '极坐标 视盘边界 效果' })
assert.equal(answer.mode, 'extractive')
assert.ok(answer.answer.includes('q-abc12345') || answer.answer.includes('极坐标'))
assert.ok(answer.citations.some((item) => item.evidenceId === 'q-abc12345' && item.page === 5))
assert.ok(answer.chains.length >= 1)
assert.ok(answer.trace.length >= 1)
assert.ok(answer.answer.includes('[[p-a1#^q-abc12345|Wu B. 2024, p.5]]'))
assert.ok(answer.warnings.some((item) => item.includes('没有可用模型')))

await assert.rejects(() => answerQuestion({ ctx: null, question: ' ' }), /请先输入问题/)
const none = await answerQuestion({ ctx: null, question: '量子引力' })
assert.equal(none.mode, 'extractive')
assert.ok(none.answer.includes('不足以回答'))
console.log('  ✓ 无模型：抽取式答案 + 引用')
console.log('  ✓ 空问题/无证据降级')
console.log('\n2 passed')
