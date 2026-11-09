/**
 * P2.3 翻译：范围选择、校验、缓存与任务链路（不联网）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-translate-'))

const { ensureLibrary } = await import('../lib/library.js')
ensureLibrary()
const { blocksPath } = await import('../lib/blocks.js')
const { translateDocument, selectBlocks, validateBlock } = await import('../lib/translate.js')
const { checkTermTargets, glossaryHash, DEFAULT_TERMS, readGlossary, writeGlossary } =
  await import('../lib/glossary.js')
const { translationPath, readTranslation } = await import('../lib/translate.js')

let passed = 0
const pending = []
function test(name, fn) {
  pending.push({ name, fn })
}

const DOC = {
  schema: 1,
  parser: 'test',
  pages: [
    {
      page: 1,
      width: 100,
      height: 100,
      blocks: [
        { id: 'b-a', role: 'abstract', section: 'abstract', text: 'This paper proposes a method. Accuracy is 90%.' },
        { id: 'b-m', role: 'paragraph', section: 'method', text: 'The method uses two stages and a loss weight 0.01.' },
      ],
    },
    {
      page: 2,
      width: 100,
      height: 100,
      blocks: [
        { id: 'b-r', role: 'paragraph', section: 'results', text: 'Results show a score of 86.5 on the test set.' },
        { id: 'b-c', role: 'paragraph', section: 'conclusion', text: '本章总结全文，并提出未来工作。' },
        { id: 'b-ref', role: 'reference', section: 'references', text: 'Zhang et al. 2024.' },
      ],
    },
  ],
}

writeFileSync(blocksPath('p-t'), JSON.stringify(DOC))

function fakeCtx() {
  return {
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [],
          stream(options) {
            const input = JSON.parse(options.messages[0].content[0].text)
            const output = input.map((item) => ({ i: item.i, text: `译文：${item.text}` }))
            return (async function* () {
              yield { type: 'text-delta', text: JSON.stringify(output) }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'm' }) }
      return undefined
    },
  }
}

test('范围选择：摘要+结论 / 章节 / 整篇 / 单块', () => {
  assert.deepEqual(
    selectBlocks(DOC, { scope: 'summary' }).map((b) => b.id),
    ['b-a', 'b-c'],
  )
  assert.deepEqual(
    selectBlocks(DOC, { scope: 'section', section: 'method' }).map((b) => b.id),
    ['b-m'],
  )
  assert.deepEqual(
    selectBlocks(DOC, { scope: 'paper' }).map((b) => b.id),
    ['b-a', 'b-m', 'b-r', 'b-c'],
  )
  assert.deepEqual(
    selectBlocks(DOC, { scope: 'block', blockIds: ['b-r'] }).map((b) => b.id),
    ['b-r'],
  )
})

test('译后校验：数字/引用保留、空译文、术语', () => {
  assert.equal(validateBlock('Accuracy 90% and [12].', '准确率 90%，见 [12]。', []).ok, true)
  const bad = validateBlock('Accuracy 90%.', '准确率很高。', [])
  assert.equal(bad.ok, false)
  assert.ok(bad.issues.some((x) => x.includes('90%')))
  assert.equal(validateBlock('x', '', []).ok, false)
  const missing = checkTermTargets('on REFUGE', '在 REFUGE 上', [{ source: 'REFUGE', target: 'REFUGE 数据集' }])
  assert.equal(missing.length, 1)
  assert.equal(glossaryHash(DEFAULT_TERMS), glossaryHash(DEFAULT_TERMS))
})

test('translateDocument：摘要+结论，中文块跳过，落盘可读', async () => {
  const result = await translateDocument({
    ctx: fakeCtx(),
    record: { id: 'p-t' },
    params: { scope: 'summary' },
    force: true,
  })
  assert.equal(result.doc.paperId, 'p-t')
  assert.equal(result.doc.blocks['b-a'].status, 'ok')
  assert.ok(result.doc.blocks['b-a'].text.includes('90%'))
  assert.equal(result.doc.blocks['b-c'].status, 'skipped')
  assert.equal(readTranslation('p-t').blocks['b-a'].status, 'ok')
  assert.ok(translationPath('p-t').endsWith('p-t.zh.json'))
})

test('translateDocument：整篇排除参考文献；失败范围显式报错', async () => {
  const result = await translateDocument({
    ctx: fakeCtx(),
    record: { id: 'p-t' },
    params: { scope: 'paper' },
    force: true,
  })
  assert.equal(result.doc.blocks['b-m'].status, 'ok')
  assert.equal(result.doc.blocks['b-r'].status, 'ok')
  assert.equal(result.doc.blocks['b-ref'], undefined)
  await assert.rejects(
    () =>
      translateDocument({
        ctx: fakeCtx(),
        record: { id: 'p-t' },
        params: { scope: 'section', section: 'nope' },
        force: true,
      }),
    /没有可翻译的块/,
  )
})

test('术语表变更：其他块旧译文标 stale，不删除', async () => {
  const original = readGlossary().terms
  try {
    writeGlossary([...original, { source: 'NewTermX', target: '新术语' }])
    const result = await translateDocument({
      ctx: fakeCtx(),
      record: { id: 'p-t' },
      params: { scope: 'summary' },
      force: false,
    })
    assert.equal(result.doc.blocks['b-m'].status, 'stale')
    assert.ok(result.doc.blocks['b-m'].text, '旧译文不应被删除')
    assert.equal(result.doc.blocks['b-a'].status, 'ok')
  } finally {
    writeGlossary(original)
  }
})

for (const item of pending) {
  try {
    await item.fn()
    passed += 1
    console.log(`  ✓ ${item.name}`)
  } catch (error) {
    console.error(`  ✗ ${item.name}\n    ${error?.message || error}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed} passed`)
