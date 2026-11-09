import assert from 'node:assert/strict'
import { documentParagraphs, paragraphForQuote, paragraphIndex, paragraphPages } from '../lib/paragraphs.js'
import { renderParsedMarkdown } from '../lib/blocks.js'

const doc = {
  numPages: 2,
  parser: 'test',
  quality: { layout: 1 },
  pages: [
    {
      page: 1,
      blocks: [
        { id: 'b-1', role: 'heading1', text: '1 引言' },
        { id: 'b-2', role: 'paragraph', text: '这是第一段被拆成' },
        { id: 'b-3', role: 'paragraph', text: '两块的正文。' },
        { id: 'b-4', role: 'paragraph', text: '第二段完整。' },
        { id: 'b-5', role: 'caption', text: '图1 系统框架' },
        { id: 'b-6', role: 'paragraph', text: '跨页续写的段落' },
      ],
    },
    {
      page: 2,
      blocks: [
        { id: 'b-10', role: 'paragraph', text: '17' },
        { id: 'b-7', role: 'paragraph', text: '在下一页继续并结束。' },
        { id: 'b-8', role: 'heading1', text: '2 方法' },
        { id: 'b-9', role: 'paragraph', text: '新的一段。' },
      ],
    },
  ],
}

const paragraphs = documentParagraphs(doc)
assert.deepEqual(
  paragraphs.map((item) => item.role),
  ['heading1', 'paragraph', 'paragraph', 'caption', 'paragraph', 'heading1', 'paragraph'],
)
assert.equal(paragraphs[1].text, '这是第一段被拆成两块的正文。')
assert.deepEqual(paragraphs[1].blockIds, ['b-2', 'b-3'])
assert.equal(paragraphs[2].text, '第二段完整。')
assert.equal(paragraphs[4].text, '跨页续写的段落在下一页继续并结束。')
assert.equal(paragraphs[4].pageEnd, 2)
assert.deepEqual(paragraphs[4].blockIds, ['b-6', 'b-7'])

const index = paragraphIndex(doc)
assert.equal(index.byBlock.get('b-3').text, '这是第一段被拆成两块的正文。')
assert.equal(paragraphForQuote(doc, '在下一页继续并结束', 2).firstBlockId, 'b-6')

const pageTexts = paragraphPages(doc)
assert.equal(pageTexts.length, 2)
assert.ok(pageTexts[0].text.includes('这是第一段被拆成两块的正文。'))
assert.ok(!pageTexts[0].text.includes('\n17'))
assert.ok(pageTexts[1].text.includes('新的一段。'))

const md = renderParsedMarkdown(doc, { id: 'p-1', title: '测试' })
assert.ok(md.includes('这是第一段被拆成两块的正文。'))
assert.equal((md.match(/<!-- b:b-3 /g) || []).length, 1)
assert.equal((md.match(/<!-- b:b-2 /g) || []).length, 1)
assert.equal((md.match(/这是第一段被拆成两块的正文。/g) || []).length, 1)
assert.ok(!md.includes('<!-- b:b-10 '))

console.log('\n4 passed')
