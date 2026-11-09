/**
 * P2.6 证据收尾：块断链、反链、JSON/CSV 导出。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-evidence-'))

const { ensureLibrary, PATHS } = await import('../lib/library.js')
ensureLibrary()
const { blocksPath } = await import('../lib/blocks.js')
const { cardJsonPath } = await import('../lib/cards.js')
const server = await import('../lib/index.js')

const record = {
  id: 'p-x',
  citekey: 'p-x',
  title: '证据测试',
  authors: '',
  year: 2025,
  type: '学术期刊',
  topics: [],
  status: '精读',
  file: 'p-x.pdf',
  pages: 1,
  chars: 100,
  quality: 0.9,
  sha256: 'x',
  added: new Date().toISOString(),
}
writeFileSync(PATHS.index, JSON.stringify(record) + '\n')
writeFileSync(
  blocksPath('p-x'),
  JSON.stringify({
    schema: 1,
    pages: [
      {
        page: 1,
        width: 1000,
        height: 1000,
        blocks: [{ id: 'b-other', role: 'paragraph', bbox: [0, 0, 1, 1], text: '完全不同的内容' }],
      },
    ],
  }),
)
writeFileSync(
  cardJsonPath('p-x'),
  JSON.stringify({
    schema: 1,
    paperId: 'p-x',
    status: 'ready',
    model: 'fake/m',
    promptVersion: 'seven-sections.v2',
    sections: [{ key: 'oneLine', title: '一句话', text: '结论', evidence: ['q-1a2b3c4d'] }],
    evidence: [
      {
        id: 'q-1a2b3c4d',
        page: 1,
        block: 'b-old',
        quote: '找不到的引文',
        before: '上一句',
        after: '下一句',
        section: 'oneLine',
      },
    ],
    warnings: [],
    annotations: [],
    statusHistory: [],
  }),
)
writeFileSync(join(PATHS.cards, 'p-x.md'), '> 找不到的引文 ^q-1a2b3c4d\n')
writeFileSync(join(PATHS.exports, 'draft.md'), '参考 [[p-x#^q-1a2b3c4d|这条证据]]\n第二行\n')

const handlers = new Map()
server.apply({
  webServer: { register: (r) => handlers.set(r.path, r.handler) },
  get: () => undefined,
  logger: { info() {}, warn() {} },
})
const call = (path) =>
  new Promise((resolve) => {
    const res = {
      code: 0,
      headers: {},
      body: null,
      writeHead(c, h) {
        this.code = c
        Object.assign(this.headers, h || {})
      },
      end(b) {
        this.body = b
        resolve(this)
      },
    }
    const req = {
      method: 'GET',
      url: path,
      headers: {},
      on() {
        return this
      },
      destroy() {},
    }
    handlers.get(path.split('?')[0])(req, res)
  })

let passed = 0
const pending = []
function test(name, fn) {
  pending.push({ name, fn })
}

test('卡片读取时标出块断链', async () => {
  const res = await call('/api/litkb/card?id=p-x')
  assert.equal(res.code, 200)
  const ev = JSON.parse(res.body).card.evidence[0]
  assert.equal(ev.blockMissing, true)
  assert.equal(ev.before, '上一句')
  assert.equal(ev.after, '下一句')
})

test('反链：包含 exports，排除证据自己的卡片', async () => {
  const res = await call('/api/litkb/evidence/backlinks?id=q-1a2b3c4d&paper=p-x')
  assert.equal(res.code, 200)
  const links = JSON.parse(res.body).links
  assert.ok(links.some((x) => x.file.endsWith('exports/draft.md')))
  assert.ok(!links.some((x) => x.file.endsWith('cards/p-x.md')))
  assert.equal(links[0].line, 1)
})

test('导出 JSON：字段完整', async () => {
  const res = await call('/api/litkb/evidence/export?id=p-x&format=json')
  assert.equal(res.code, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.paper.id, 'p-x')
  assert.equal(body.evidence[0].block, 'b-old')
  assert.equal(body.evidence[0].quote, '找不到的引文')
  assert.equal(body.evidence[0].before, '上一句')
})

test('导出 CSV：BOM + 表头 + 引号转义', async () => {
  const res = await call('/api/litkb/evidence/export?id=p-x&format=csv')
  assert.equal(res.code, 200)
  assert.ok(res.headers['content-type'].startsWith('text/csv'))
  assert.ok(String(res.body).startsWith('\uFEFF'))
  const text = String(res.body).replace(/^\uFEFF/, '')
  assert.ok(text.startsWith('paper_id,title,page,block,quote,before,after,section'))
  assert.ok(text.includes('"找不到的引文"'))
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
