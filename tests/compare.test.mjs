/** 横向精读：多篇 deepread sections 并排 API。 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-compare-'))
const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
ensureLibrary()
for (const [i, id] of ['p-comp1', 'p-comp2'].entries()) {
  upsert({ id, citekey: id, title: `横向论文 ${i + 1}`, authors: `Author ${i}`, year: 2024 + i, venue: 'Journal', doi: '', type: '学术期刊', topics: [], status: '精读', file: `${id}.pdf`, pages: 5, chars: 1000, quality: 0.9, added: new Date().toISOString() })
  writeFileSync(join(PATHS.deepread, `${id}.json`), JSON.stringify({
    paperId: id, markdown: '', model: 'fake', generatedAt: '2026-01-01T00:00:00Z',
    numbers: [], evidence: [],
    sections: [
      { key: 'conclusion', title: '结论', index: 7, markdown: `论文 ${i + 1} 的结论。` },
      { key: 'limitations', title: '局限性', index: 9, markdown: `论文 ${i + 1} 的局限。` },
    ],
  }), 'utf8')
}
const server = await import('../lib/index.js')
const routes = []
server.apply({ webServer: { register: (route) => routes.push(route) }, logger: { info() {} } })
const route = routes.find((item) => item.path === '/api/litkb/deepread/compare')
assert.ok(route)
const req = { method: 'GET', url: '/api/litkb/deepread/compare?ids=p-comp1,p-comp2', headers: {}, on(event, fn) { if (event === 'end') queueMicrotask(fn) } }
const res = { code: 0, body: '', writeHead(code) { this.code = code }, end(body) { this.body = String(body || '') } }
await route.handler(req, res)
assert.equal(res.code, 200)
const data = JSON.parse(res.body)
assert.equal(data.ok, true)
assert.equal(data.papers.length, 2)
assert.ok(data.sections.some((section) => section.key === 'conclusion'))
assert.equal(data.papers[0].sections.conclusion.markdown, '论文 1 的结论。')
assert.equal(data.papers[1].sections.limitations.markdown, '论文 2 的局限。')
console.log('  ✓ 横向 compare：两篇/合并板块/单元格 markdown')
console.log('\n1 passed')
