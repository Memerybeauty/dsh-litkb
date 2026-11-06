/**
 * P3 划词追问：材料组装、页码白名单、越界提示、存批注。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-ask-'))

const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { askPaper, buildAskContext, mentionsPaper, validateAnswer } = await import('../lib/ask.js')

ensureLibrary()
const record = {
  id: 'p-aaaaaaaa', citekey: 'p-aaaaaaaa', title: 'CA-UNet for Glaucoma', authors: '',
  year: 2024, type: '学术期刊', topics: [], status: '精读', file: 'p-aaaaaaaa.pdf',
  pages: 6, chars: 2000, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
const card = {
  paperId: record.id, status: 'ready',
  sections: [{ key: 'method', title: '方法', text: '用 Coordinate Attention 改进 U-Net。', evidence: ['q-11111111'] }],
  evidence: [{ id: 'q-11111111', page: 3, quote: 'We propose Coordinate Attention to improve U-Net.', block: 'b-1' }],
  annotations: [],
}
writeCard(card, record)
const blocks = {
  pages: [{
    page: 3,
    blocks: [
      { id: 'b-1', text: 'We propose Coordinate Attention to improve U-Net.' },
      { id: 'b-2', text: 'It is evaluated on REFUGE.' },
    ],
  }],
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

test('材料组装：选中段 + 同页上下文 + 卡片 + 证据都带页码', () => {
  const context = buildAskContext({
    record, card, blocks, question: '它和 baseline 差在哪？',
    selection: 'Coordinate Attention', page: 3, blockId: 'b-1', records: [],
  })
  assert.ok(context.pages.has(3))
  assert.ok(context.text.includes('[p.3] Coordinate Attention'))
  assert.ok(context.text.includes('【原文上下文】'))
  assert.ok(context.text.includes('【七段卡】'))
  assert.ok(context.text.includes('【证据】'))
  assert.ok(context.text.includes('q-11111111'))
})

test('页码白名单：越界页码不进 citations，并给警告', () => {
  const context = buildAskContext({
    record, card, blocks, question: '它和 baseline 差在哪？',
    selection: 'Coordinate Attention', page: 3, blockId: 'b-1', records: [],
  })
  const checked = validateAnswer({
    text: '它用注意力改进 U-Net [p.3]。在 REFUGE 上评测 [p.5]。',
    pages: context.pages,
    snippets: context.snippets,
  })
  assert.deepEqual(checked.citedPages, [3])
  assert.deepEqual(checked.invalidCitations, [5])
  assert.ok(checked.warnings.some((w) => w.includes('不在本次材料内')))
  assert.equal(checked.citations.length, 1)
  assert.ok(checked.citations[0].snippets.length > 0)
})

test('没有页码时警告；明确说没有依据时不警告', () => {
  const context = buildAskContext({
    record, card, blocks, question: '它和 baseline 差在哪？',
    selection: 'Coordinate Attention', page: 3, blockId: 'b-1', records: [],
  })
  const bare = validateAnswer({ text: '它更好。', pages: context.pages, snippets: context.snippets })
  assert.ok(bare.warnings.includes('回答未标注页码'))
  const noBasis = validateAnswer({ text: '原文没有足够依据。', pages: context.pages, snippets: context.snippets })
  assert.ok(!noBasis.warnings.includes('回答未标注页码'))
})

test('点名另一篇：加入它的卡片材料，最多 2 篇', () => {
  const otherRecord = { ...record, id: 'p-bbbbbbbb', citekey: 'p-bbbbbbbb', title: 'M-Net for Segmentation' }
  const otherCard = {
    paperId: otherRecord.id, status: 'ready',
    sections: [{ key: 'method', title: '方法', text: 'M-Net 使用多尺度输入。', evidence: ['q-22222222'] }],
    evidence: [{ id: 'q-22222222', page: 2, quote: 'M-Net uses multi-scale input.', block: 'b-9' }],
  }
  assert.equal(mentionsPaper('它和 M-Net for Segmentation 差在哪？', otherRecord), true)
  const context = buildAskContext({
    record, card, blocks, question: '它和 M-Net for Segmentation 差在哪？',
    selection: 'Coordinate Attention', page: 3, blockId: 'b-1',
    records: [otherRecord, { ...otherRecord, id: 'p-x', title: 'M-Net for Segmentation', card: otherCard }],
  })
  assert.ok(context.text.includes('【对比材料：M-Net for Segmentation'))
})

test('askPaper：模型回答带页码，返回 model/pagesUsed', async () => {
  const ctx = fakeCtx('它用注意力改进 U-Net [p.3]。')
  const result = await askPaper({
    ctx, record, card, blocks, question: '它和 baseline 差在哪？',
    selection: 'Coordinate Attention', page: 3, blockId: 'b-1', records: [],
  })
  assert.equal(result.answer.includes('[p.3]'), true)
  assert.deepEqual(result.pagesUsed, [3])
  assert.equal(result.model, 'fake/fake')
  assert.equal(ctx.calls(), 1)
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
