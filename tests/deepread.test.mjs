/**
 * P4.9 精读：结构生成、claim 回贴 q-id、无证据标 unsupported。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-deep-'))

const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard, readCard } = await import('../lib/cards.js')
const { buildDeepRead, readDeepRead } = await import('../lib/deepread.js')
const { repairEvidenceBlocks } = await import('../lib/blocks.js')
const { ensureLibrary: ensure } = await import('../lib/library.js')

ensureLibrary()
const record = {
  id: 'p-deep0001', citekey: 'p-deep0001', title: 'Polar Glaucoma Segmentation',
  authors: 'Wu B.', year: 2026, venue: 'Journal', doi: '', type: '学术期刊', topics: [],
  status: '精读', file: 'p-deep0001.pdf', pages: 2, chars: 1000, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
writeCard({
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [
    { key: 'oneLine', title: '一句话', text: '提出极坐标方法。', evidence: [] },
    { key: 'method', title: '方法', text: '极坐标变换。', evidence: [] },
  ],
  evidence: [], annotations: [], warnings: [], statusHistory: [],
}, record)
const pages = {
  numPages: 2,
  pages: [
    { page: 1, text: 'Glaucoma segmentation is important. We propose a polar transform for the optic disc boundary.' },
    { page: 2, text: 'Experiments show that the polar transform improves boundary Dice to 0.95 on the public dataset compared with the baseline.' },
  ],
}
writeFileSync(join(PATHS.text, `${record.id}.pages.json`), JSON.stringify(pages), 'utf8')

const modelText = `## 文献基本资料

- 标题：Polar Glaucoma Segmentation
- 作者：Wu B.
- 期刊/会议：Journal
- 年份：2026
- DOI：原文未说明
- 类型：学术期刊

## 研究内容

研究极坐标变换是否改善视盘边界分割 [p.1]。

## 方法

先做极坐标展开，再做分割 [p.1]。

## 研究时间

原文未说明。

## 图表解析

主结果表显示边界 Dice 为 0.95 [p.2]。

## 结论

极坐标变换在该数据集上改善边界指标 [p.2]。

## 创新点

把极坐标变换用于视盘边界。

## 局限性

只在单一公开数据集上验证。

## 可复刻性

代码与数据公开情况原文未说明，预处理细节不足。

## 核心要点

- 极坐标变换改善边界 Dice 到 0.95 [p.2]。
- 需要更多数据集验证。`

const ctx = {
  get(name) {
    if (name === 'llm') {
      return {
        stream() {
          return (async function* () {
            yield { type: 'text-delta', text: modelText }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    }
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake' }) }
    return undefined
  },
}

let passed = 0
const pending = []
function test(name, fn) { pending.push({ name, fn }) }

test('精读生成：11 板块 Markdown，缺项补说明', async () => {
  const saved = await buildDeepRead({ ctx, record })
  assert.equal(saved.sections.length, 11)
  assert.equal(saved.sections[0].title, '文献基本资料')
  assert.equal(saved.sections[10].title, '核心要点')
  const sample = saved.sections.find((section) => section.key === 'sample')
  assert.equal(sample.markdown, '原文未说明。')
  assert.ok(saved.markdown.includes('## 4. 样本量'))
  assert.ok(saved.markdown.includes('[[p-deep0001#^q-'))
  assert.ok(!saved.markdown.includes('"claims"'))
  assert.ok(saved.numbers.length > 0)
  const number = saved.numbers.find((item) => item.value === '0.95')
  assert.ok(number)
  assert.equal(number.verified, true)
  assert.equal(number.page, 2)
  assert.ok(number.evidenceId)
})

test('证据块回贴：无 block 的证据按引文回贴到版面块', () => {
  const card = { evidence: [{ id: 'q-block1', page: 2, quote: 'improves boundary Dice to 0.95 on the public dataset' }] }
  const doc = { pages: [{ page: 2, blocks: [{ id: 'b-1', text: 'improves boundary Dice to 0.95 on the public dataset compared with baseline' }] }] }
  assert.equal(repairEvidenceBlocks(card, doc), true)
  assert.equal(card.evidence[0].block, 'b-1')
})

test('精读落盘可读，重复读取不重新调用', async () => {
  const saved = readDeepRead(record.id)
  assert.ok(saved)
  assert.equal(saved.promptVersion, 'deep-read.v1')
  assert.ok(saved.generatedAt)
  assert.equal(saved.sections.length, 11)
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
