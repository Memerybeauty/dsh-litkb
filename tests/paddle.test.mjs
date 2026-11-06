/**
 * PaddleOCR 结果规范化单测（不联网）。
 */
import assert from 'node:assert/strict'
import { normalizePaddleResult } from '../lib/paddle.js'

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

const block = (label, content, bbox) => ({
  block_label: label, block_content: content, block_bbox: bbox,
})

const jsonl = JSON.stringify({
  result: {
    layoutParsingResults: [{
      prunedResult: {
        width: 1000,
        height: 2000,
        parsing_res_list: [
          block('header', '页眉信息', [0, 0, 1000, 50]),
          block('doc_title', '面向测试的论文标题', [100, 100, 900, 160]),
          block('abstract', '摘 要 本文提出一种方法，在数据集上取得 0.96。', [100, 200, 900, 400]),
          block('text', '关键词：测试；方法', [100, 410, 400, 440]),
          block('paragraph_title', '1 引言', [100, 460, 300, 490]),
          block('text', '正 文 第一段内容，介绍研究背景。', [100, 500, 900, 700]),
          block('text', '第二段内容，描述方法。', [100, 710, 900, 900]),
          block('figure_title', '图 1 系统框架', [100, 920, 500, 960]),
          block('text', '', [100, 970, 900, 1000]),
        ],
      },
      markdown: { text: '# 标题' },
    }],
  },
})

test('normalizePaddleResult 映射角色、页码、归一化 bbox', () => {
  const doc = normalizePaddleResult(jsonl, 'PaddleOCR-VL-1.6')
  assert.equal(doc.parser, 'paddleocr/PaddleOCR-VL-1.6')
  assert.equal(doc.pages.length, 1)
  assert.equal(doc.pages[0].width, 1000)
  const blocks = doc.pages[0].blocks
  assert.equal(blocks.length, 8, '空内容块应被丢弃')
  assert.equal(blocks[0].role, 'header')
  assert.equal(blocks[1].role, 'title')
  assert.equal(blocks[2].role, 'abstract')
  assert.equal(blocks[3].role, 'keywords')
  assert.equal(blocks[4].role, 'heading1')
  assert.equal(blocks[5].role, 'paragraph')
  assert.equal(blocks[7].role, 'caption')
  for (const b of blocks) {
    for (const v of b.bbox) assert.ok(v >= 0 && v <= 1, `bbox ${b.bbox}`)
  }
  assert.deepEqual(blocks[2].bbox, [0.1, 0.1, 0.9, 0.2])
})

test('章节在块之间延续：摘要 → 引言 → 正文', () => {
  const doc = normalizePaddleResult(jsonl, 'PaddleOCR-VL-1.6')
  const blocks = doc.pages[0].blocks
  const abstract = blocks.find((b) => b.role === 'abstract')
  const intro = blocks.find((b) => b.text === '1 引言')
  const body = blocks.find((b) => b.text.startsWith('正文第一段'))
  assert.equal(abstract.section, 'abstract')
  assert.equal(intro.section, 'intro')
  assert.equal(body.section, 'intro')
})

test('块 ID 稳定且格式正确', () => {
  const a = normalizePaddleResult(jsonl, 'PaddleOCR-VL-1.6')
  const b = normalizePaddleResult(jsonl, 'PaddleOCR-VL-1.6')
  assert.deepEqual(a.pages[0].blocks.map((x) => x.id), b.pages[0].blocks.map((x) => x.id))
  assert.ok(a.pages[0].blocks.every((x) => /^b-[0-9a-f]{8}(-\d+)?$/.test(x.id)))
})

console.log(`\n${passed} passed`)
