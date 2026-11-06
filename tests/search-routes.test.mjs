/** P4.11 检索 HTTP：BM25 + 链优先答案。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-search-http-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain } = await import('../lib/chains.js')
ensureLibrary()
const record = { id: 'p-q1', citekey: 'p-q1', title: '极坐标视盘分割', authors: 'Wu B.', year: 2024, venue: 'Journal', doi: '', type: '学术期刊', topics: ['分割'], status: '精读', file: 'p-q1.pdf', pages: 5, chars: 900, quality: 0.9, added: new Date().toISOString() }
upsert(record)
writeCard({
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '方法。', evidence: [] }],
  evidence: [{ id: 'q-abc12345', page: 5, block: 'b-1', quote: 'Polar transform improves optic disc boundary.', kind: 'author_claim' }],
  annotations: [], warnings: [], statusHistory: [],
}, record)
saveChain({
  title: '极坐标改善边界', claim: { text: '极坐标改善视盘边界。', paperId: record.id, source: 'manual' },
  origin: 'claim', status: 'confirmed',
  nodes: [{ paperId: record.id, evidenceId: 'q-abc12345', page: 5, block: 'b-1', quote: 'Polar transform improves optic disc boundary.', relation: 'supports' }],
})

const server = await import('../lib/index.js')
const routes = []
server.apply({ webServer: { register: (route) => routes.push(route) }, logger: { info() {} } })
function makeReq({ method = 'GET', url = '/', body = null } = {}) {
  const handlers = { data: [], end: [] }
  return { method, url, headers: {}, on(event, fn) { handlers[event]?.push(fn); if (event === 'end') queueMicrotask(() => { if (body !== null) { const chunk = Buffer.from(JSON.stringify(body)); for (const l of handlers.data) l(chunk) } for (const l of handlers.end) l() }) } }
}
function makeRes() { return { code: 0, body: '', writeHead(code) { this.code = code }, end(body) { this.body = String(body || '') } } }
async function call(path, { method = 'GET', body = null, url = null } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, path)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body }), res)
  return { code: res.code, data: JSON.parse(res.body) }
}

const search = await call('/api/litkb/search', { method: 'POST', body: { q: '极坐标 边界' } })
assert.equal(search.code, 200)
assert.ok(search.data.evidence.some((item) => item.evidenceId === 'q-abc12345'))
assert.ok(search.data.chains.some((chain) => chain.id))

const answer = await call('/api/litkb/search/answer', { method: 'POST', body: { q: '极坐标 边界' } })
assert.equal(answer.code, 200)
assert.equal(answer.data.mode, 'extractive')
assert.ok(answer.data.answer.includes('[[p-q1#^q-abc12345|'))
assert.ok(answer.data.citations.some((item) => item.evidenceId === 'q-abc12345'))
assert.ok(answer.data.trace.length >= 1)

const history = await call('/api/litkb/search/history', { url: '/api/litkb/search/history?limit=10' })
assert.equal(history.code, 200)
assert.ok(history.data.items.some((item) => item.q === '极坐标 边界'))
assert.ok(history.data.items.length >= 1)

const empty = await call('/api/litkb/search/answer', { method: 'POST', body: { q: ' ' } })
assert.equal(empty.code, 400)
console.log('  ✓ 检索路由：BM25 命中链/证据')
console.log('  ✓ 答案路由：抽取式带引用')
console.log('  ✓ 检索历史至少 1 条')
console.log('  ✓ 空问题 400')
console.log('\n3 passed')
