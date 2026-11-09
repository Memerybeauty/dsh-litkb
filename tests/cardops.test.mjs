/**
 * P2.5 卡片编辑 / 批注 / 状态 / 版本回滚（路由级，不联网）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-cardops-'))

const { ensureLibrary, PATHS } = await import('../lib/library.js')
ensureLibrary()
const { cardJsonPath } = await import('../lib/cards.js')
const server = await import('../lib/index.js')

const record = {
  id: 'p-x',
  citekey: 'p-x',
  title: 'T',
  authors: '',
  year: 2025,
  type: '学术期刊',
  topics: [],
  status: '待读',
  file: 'p-x.pdf',
  pages: 2,
  chars: 100,
  quality: 0.9,
  sha256: 'x',
  added: new Date().toISOString(),
}
writeFileSync(PATHS.index, JSON.stringify(record) + '\n')

const card = {
  schema: 1,
  paperId: 'p-x',
  status: 'ready',
  model: 'fake/m',
  promptVersion: 'seven-sections.v2',
  generatedAt: new Date().toISOString(),
  sections: [
    { key: 'oneLine', title: '一句话', text: '一句话', evidence: [] },
    { key: 'problem', title: '问题与动机', text: '问题', evidence: [] },
    { key: 'method', title: '方法', text: '原始方法', evidence: [] },
    { key: 'data', title: '数据与实验', text: '数据', evidence: [] },
    { key: 'results', title: '结果', text: '结果', evidence: [] },
    { key: 'limits', title: '局限', text: '局限', evidence: [] },
    { key: 'relevance', title: '与我的课题', text: '相关', evidence: [] },
  ],
  evidence: [],
  warnings: [],
  annotations: [],
  statusHistory: [],
}
writeFileSync(cardJsonPath('p-x'), JSON.stringify(card))

const handlers = new Map()
server.apply({
  webServer: { register: (r) => handlers.set(r.path, r.handler) },
  get: () => undefined,
  logger: { info() {}, warn() {} },
})

const call = (path, { method = 'GET', body } = {}) =>
  new Promise((resolve) => {
    const res = {
      code: 0,
      body: '',
      writeHead(c) {
        this.code = c
      },
      end(b) {
        this.body = b
        resolve(this)
      },
    }
    const req = {
      method,
      url: path,
      headers: {},
      on(ev, fn) {
        if (ev === 'data' && body) fn(Buffer.from(body))
        if (ev === 'end') fn()
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

test('段编辑写回卡片并生成版本备份', async () => {
  const res = await call('/api/litkb/card/section', {
    method: 'POST',
    body: JSON.stringify({ id: 'p-x', key: 'method', text: '人工改过的方法' }),
  })
  assert.equal(res.code, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.card.sections.find((s) => s.key === 'method').text, '人工改过的方法')
  const saved = JSON.parse(readFileSync(cardJsonPath('p-x'), 'utf8'))
  assert.equal(saved.sections.find((s) => s.key === 'method').text, '人工改过的方法')
  assert.ok(saved.editedSections.includes('method'))
  assert.ok(existsSync(join(PATHS.cards, '.versions')))
})

test('批注追加、带日期与 ID', async () => {
  const res = await call('/api/litkb/card/annotate', {
    method: 'POST',
    body: JSON.stringify({ id: 'p-x', text: '这条结论需要核对' }),
  })
  assert.equal(res.code, 200)
  const note = JSON.parse(res.body).card.annotations[0]
  assert.match(note.id, /^a-[0-9a-f]{8}$/)
  assert.ok(note.at)
  assert.equal(note.text, '这条结论需要核对')
})

test('状态自由切换：任意方向可改，未知状态拒绝，原因可选', async () => {
  let res = await call('/api/litkb/card/status', { method: 'POST', body: JSON.stringify({ id: 'p-x', to: '精读' }) })
  assert.equal(res.code, 200)
  assert.equal(JSON.parse(res.body).paper.status, '精读')

  res = await call('/api/litkb/card/status', { method: 'POST', body: JSON.stringify({ id: 'p-x', to: '待读' }) })
  assert.equal(res.code, 200, '允许回退')

  res = await call('/api/litkb/card/status', { method: 'POST', body: JSON.stringify({ id: 'p-x', to: '弃读' }) })
  assert.equal(res.code, 200, '弃读不强制原因')

  res = await call('/api/litkb/card/status', {
    method: 'POST',
    body: JSON.stringify({ id: 'p-x', to: '弃读', reason: '基线不可比' }),
  })
  assert.equal(res.code, 200)
  assert.equal(JSON.parse(res.body).paper.statusReason, '基线不可比')

  res = await call('/api/litkb/card/status', { method: 'POST', body: JSON.stringify({ id: 'p-x', to: '乱写' }) })
  assert.equal(res.code, 422)
})

test('版本列表与回滚到最初版本', async () => {
  const res = await call('/api/litkb/card/versions?id=p-x')
  assert.equal(res.code, 200)
  const versions = JSON.parse(res.body).versions
  assert.ok(versions.length >= 1)
  const oldest = versions[versions.length - 1]
  const restored = await call('/api/litkb/card/restore', {
    method: 'POST',
    body: JSON.stringify({ id: 'p-x', version: oldest.name }),
  })
  assert.equal(restored.code, 200)
  const text = JSON.parse(restored.body).card.sections.find((s) => s.key === 'method').text
  assert.equal(text, '原始方法')
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
