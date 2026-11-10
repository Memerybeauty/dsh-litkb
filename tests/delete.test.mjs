/** 删除论文：影响面、二次确认、索引/卡片/解析/精读/链/研究清理。 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-delete-'))
process.env.LITKB_LIBRARY = root
const { PATHS, ensureLibrary, readIndex, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
ensureLibrary()

const record = {
  id: 'p-del0001',
  citekey: 'p-del0001',
  title: 'Paper to delete',
  authors: 'Wu B.',
  year: 2026,
  venue: 'Journal',
  doi: '',
  type: '学术期刊',
  topics: ['测试'],
  status: '精读',
  file: 'p-del0001.pdf',
  pages: 3,
  chars: 600,
  quality: 0.8,
  added: new Date().toISOString(),
}
upsert(record)
writeCard(
  {
    paperId: record.id,
    status: 'ready',
    model: 'fake',
    generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '待删除。', evidence: [] }],
    evidence: [{ id: 'q-del00001', page: 2, block: 'b-1', quote: '待删除论文的证据。', kind: 'author_claim' }],
    annotations: [],
    warnings: [],
    statusHistory: [],
  },
  record,
)
writeFileSync(join(PATHS.text, `${record.id}.txt`), '待删除论文的正文。', 'utf8')
writeFileSync(join(PATHS.blocks, `${record.id}.json`), JSON.stringify({ paperId: record.id, blocks: [] }), 'utf8')
writeFileSync(join(PATHS.deepread, `${record.id}.json`), JSON.stringify({ paperId: record.id, sections: [] }), 'utf8')
writeFileSync(join(PATHS.papers, 'p-del0001.pdf'), '%PDF-1.3 test', 'utf8')
writeFileSync(
  join(PATHS.chains, 'c-del0001.json'),
  JSON.stringify(
    {
      id: 'c-del0001',
      status: 'confirmed',
      claim: { text: '待删除论点', paperId: record.id },
      nodes: [{ paperId: record.id, evidenceId: 'q-del00001' }],
    },
    null,
    2,
  ),
  'utf8',
)
writeFileSync(
  join(PATHS.themes, 't-del0001.json'),
  JSON.stringify(
    {
      id: 't-del0001',
      title: '待删除研究',
      papers: { include: [record.id], exclude: [], lastMatch: { papers: [{ paperId: record.id }] } },
      facets: [],
    },
    null,
    2,
  ),
  'utf8',
)
writeFileSync(join(PATHS.drafts, 'd-del0001.md'), `---\ntitle: 引用待删除论文\n---\n\n见 [q-del00001]。\n`, 'utf8')

const server = await import('../lib/index.js')
const routes = []
server.apply({ webServer: { register: (route) => routes.push(route) }, logger: { info() {}, warn() {} } })

function makeReq({ method = 'GET', url = '/', body = null } = {}) {
  const handlers = { data: [], end: [] }
  return {
    method,
    url,
    headers: {},
    on(event, fn) {
      handlers[event]?.push(fn)
      if (event === 'end') {
        queueMicrotask(() => {
          if (body !== null) {
            const chunk = Buffer.from(JSON.stringify(body))
            for (const listener of handlers.data) listener(chunk)
          }
          for (const listener of handlers.end) listener()
        })
      }
    },
  }
}
function makeRes() {
  return {
    code: 0,
    body: '',
    writeHead(code) {
      this.code = code
    },
    end(body) {
      this.body = String(body || '')
    },
  }
}
async function call(path, { method = 'GET', body = null, url = null } = {}) {
  const route = routes.find((item) => item.path === path.split('?')[0])
  assert.ok(route, path)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body }), res)
  return { code: res.code, data: JSON.parse(res.body) }
}

/* ---------- 影响面 ---------- */
const impact = await call('/api/litkb/delete', { url: `/api/litkb/delete?id=${record.id}` })
assert.equal(impact.code, 200)
assert.equal(impact.data.paper.id, record.id)
assert.equal(impact.data.counts.cards, 1)
assert.equal(impact.data.counts.blocks, 1)
assert.equal(impact.data.counts.deepread, 1)
assert.equal(impact.data.counts.chains, 1)
assert.equal(impact.data.counts.chainsRemoved, 1)
assert.equal(impact.data.counts.themes, 1)
assert.equal(impact.data.counts.drafts, 1)

/* ---------- 二次确认 ---------- */
const blocked = await call('/api/litkb/delete', { method: 'POST', body: { id: record.id } })
assert.equal(blocked.code, 428)
assert.equal(blocked.data.code, 'confirm_required')
assert.equal(readIndex().length, 1)

/* ---------- 执行删除 ---------- */
const deleted = await call('/api/litkb/delete', { method: 'POST', body: { id: record.id, confirm: true } })
assert.equal(deleted.code, 200)
assert.equal(deleted.data.removed.chains, 1)
assert.equal(deleted.data.removed.themes, 1)
assert.equal(deleted.data.removed.draftsCited, 1)
assert.equal(readIndex().length, 0)
for (const file of [
  join(PATHS.cards, `${record.id}.card.json`),
  join(PATHS.cards, `${record.id}.md`),
  join(PATHS.text, `${record.id}.txt`),
  join(PATHS.blocks, `${record.id}.json`),
  join(PATHS.deepread, `${record.id}.json`),
  join(PATHS.papers, 'p-del0001.pdf'),
  join(PATHS.chains, 'c-del0001.json'),
]) {
  assert.ok(!existsSync(file), `应删除 ${file}`)
}
const theme = JSON.parse(readFileSync(join(PATHS.themes, 't-del0001.json'), 'utf8'))
assert.deepEqual(theme.papers.include, [])
assert.deepEqual(theme.papers.lastMatch.papers, [])
assert.ok(existsSync(join(PATHS.drafts, 'd-del0001.md')), '文稿保留，只提示缺失引用')

/* ---------- 不存在 ---------- */
const missing = await call('/api/litkb/delete', { method: 'POST', body: { id: 'p-missing', confirm: true } })
assert.equal(missing.code, 404)
const missingImpact = await call('/api/litkb/delete', { url: '/api/litkb/delete?id=p-missing' })
assert.equal(missingImpact.code, 404)

console.log('delete tests passed')
