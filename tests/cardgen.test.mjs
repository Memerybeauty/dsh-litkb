/**
 * 七段卡生成：模型参数与截断重试（不联网）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离用户库的 settings.json：固定模型配置会让 resolveRoute 覆盖 fake ctx。
process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-cardgen-'))
const { applySection, generateCard, generateCardSection } = await import('../lib/cardgen.js')

let passed = 0
const pending = []
function test(name, fn) {
  pending.push({ name, fn })
}

const pages = [
  { page: 1, text: '摘要 本文提出一种方法，在 REFUGE 上 Dice 为 0.96。\n1 引言\n研究背景介绍。' },
  { page: 2, text: '2 方法\n方法细节描述。\n3 结果\n结果数字描述。' },
]

const cardJson = JSON.stringify({
  oneLine: { text: '提出方法。', quotes: [] },
  problem: { text: '问题。', quotes: [] },
  method: { text: '方法。', quotes: [] },
  data: { text: '数据。', quotes: [] },
  results: { text: '结果。', quotes: [] },
  limits: { text: '作者：无。\n我：无。', quotes: [] },
  relevance: { text: '相关。', quotes: [] },
})

function fakeCtx(calls, script) {
  let index = 0
  return {
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [],
          stream(options) {
            calls.push(options)
            const step = script[Math.min(index, script.length - 1)]
            index += 1
            return (async function* () {
              for (const chunk of step) yield chunk
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      }
      return undefined
    },
  }
}

const record = { id: 'p-test', title: '测试论文', chars: 100, quality: 0.9, topics: [] }

test('生成参数：关闭思考 + 8192 输出上限', async () => {
  const calls = []
  const ctx = fakeCtx(calls, [
    [
      { type: 'text-delta', text: cardJson },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ])
  const card = await generateCard({ ctx, record, pages })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].reasoningEffort, 'off')
  assert.equal(calls[0].maxTokens, 8192)
  assert.equal(card.promptVersion, 'seven-sections.v2')
})

test('第一次 max-tokens 截断：自动用紧凑提示重试一次', async () => {
  const calls = []
  const ctx = fakeCtx(calls, [
    [
      { type: 'text-delta', text: '{"oneLine":{"text":"半截' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ],
    [
      { type: 'text-delta', text: cardJson },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ])
  const card = await generateCard({ ctx, record, pages })
  assert.equal(calls.length, 2)
  assert.ok(calls[1].messages[0].content[0].text.includes('输出限制'))
  assert.equal(card.sections.length, 7)
})

test('单段重生成：只替换该段与证据，其他段不动', async () => {
  const sectionPages = [
    { page: 1, text: '摘要 本文提出一种方法。' },
    { page: 2, text: '2 方法\n方法细节描述，包含两个阶段。' },
    { page: 3, text: '3 结果\n结果描述。' },
  ]
  const output = JSON.stringify({
    text: '新方法描述，分为两阶段。',
    quotes: [{ quote: '方法细节描述，包含两个阶段', page: 2 }],
  })
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          listProviders: () => [],
          stream(options) {
            calls.push(options)
            return (async function* () {
              yield { type: 'text-delta', text: output }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'm' }) }
      return undefined
    },
  }
  const patch = await generateCardSection({ ctx, record, pages: sectionPages, key: 'method' })
  assert.equal(patch.text, '新方法描述，分为两阶段。')
  assert.equal(patch.evidence.length, 1)

  const card = {
    sections: [
      { key: 'oneLine', title: '一句话', text: '旧一句话', evidence: [] },
      { key: 'method', title: '方法', text: '旧方法', evidence: ['q-old'] },
    ],
    evidence: [{ id: 'q-old', page: 2, quote: '旧引文' }],
    warnings: [],
    status: 'partial',
  }
  applySection(card, patch, '方法')
  assert.equal(card.sections.find((x) => x.key === 'method').text, '新方法描述，分为两阶段。')
  assert.equal(card.sections.find((x) => x.key === 'oneLine').text, '旧一句话')
  assert.equal(
    card.evidence.some((e) => e.id === 'q-old'),
    false,
    '旧证据应被清理',
  )
  assert.equal(card.sections.find((x) => x.key === 'method').evidence.length, 1)
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
