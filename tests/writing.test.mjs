/**
 * P4.7 写作：文稿 CRUD、引用解析、参考文献、导出、证据搜索、AI 扩写约束。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-writing-'))

const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { assistDraft, createDraft, deleteDraft, draftCitations, exportDraft, listDrafts, readDraft, saveDraft, searchEvidence } = await import('../lib/drafts.js')
const { findBacklinks } = await import('../lib/evidence-scan.js')

ensureLibrary()
const record = {
  id: 'p-aaaaaaaa', citekey: 'p-aaaaaaaa', title: 'CA-UNet for Glaucoma', authors: 'Gao Z.',
  year: 2024, venue: 'Scientific Reports', doi: '10.1/x', type: '学术期刊', topics: [],
  status: '精读', file: 'p-aaaaaaaa.pdf', pages: 6, chars: 2000, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
writeCard({
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '提出方法。', evidence: ['q-11111111'] }],
  evidence: [{ id: 'q-11111111', page: 3, quote: 'we propose a coordinate attention method', block: 'b-1' }],
  annotations: [], warnings: [], statusHistory: [],
}, record)

let passed = 0
const pending = []
function test(name, fn) { pending.push({ name, fn }) }

test('文稿 CRUD：新建/保存/读取/列表', () => {
  const draft = createDraft({ title: '开题_研究现状', type: '综述' })
  assert.ok(draft.id.startsWith('d-'))
  const saved = saveDraft(draft.id, {
    body: '视盘分割从 U-Net 开始 [[p-aaaaaaaa#^q-11111111|Gao 2024, p.3]]。',
  })
  assert.ok(saved.updated)
  const read = readDraft(draft.id)
  assert.equal(read.title, '开题_研究现状')
  assert.ok(read.body.includes('q-11111111'))
  const list = listDrafts()
  assert.ok(list.some((item) => item.id === draft.id && item.citations === 1))
})

test('删除文稿：文件移除，列表不再出现', () => {
  const draft = createDraft({ title: '临时删除' })
  assert.ok(readDraft(draft.id))
  assert.equal(deleteDraft(draft.id), true)
  assert.equal(readDraft(draft.id), null)
  assert.ok(!listDrafts().some((item) => item.id === draft.id))
  assert.equal(deleteDraft(draft.id), false)
})

test('引用解析与参考文献', () => {
  const draft = listDrafts()[0]
  const info = draftCitations(draft.id)
  assert.equal(info.citations.length, 1)
  assert.equal(info.citations[0].page, 3)
  assert.equal(info.papers[0].paperId, record.id)
  assert.ok(info.references[0].text.includes('[J]'))
})

test('导出带参考文献', () => {
  const draft = listDrafts()[0]
  const md = exportDraft(draft.id)
  assert.ok(md.includes('## 参考文献'))
  assert.ok(md.includes('[1]'))
  assert.ok(md.includes('Scientific Reports'))
})

test('证据搜索：标题/引文命中', () => {
  const byQuote = searchEvidence('coordinate attention')
  assert.equal(byQuote.length, 1)
  assert.equal(byQuote[0].evidenceId, 'q-11111111')
  const byTitle = searchEvidence('CA-UNet')
  assert.equal(byTitle.length, 1)
  const none = searchEvidence('zzz-not-found')
  assert.equal(none.length, 0)
})

test('反链扫描 drafts', () => {
  const links = findBacklinks('q-11111111', { excludeCard: join(PATHS.cards, `${record.id}.md`) })
  assert.ok(links.some((link) => link.file.startsWith('drafts/')))
})

test('drafts 路由：POST 新建 + GET 列表（method 大写/小写都接受）', async () => {
  const server = await import('../lib/index.js')
  const routes = new Map()
  server.apply({ webServer: { register: (r) => routes.set(r.path, r.handler) }, logger: { info() {}, warn() {} } })
  const call = (method, url, payload) => new Promise(async (resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.headers = { 'content-type': 'application/json' }
    const res = { code: 0, body: '', writeHead(c) { this.code = c }, end(b) { this.body = b; resolve(this) } }
    const pending = routes.get(url)(req, res)
    if (payload !== undefined) req.emit('data', Buffer.from(JSON.stringify(payload)))
    req.emit('end')
    await pending
  })
  const created = await call('post', '/api/litkb/drafts', { title: '路由新建' })
  assert.equal(created.code, 201)
  assert.ok(JSON.parse(created.body).draft.id.startsWith('d-'))
  const listed = await call('GET', '/api/litkb/drafts')
  assert.equal(listed.code, 200)
  assert.ok(JSON.parse(listed.body).drafts.some((item) => item.title === '路由新建'))
})

test('AI 扩写：只允许选中证据，缺引用警告', async () => {
  const draft = listDrafts()[0]
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          stream() {
            return (async function* () {
              yield { type: 'text-delta', text: '该方法在视盘分割上有效 [[p-aaaaaaaa#^q-11111111|p.3]]。' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake' }) }
      return undefined
    },
  }
  const result = await assistDraft({ ctx, draftId: draft.id, evidenceIds: ['q-11111111'] })
  assert.ok(result.text.includes('q-11111111'))
  assert.deepEqual(result.warnings, [])
  assert.equal(result.model, 'fake/fake')

  const bare = {
    get(name) {
      if (name === 'llm') {
        return {
          stream() {
            return (async function* () {
              yield { type: 'text-delta', text: '该方法有效。' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake' }) }
      return undefined
    },
  }
  const warned = await assistDraft({ ctx: bare, draftId: draft.id, evidenceIds: ['q-11111111'] })
  assert.ok(warned.warnings.some((warning) => warning.includes('没有引用')))
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
