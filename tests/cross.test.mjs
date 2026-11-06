/** P1 跨论文自动链：claim 相似度、关系判断、两侧证据锚定。 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-cross-'))
const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain } = await import('../lib/chains.js')
const { autoCrossPaperDrafts, crossRelation, claimSimilarity } = await import('../lib/chain-cross.js')
ensureLibrary()
const papers = [
  { id: 'p-x1', title: '极坐标视盘分割', authors: 'Wu B.', year: 2024, topics: ['视盘分割'] },
  { id: 'p-x2', title: '极坐标多中心验证', authors: 'Li C.', year: 2025, topics: ['视盘分割'] },
  { id: 'p-x3', title: '极坐标小样本研究', authors: 'Zhao D.', year: 2025, topics: ['视盘分割'] },
]
const claims = {
  'p-x1': '极坐标变换改善视盘边界分割，Dice 达到 0.95。',
  'p-x2': '极坐标变换在 REFUGE 上改善视盘边界分割。',
  'p-x3': '极坐标变换仅在小样本上有效，Dice 为 0.80。',
}
for (let i = 0; i < papers.length; i += 1) {
  const rec = { ...papers[i], citekey: papers[i].id, venue: 'Journal', doi: '', type: '学术期刊', status: '精读', file: `${papers[i].id}.pdf`, pages: 5, chars: 1000, quality: 0.9, added: new Date().toISOString() }
  upsert(rec)
  const qid = `q-${String(i + 1).repeat(8)}`
  writeCard({
    paperId: rec.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '方法。', evidence: [] }],
    evidence: [{ id: qid, page: 5, block: 'b-1', quote: claims[rec.id], kind: 'author_claim' }],
    annotations: [], warnings: [], statusHistory: [],
  }, rec)
  writeFileSync(join(PATHS.deepread, `${rec.id}.json`), JSON.stringify({
    paperId: rec.id, markdown: '', numbers: [], evidence: [],
    sections: [{ key: 'conclusion', title: '结论', index: 7, markdown: `${claims[rec.id].replace(/。$/, '')} [[${rec.id}#^${qid}|p.5]]。` }],
  }), 'utf8')
}
assert.ok(claimSimilarity(claims['p-x1'], claims['p-x2']) > 0.18)
assert.equal(crossRelation(claims['p-x1'], claims['p-x3']), 'compares')
assert.equal(crossRelation(claims['p-x1'], claims['p-x2']), 'supports')

const result = autoCrossPaperDrafts({ minSimilarity: 0.12 })
assert.ok(result.papers.length === 3)
assert.ok(result.scanned >= 3)
assert.ok(result.drafts.length >= 2)
const draft = result.drafts[0]
assert.equal(draft.origin, 'auto')
assert.equal(draft.status, 'draft')
assert.equal(draft.paperIds.length, 2)
assert.ok(draft.nodes.length >= 2)
assert.ok(draft.nodes.every((node) => /^q-[0-9a-f]{8}$/.test(node.evidenceId)))
assert.ok(draft.provenance.kind === 'cross-paper')
assert.ok(['supports', 'contradicts', 'qualifies', 'compares'].includes(draft.provenance.relation))
assert.ok(draft.warnings.some((item) => item.includes('人工确认')))

const strong = autoCrossPaperDrafts({ minSimilarity: 0.99 })
assert.ok(strong.drafts.length >= 1, '字面不相似也应能按主题强配对')
assert.ok(strong.drafts.some((item) => item.provenance.strongPair?.kind === 'topic'))
assert.ok(strong.drafts.every((item) => item.provenance.relation === 'compares' || item.provenance.relation === 'qualifies' || item.provenance.relation === 'contradicts'))

saveChain({ ...draft })
const again = autoCrossPaperDrafts({ minSimilarity: 0.12 })
assert.ok(!again.drafts.some((item) => item.provenance.claims[0]?.text === draft.provenance.claims[0]?.text && item.provenance.claims[1]?.text === draft.provenance.claims[1]?.text))
console.log('  ✓ 跨论文 claim 相似度/关系判断')
console.log('  ✓ 双侧 q-id 锚定 + 合成 claim')
console.log('  ✓ 已有跨论文链去重')
console.log('\n3 passed')
