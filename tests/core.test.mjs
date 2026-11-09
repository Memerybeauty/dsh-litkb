/**
 * P2.1 核心单测（不依赖宿主）：分页文本 → 章节 → 证据 → 卡片。
 * 运行：node tests/core.test.mjs
 */
import assert from 'node:assert/strict'
import { tidyLine } from '../lib/pdftext.js'
import { classifyTitle, detectBoundary, matchHeading, splitSections } from '../lib/sections.js'
import { buildPageIndex, locateQuote, normalizeForMatch, quoteId } from '../lib/evidence.js'
import { buildPaperInput, normalizeCard, parseModelJson, SECTION_DEFS } from '../lib/cardgen.js'
import { renderCardMarkdown } from '../lib/cards.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error?.message || error}`)
    process.exitCode = 1
  }
}

/* ---------------- 分页文本 ---------------- */

test('tidyLine 合回中文逐字空格与标点两侧空隙', () => {
  assert.equal(tidyLine('面 向 客 服 机 器 人'), '面向客服机器人')
  assert.equal(tidyLine('准 确 率 90% ， 精 确 率 86%'), '准确率 90%，精确率 86%')
  assert.equal(tidyLine('Deep  Learning  model'), 'Deep Learning model')
})

/* ---------------- 标题识别 ---------------- */

test('整行标题与编号标题', () => {
  assert.equal(matchHeading('3.2 方法')?.key, 'method')
  assert.equal(matchHeading('参考文献')?.key, 'references')
  assert.equal(detectBoundary('2 系统总体设计')?.key, 'method')
  assert.equal(detectBoundary('4.3.1 对比试验')?.key, 'results')
  assert.equal(detectBoundary('5 结论')?.key, 'conclusion')
})

test('行首内联标题：摘要/关键词与正文挤在同一行', () => {
  const abs = detectBoundary('摘要针对医疗投诉增多与人工客服响应慢的问题，本文构建了一种系统。')
  assert.equal(abs?.key, 'abstract')
  assert.equal(abs?.inline, true)
  assert.ok(abs.rest.startsWith('针对'))
  const kw = detectBoundary('关键词医疗服务；多模态情绪识别；深度学习')
  assert.equal(kw?.key, 'keywords')
})

test('目录行、年份页眉、图题、表格行不当作标题', () => {
  assert.equal(detectBoundary('参考文献 ................................ 45'), null)
  assert.equal(detectBoundary('2026 年福建电脑 17'), null)
  assert.equal(detectBoundary('图 2 WavLM 结构图'), null)
  assert.equal(detectBoundary('2 [68]'), null)
  assert.equal(detectBoundary('章虹：面向医疗场景的多模态情绪识别及应对研究第 2 期'), null)
  assert.equal(detectBoundary('P R'), null)
})

test('classifyTitle 归章', () => {
  assert.equal(classifyTitle('核心模型与方法'), 'method')
  assert.equal(classifyTitle('实验结果及分析'), 'results')
  assert.equal(classifyTitle('研究背景及意义'), 'intro')
  assert.equal(classifyTitle('未来的工作'), null)
})

/* ---------------- 章节切分 ---------------- */

const PAGES = [
  {
    page: 1,
    text: [
      '面向医疗场景的多模态情绪识别及应对研究',
      '摘要针对医疗投诉增多的问题，本文构建了一种多模态系统，融合 WavLM 与 BERT。',
      '关键词医疗服务；多模态情绪识别；深度学习',
      '1 引言',
      '随着医疗行业的发展，投诉处理成为难题。',
    ].join('\n'),
  },
  {
    page: 2,
    text: [
      '本文的主要工作包括三个方面。',
      '2 系统总体设计',
      '系统包括数据接入、情绪识别、策略响应四个环节。',
      '2.1 系统设计目标',
      '目标是提升处理效率并降低人工成本。',
    ].join('\n'),
  },
  {
    page: 3,
    text: [
      '3 核心模型与方法',
      '语音通道采用 WavLM 提取声学特征，文本通道采用 BERT。',
      '4 实验与结果',
      '在自建数据集上准确率达到 90%，F1 超过 86%。',
      '5 结论',
      '本文提出的系统在真实场景中有效，准确率接近 90%。',
      '参考文献',
      '[1] 张三. 多模态情绪识别[J]. 福建电脑, 2026.',
    ].join('\n'),
  },
]

test('splitSections 切出有序章节并保留页码', () => {
  const { sections, detected } = splitSections(PAGES)
  assert.ok(detected >= 5)
  const keys = sections.map((s) => s.key)
  for (const key of ['abstract', 'intro', 'method', 'results', 'conclusion', 'references']) {
    assert.ok(keys.includes(key), `缺少章节 ${key}: ${keys.join(',')}`)
  }
  const method = sections.find((s) => s.key === 'method')
  assert.equal(method.startPage, 2)
  assert.ok(method.parts.some((p) => p.page === 2))
  assert.ok(method.text.includes('WavLM'))
  const order = sections.map((s) => s.startPage)
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  )
})

test('无标题正文退化为全文，不丢内容', () => {
  const pages = [{ page: 1, text: '这是一段没有任何标题的连续正文。'.repeat(20) }]
  const { sections } = splitSections(pages)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].key, 'full')
  assert.ok(sections[0].text.includes('连续正文'))
})

/* ---------------- 证据定位 ---------------- */

test('locateQuote 在逐字空格的中文原文里定位并返回原文切片', () => {
  const pages = [
    { page: 1, text: '摘 要 本 文 提 出 一 种 多 模 态 方 法 ， 在 REFUGE 上 Dice 为 0.96 。' },
    { page: 2, text: '实 验 表 明 该 方 法 在 真 实 场 景 中 有 效 。' },
  ]
  const index = buildPageIndex(pages)
  const hit = locateQuote('本文提出一种多模态方法', index)
  assert.ok(hit)
  assert.equal(hit.page, 1)
  assert.equal(normalizeForMatch(hit.quote), '本文提出一种多模态方法')
  const second = locateQuote('实验表明该方法在真实场景中有效', index, 1)
  assert.equal(second.page, 2)
  assert.equal(locateQuote('这句话原文里根本没有出现过', index), null)
})

test('quoteId 稳定且同引文同 ID', () => {
  const a = quoteId('本文提出一种多模态方法')
  const b = quoteId('本 文 提 出 一 种 多 模 态 方 法')
  assert.equal(a, b)
  assert.match(a, /^q-[0-9a-f]{8}$/)
})

/* ---------------- 模型输出 ---------------- */

test('parseModelJson 容忍代码块、前后解释与尾逗号', () => {
  assert.deepEqual(parseModelJson('```json\n{"a": 1,}\n```'), { a: 1 })
  assert.deepEqual(parseModelJson('好的，结果如下：{"a": {"b": 2}} 以上。'), { a: { b: 2 } })
  assert.throws(() => parseModelJson('没有 JSON'), /JSON/)
})

test('normalizeCard 只保留可核验引文，缺段降级为 partial', () => {
  const pages = [
    { page: 1, text: '本 文 提 出 一 种 多 模 态 方 法 ， 在 REFUGE 上 Dice 为 0.96 。' },
    { page: 2, text: '实 验 表 明 该 方 法 在 真 实 场 景 中 有 效 。' },
  ]
  const parsed = {
    oneLine: { text: '提出多模态方法并在 REFUGE 上验证。', quotes: [{ quote: '本文提出一种多模态方法', page: 1 }] },
    problem: { text: '', quotes: [] },
    method: { text: '融合语音与文本。', quotes: [{ quote: '原文里没有这句', page: 2 }] },
    data: { text: '自建数据集。', quotes: [] },
    results: { text: 'Dice 0.96。', quotes: [{ quote: '在 REFUGE 上 Dice 为 0.96', page: 1 }] },
    limits: { text: '作者：未做外部验证。\n我：依赖标注质量。', quotes: [] },
    relevance: { text: '可作 baseline。', quotes: [] },
  }
  const card = normalizeCard({
    parsed,
    record: { id: 'p-test', title: '测试论文', chars: 120, quality: 0.9, topics: [] },
    pages,
    route: { provider: 'deepseek-account', model: 'deepseek-flash' },
  })
  assert.equal(card.status, 'partial')
  assert.equal(card.evidence.length, 2)
  assert.ok(card.evidence.every((e) => e.page >= 1 && e.quote.length > 0))
  assert.ok(card.warnings.some((w) => w.includes('未能在原文定位')))
  assert.ok(card.warnings.some((w) => w.includes('「问题与动机」缺失')))
  assert.equal(card.sections.length, SECTION_DEFS.length)
  assert.equal(card.model, 'deepseek-account/deepseek-flash')
})

/* ---------------- 提示词与 Markdown ---------------- */

test('buildPaperInput 排除参考文献并标注页码', () => {
  const { sections } = splitSections(PAGES)
  const { system, user } = buildPaperInput({ title: '测试', topics: [] }, sections)
  assert.ok(system.includes('七段'))
  assert.ok(user.includes('【p.2】'))
  assert.ok(!user.includes('[1] 张三'))
})

test('renderCardMarkdown 输出七段、块引用与页码', () => {
  const card = {
    model: 'deepseek-account/deepseek-flash',
    generatedAt: '2026-11-05T01:00:00.000Z',
    status: 'ready',
    promptVersion: 'seven-sections.v1',
    sections: SECTION_DEFS.map((d, i) => ({
      key: d.key,
      title: d.title,
      text: `第 ${i + 1} 段结论文本。`,
      evidence: i === 0 ? ['q-1234abcd'] : [],
    })),
    evidence: [{ id: 'q-1234abcd', page: 3, quote: '原文引文', before: '', after: '' }],
    warnings: [],
  }
  const md = renderCardMarkdown(
    { id: 'p-x', title: 'T', file: 'p-x.pdf', topics: [], pages: 3, chars: 9 },
    card,
    '摘要',
  )
  assert.ok(md.includes('evidence_count: 1'))
  assert.ok(md.includes('## 1. 一句话'))
  assert.ok(md.includes('## 7. 与我的课题'))
  assert.ok(md.includes('^q-1234abcd'))
  assert.ok(md.includes('— p.3'))
})

console.log(`\n${passed} passed`)
