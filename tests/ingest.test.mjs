/** 入库自动管线：接口、任务状态、设置开关、无模型/无 PDF 的降级。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-ingest-'))
process.env.LITKB_LIBRARY = root
const { ensureLibrary, upsert } = await import('../lib/library.js')
ensureLibrary()

const record = {
  id: 'p-ingest1',
  citekey: 'p-ingest1',
  title: 'Ingest pipeline test paper',
  authors: 'Wu B.',
  year: 2026,
  venue: 'Journal',
  doi: '',
  type: '学术期刊',
  topics: [],
  status: '待读',
  file: 'p-ingest1.pdf',
  pages: 3,
  chars: 600,
  quality: 0.8,
  added: new Date().toISOString(),
}
upsert(record)

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
  const route = routes.find((item) => item.path === path)
  assert.ok(route, path)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body }), res)
  return { code: res.code, data: JSON.parse(res.body) }
}

async function waitJob(id) {
  for (let i = 0; i < 120; i += 1) {
    const { data } = await call('/api/litkb/ingest', { url: `/api/litkb/ingest?id=${id}` })
    if (data.job && !['queued', 'running'].includes(data.job.status)) return data.job
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('自动管线未在预期时间内完成')
}

/* ---------- 默认设置开启 ---------- */
let settings = await call('/api/litkb/settings')
assert.equal(settings.code, 200)
assert.equal(settings.data.settings.autoIngest, true)

/* ---------- 手动触发：无 PDF + 无模型时明确降级 ---------- */
const started = await call('/api/litkb/ingest', { method: 'POST', body: { id: record.id } })
assert.equal(started.code, 202)
assert.equal(started.data.job.paperId, record.id)
assert.ok(['queued', 'running'].includes(started.data.job.status))

const job = await waitJob(record.id)
assert.equal(job.steps.blocks.status, 'failed', '没有 PDF 时原文解析失败')
assert.equal(job.steps.card.status, 'skipped', '没有模型时七段卡跳过')
assert.equal(job.steps.deepread.status, 'skipped', '没有模型时精读跳过')
assert.equal(job.status, 'failed', '三项都没完成时整体失败')
assert.ok(job.error?.message)

/* ---------- 列表与单查 ---------- */
const list = await call('/api/litkb/ingest')
assert.equal(list.code, 200)
assert.ok(list.data.jobs.some((item) => item.id === record.id))
const single = await call('/api/litkb/ingest', { url: `/api/litkb/ingest?id=${record.id}` })
assert.equal(single.data.job.id, record.id)
const missing = await call('/api/litkb/ingest', { url: '/api/litkb/ingest?id=p-missing' })
assert.equal(missing.data.job, null)

/* ---------- 关闭自动处理 ---------- */
const saved = await call('/api/litkb/settings', { method: 'POST', body: { autoIngest: false } })
assert.equal(saved.code, 200)
assert.equal(saved.data.settings.autoIngest, false)
settings = await call('/api/litkb/settings')
assert.equal(settings.data.settings.autoIngest, false)

/* ---------- 不存在论文 ---------- */
const notFound = await call('/api/litkb/ingest', { method: 'POST', body: { id: 'p-missing' } })
assert.equal(notFound.code, 404)

console.log('ingest tests passed')
