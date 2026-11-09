/**
 * P4.6 导出与反链：BibTeX / GB-T / 卡片 MD / Mermaid / Canvas / 反链路由。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-export-'))

const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { findBacklinks } = await import('../lib/evidence-scan.js')
const { exportBibtex, exportCanvas, exportCardMarkdown, exportGbt, exportMermaid } = await import('../lib/export.js')

ensureLibrary()
const record = {
  id: 'p-aaaaaaaa',
  citekey: 'p-aaaaaaaa',
  title: 'CA-UNet for Glaucoma',
  authors: 'Gao Z., Li M.',
  year: 2024,
  venue: 'Scientific Reports',
  doi: '10.1038/s41598-024-1234-5',
  type: '学术期刊',
  topics: ['分割骨干'],
  status: '精读',
  file: 'p-aaaaaaaa.pdf',
  pages: 6,
  chars: 2000,
  quality: 0.9,
  added: new Date().toISOString(),
}
upsert(record)
const card = {
  paperId: record.id,
  status: 'ready',
  model: 'fake',
  generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '提出方法。', evidence: ['q-11111111'] }],
  evidence: [{ id: 'q-11111111', page: 3, quote: 'we propose a method', block: 'b-1' }],
  annotations: [],
  warnings: [],
  statusHistory: [],
}
writeCard(card, record)
writeFileSync(join(PATHS.exports, 'draft.md'), '引用 [[p-aaaaaaaa#^q-11111111|证据]]\n')

let passed = 0
const pending = []
function test(name, fn) {
  pending.push({ name, fn })
}

test('BibTeX：单篇/整库字段正确，缺字段省略', () => {
  const one = exportBibtex({ id: record.id })
  assert.ok(one.includes('@article{p-aaaaaaaa'))
  assert.ok(one.includes('title = {CA-UNet for Glaucoma}'))
  assert.ok(one.includes('journal = {Scientific Reports}'))
  assert.ok(one.includes('doi = {10.1038/s41598-024-1234-5}'))
  const all = exportBibtex()
  assert.ok(all.includes('@article{p-aaaaaaaa'))
  assert.equal(exportBibtex({ id: 'p-missing' }), null)
})

test('GB/T 7714：类型标志与年/刊名', () => {
  const text = exportGbt(record.id)
  assert.ok(text.includes('[J]'))
  assert.ok(text.includes('Gao Z., Li M.'))
  assert.ok(text.includes('Scientific Reports'))
  assert.ok(text.includes('2024'))
  assert.equal(exportGbt('p-missing'), null)
})

test('卡片 MD：导出 cards/<id>.md 原文', () => {
  const md = exportCardMarkdown(record.id)
  assert.ok(md.includes('CA-UNet for Glaucoma'))
  assert.ok(md.includes('we propose a method'))
  assert.equal(exportCardMarkdown('p-missing'), null)
})

test('Mermaid / Canvas：空图也能生成合法文本', () => {
  assert.ok(exportMermaid().startsWith('flowchart LR'))
  const canvas = JSON.parse(exportCanvas())
  assert.ok(Array.isArray(canvas.nodes))
  assert.ok(Array.isArray(canvas.edges))
})

test('反链：扫 exports，排除自身卡片', () => {
  const links = findBacklinks('q-11111111', { excludeCard: join(PATHS.cards, `${record.id}.md`) })
  assert.ok(links.some((link) => link.file === 'exports/draft.md'))
})

test('导出路由：bibtex / gbt / card / mermaid / canvas', async () => {
  const server = await import('../lib/index.js')
  const routes = new Map()
  server.apply({
    webServer: { register: (r) => routes.set(r.path, r.handler) },
    get: () => undefined,
    logger: { info() {}, warn() {} },
  })
  const call = (url) =>
    new Promise((resolve) => {
      const res = {
        code: 0,
        headers: {},
        body: '',
        writeHead(c, h) {
          this.code = c
          Object.assign(this.headers, h || {})
        },
        end(b) {
          this.body = b
          resolve(this)
        },
      }
      routes.get('/api/litkb/export')({ method: 'GET', url, headers: {} }, res)
    })
  const bib = await call('/api/litkb/export?format=bibtex')
  assert.equal(bib.code, 200)
  assert.ok(bib.headers['content-disposition'].includes('.bib'))
  assert.ok(bib.body.includes('@article'))
  const cardRes = await call(`/api/litkb/export?format=card&id=${record.id}`)
  assert.equal(cardRes.code, 200)
  assert.ok(cardRes.body.includes('CA-UNet'))
  const mermaid = await call('/api/litkb/export?format=mermaid')
  assert.equal(mermaid.code, 200)
  assert.ok(mermaid.body.startsWith('flowchart LR'))
  const canvas = await call('/api/litkb/export?format=canvas')
  assert.equal(canvas.code, 200)
  assert.ok(JSON.parse(canvas.body).nodes)
  const bad = await call('/api/litkb/export?format=nope')
  assert.equal(bad.code, 400)
  const back = await new Promise((resolve) => {
    const res = {
      code: 0,
      headers: {},
      body: '',
      writeHead(c, h) {
        this.code = c
        Object.assign(this.headers, h || {})
      },
      end(b) {
        this.body = b
        resolve(this)
      },
    }
    routes.get('/api/litkb/evidence/backlinks')(
      {
        method: 'GET',
        url: `/api/litkb/evidence/backlinks?id=q-11111111&paper=${record.id}`,
        headers: {},
      },
      res,
    )
  })
  assert.equal(back.code, 200)
  assert.ok(JSON.parse(back.body).links.some((link) => link.file === 'exports/draft.md'))
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
