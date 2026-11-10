/** 产品化：首次上手、整库备份/恢复、诊断信息。 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-product-'))
process.env.LITKB_LIBRARY = root
const { ensureLibrary, readIndex, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
ensureLibrary()

const first = {
  id: 'p-prod1',
  citekey: 'p-prod1',
  title: 'Productization and local-first literature workbench',
  authors: 'Wu B.',
  year: 2026,
  venue: 'Journal',
  doi: '10.1000/product.1',
  type: '学术期刊',
  topics: ['产品化'],
  status: '精读',
  file: 'p-prod1.pdf',
  pages: 6,
  chars: 1200,
  quality: 0.92,
  added: new Date().toISOString(),
}
upsert(first)

const server = await import('../lib/index.js')
const routes = []
server.apply({ webServer: { register: (route) => routes.push(route) }, logger: { info() {}, warn() {} } })

function makeReq({ method = 'GET', url = '/', body = null, raw = null } = {}) {
  const handlers = { data: [], end: [] }
  return {
    method,
    url,
    headers: {},
    on(event, fn) {
      handlers[event]?.push(fn)
      if (event === 'end') {
        queueMicrotask(() => {
          if (raw) {
            for (const listener of handlers.data) listener(raw)
          } else if (body !== null) {
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
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.code = code
      this.headers = headers || null
    },
    end(body) {
      this.body = body
    },
  }
}
async function call(path, { method = 'GET', body = null, raw = null, url = null } = {}) {
  const route = routes.find((item) => item.path === path.split('?')[0])
  assert.ok(route, path)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body, raw }), res)
  return res
}
async function callJson(path, options) {
  const res = await call(path, options)
  return { code: res.code, data: JSON.parse(String(res.body)) }
}

/* ---------- 上手进度 ---------- */
let onboard = await callJson('/api/litkb/onboarding')
assert.equal(onboard.code, 200)
assert.equal(onboard.data.total, 5)
assert.equal(onboard.data.completed, 1, '只有导入论文完成')
assert.equal(onboard.data.next, 'card')
assert.equal(onboard.data.counts.papers, 1)
assert.equal(onboard.data.counts.cards, 0)

writeCard(
  {
    paperId: first.id,
    status: 'ready',
    model: 'fake',
    generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '概述。', evidence: [] }],
    evidence: [],
    annotations: [],
    warnings: [],
    statusHistory: [],
  },
  first,
)
onboard = await callJson('/api/litkb/onboarding')
assert.equal(onboard.data.counts.cards, 1)
assert.equal(onboard.data.completed, 2)
assert.equal(onboard.data.next, 'chain')

/* ---------- 备份 ---------- */
writeFileSync(join(root, 'settings.json'), JSON.stringify({ paddle: { token: 'secret-token' } }), 'utf8')
const backup = await call('/api/litkb/backup')
assert.equal(backup.code, 200)
assert.equal(backup.headers['content-type'], 'application/zip')
assert.match(backup.headers['content-disposition'], /litkb-backup-\d{8}-\d{6}\.zip/)
const zip = unzipSync(new Uint8Array(backup.body))
const names = Object.keys(zip)
assert.ok(names.includes('manifest.json'))
assert.ok(names.includes('index.jsonl'))
assert.ok(names.includes(`cards/${first.id}.md`))
assert.ok(!names.includes('settings.json'), '备份不包含令牌设置')
assert.ok(!names.some((name) => name.startsWith('cache/')), '备份不包含缓存')
const manifest = JSON.parse(Buffer.from(zip['manifest.json']).toString('utf8'))
assert.equal(manifest.app, 'dsh-litkb')
assert.equal(manifest.kind, 'library-backup')
assert.ok(manifest.files >= 2)

/* ---------- 恢复：需要确认 ---------- */
const extra = { ...first, id: 'p-prod2', citekey: 'p-prod2', title: 'Second paper', doi: '10.1000/product.2' }
upsert(extra)
assert.equal(readIndex().length, 2)
let restore = await callJson('/api/litkb/restore', { method: 'POST', raw: backup.body })
assert.equal(restore.code, 428)
assert.equal(restore.data.code, 'confirm_required')

/* ---------- 恢复：覆盖并自动快照 ---------- */
restore = await callJson('/api/litkb/restore?confirm=restore', { method: 'POST', raw: backup.body })
assert.equal(restore.code, 200)
assert.equal(restore.data.ok, true)
assert.ok(restore.data.files >= 2)
assert.equal(readIndex().length, 1)
assert.equal(readIndex()[0].id, first.id)
assert.ok(existsSync(join(root, restore.data.snapshot)), '覆盖前快照存在')
assert.ok(readFileSync(join(root, 'settings.json'), 'utf8').includes('secret-token'), '恢复不覆盖本机设置')

/* ---------- 恢复：拒绝路径穿越 ---------- */
const evil = zipSync({
  'manifest.json': strToU8(JSON.stringify({ app: 'dsh-litkb', kind: 'library-backup', version: 'x' })),
  '../evil.txt': strToU8('nope'),
})
restore = await callJson('/api/litkb/restore?confirm=restore', { method: 'POST', raw: Buffer.from(evil) })
assert.equal(restore.code, 422)
assert.equal(restore.data.code, 'bad_entry')
assert.ok(!existsSync(join(root, '..', 'evil.txt')))

/* ---------- 恢复：拒绝非本产品备份 ---------- */
const alien = zipSync({ 'readme.txt': strToU8('hello') })
restore = await callJson('/api/litkb/restore?confirm=restore', { method: 'POST', raw: Buffer.from(alien) })
assert.equal(restore.code, 422)
assert.equal(restore.data.code, 'bad_manifest')

/* ---------- 诊断 ---------- */
const diag = await callJson('/api/litkb/diag')
assert.equal(diag.code, 200)
assert.equal(diag.data.library.path, root)
assert.equal(diag.data.library.counts.papers, 1)
assert.ok(diag.data.runtime.startedAt)
assert.ok(diag.data.backup.dir.endsWith('cache/backups'))
assert.ok(diag.data.library.backups >= 1)

/* ---------- 崩溃恢复：中断的恢复留下 old 目录时搬回 ---------- */
const { recoverInterruptedRestore } = await import('../lib/backup.js')
mkdirSync(join(root, '.litkb-restore-old'))
renameSync(join(root, 'cards'), join(root, '.litkb-restore-old/cards'))
mkdirSync(join(root, '.litkb-restore-staging-999'))
const recovery = recoverInterruptedRestore()
assert.equal(recovery.recovered, 1)
assert.ok(existsSync(join(root, 'cards')))
assert.ok(!existsSync(join(root, '.litkb-restore-old')))
assert.ok(!existsSync(join(root, '.litkb-restore-staging-999')))

console.log('product tests passed')
