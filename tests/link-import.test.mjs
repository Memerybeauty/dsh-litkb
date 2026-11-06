/** 场景补口：DOI/arXiv/HTML 元数据解析（不联网）。 */
import assert from 'node:assert/strict'
import { extractDoi, extractArxivId, parseCitationMeta, resolveLink } from '../lib/link-import.js'

assert.equal(extractDoi('https://doi.org/10.1016/j.bspc.2026.110893'), '10.1016/j.bspc.2026.110893')
assert.equal(extractDoi('doi: 10.1000/xyz123.'), '10.1000/xyz123')
assert.equal(extractArxivId('arXiv:2401.12345v2'), '2401.12345')
assert.equal(extractArxivId('https://arxiv.org/abs/2305.01234'), '2305.01234')

const html = `<!doctype html><html><head>
<meta name="citation_title" content="A &amp; B Study">
<meta name="citation_author" content="Wu B.">
<meta name="citation_author" content="Li C.">
<meta name="citation_publication_date" content="2026/05/01">
<meta name="citation_journal_title" content="Journal of Tests">
<meta name="citation_doi" content="10.1000/test">
<meta name="citation_pdf_url" content="/pdf/paper.pdf">
</head></html>`
const meta = parseCitationMeta(html, 'https://example.org/article')
assert.equal(meta.title, 'A & B Study')
assert.equal(meta.authors, 'Wu B.; Li C.')
assert.equal(meta.year, '2026')
assert.equal(meta.venue, 'Journal of Tests')
assert.equal(meta.doi, '10.1000/test')
assert.equal(meta.pdfUrl, 'https://example.org/pdf/paper.pdf')

await assert.rejects(() => resolveLink('   ', 'auto'), /请输入/)
await assert.rejects(() => resolveLink('not-a-url', 'url'), /http/)
console.log('  ✓ DOI / arXiv ID 解析')
console.log('  ✓ citation_* 元数据与 PDF 链接')
console.log('  ✓ 空值/非法链接明确报错')
console.log('\n3 passed')
