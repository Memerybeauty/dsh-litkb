/**
 * P2.2 版面块单测（不依赖真实 PDF）。
 */
import assert from 'node:assert/strict'
import { blockifyPage, buildPageLines, detectGutterLines, linesToBlocks } from '../lib/layout.js'
import { findBlockForQuote, renderParsedMarkdown } from '../lib/blocks.js'

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

function item(str, x, y, w = 200, h = 10) {
  return { str, x, y, w, h }
}

const LEFT = '左栏正文内容，这里放足够多的文字用于通过文本行过滤'
const RIGHT = '右栏正文内容，这里放足够多的文字用于通过文本行过滤'

function twoColumnPage() {
  const items = [item('页眉信息', 60, 20, 80, 10), item('2 方法', 60, 90, 80, 12)]
  for (let i = 0; i < 8; i += 1) {
    items.push(item(LEFT + i, 60, 120 + i * 14, 220, 10))
    items.push(item(RIGHT + i, 340, 120 + i * 14, 220, 10))
  }
  return { page: 1, width: 595, height: 842, rotation: 0, items }
}

test('buildPageLines 在行内大空隙处切成两段', () => {
  const lines = buildPageLines([item('左边', 60, 100, 40), item('右边', 400, 100, 40)])
  assert.equal(lines.length, 2)
  assert.equal(lines[0].text, '左边')
  assert.equal(lines[1].text, '右边')
})

test('detectGutterLines 找到双栏栏缝，单栏返回 null', () => {
  const page = twoColumnPage()
  const lines = buildPageLines(page.items)
  const gutter = detectGutterLines(lines, page.width)
  assert.ok(gutter > 250 && gutter < 340, `gutter=${gutter}`)
  const single = buildPageLines([
    item('一行通栏的正文，宽度接近整页', 60, 100, 470),
    item('第二行通栏的正文，宽度也接近整页', 60, 120, 470),
    item('第三行通栏的正文，宽度也接近整页', 60, 140, 470),
    item('第四行通栏的正文，宽度也接近整页', 60, 160, 470),
    item('第五行通栏的正文，宽度也接近整页', 60, 180, 470),
    item('第六行通栏的正文，宽度也接近整页', 60, 200, 470),
  ])
  assert.equal(detectGutterLines(single, 595), null)
})

test('linesToBlocks 把续行并进段落，缩进首行不重复断段', () => {
  const lines = [
    { x0: 70, x1: 500, y0: 100, y1: 110, text: '这是段落首行，前面有两个字的缩进。', font: 10 },
    { x0: 56, x1: 500, y0: 112, y1: 122, text: '这是续行，顶格继续写同一段。', font: 10 },
    { x0: 56, x1: 500, y0: 124, y1: 134, text: '仍然属于同一段。', font: 10 },
  ]
  const blocks = linesToBlocks(lines, 10, 842)
  assert.equal(blocks.length, 1)
  assert.ok(blocks[0].text.includes('续行'))
})

test('blockifyPage 输出归一化 bbox、双栏顺序与章节', () => {
  const page = blockifyPage(twoColumnPage(), 10, true, null)
  assert.equal(page.columns, 2)
  assert.ok(page.blocks.length >= 4)
  for (const block of page.blocks) {
    for (const v of block.bbox) assert.ok(v >= 0 && v <= 1, `bbox out of range: ${block.bbox}`)
  }
  const lefts = page.blocks.filter((b) => b.bbox[2] <= 0.5)
  const rights = page.blocks.filter((b) => b.bbox[0] >= 0.5)
  assert.ok(lefts.length >= 1 && rights.length >= 1)
  const lastLeft = Math.max(...lefts.map((b) => b.order))
  const firstRight = Math.min(...rights.map((b) => b.order))
  assert.ok(lastLeft < firstRight, '左栏应先于右栏')
  const method = page.blocks.find((b) => b.text.startsWith('2 方法'))
  assert.equal(method.section, 'method')
  assert.equal(method.role, 'heading1')
})

test('块 ID 可重复（同输入同 ID）', () => {
  const a = blockifyPage(twoColumnPage(), 10, true, null)
  const b = blockifyPage(twoColumnPage(), 10, true, null)
  assert.deepEqual(
    a.blocks.map((x) => x.id),
    b.blocks.map((x) => x.id),
  )
  assert.ok(a.blocks.every((x) => /^b-[0-9a-f]{8}(-\d+)?$/.test(x.id)))
})

test('findBlockForQuote 用归一化文本找块；解析稿带块锚点', () => {
  const page = blockifyPage(twoColumnPage(), 10, true, null)
  const doc = {
    pages: [page],
    numPages: 1,
    parser: 'test',
    quality: { layout: 1 },
    builtAt: 'x',
    stats: { blocks: page.blocks.length },
  }
  const block = findBlockForQuote(doc, 1, '左栏正文内容，这里放足够多')
  assert.ok(block)
  assert.ok(block.text.includes('左栏正文'))
  const md = renderParsedMarkdown(doc, { id: 'p-x', title: 'T' })
  assert.ok(md.includes('<!-- b:'))
  assert.ok(md.includes('p:1'))
})

console.log(`\n${passed} passed`)
