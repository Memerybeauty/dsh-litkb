/** 阅读状态自动标记：七段卡→略读、精读→精读、手动优先、旧库迁移。 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-status-'))
process.env.LITKB_LIBRARY = root
const { PATHS, ensureLibrary, readIndex, upsert } = await import('../lib/library.js')
const { applyAutoStatus, inferredStatus, migrateAutoStatuses, readStatusSource } =
  await import('../lib/paper-status.js')
ensureLibrary()

function record(id, status, card = false) {
  return {
    id,
    citekey: id,
    title: id,
    authors: '',
    year: 2026,
    venue: '',
    doi: '',
    type: '学术期刊',
    topics: [],
    status,
    file: `${id}.pdf`,
    pages: 1,
    chars: 100,
    quality: 0.8,
    card: card ? { status: 'ready', sections: 7 } : undefined,
    added: new Date().toISOString(),
  }
}

upsert(record('p-card', '待读', true))
upsert(record('p-deep', '待读', true))
writeFileSync(join(PATHS.deepread, 'p-deep.json'), JSON.stringify({ paperId: 'p-deep', sections: [] }), 'utf8')
upsert(record('p-cited', '已引用', true))
upsert(record('p-skim', '略读', true))
upsert(record('p-empty', '待读', false))

/* ---------- 旧库迁移 ---------- */
assert.equal(migrateAutoStatuses(), 5)
const statusOf = (id) => readIndex().find((row) => row.id === id)?.status
assert.equal(statusOf('p-card'), '略读')
assert.equal(statusOf('p-deep'), '精读')
assert.equal(statusOf('p-cited'), '已引用')
assert.equal(statusOf('p-skim'), '略读')
assert.equal(statusOf('p-empty'), '待读')
assert.equal(readStatusSource('p-card'), 'auto')
assert.equal(readStatusSource('p-cited'), 'manual')
assert.equal(migrateAutoStatuses(), 0, '迁移幂等')

/* ---------- 自动提升 / 不降级 ---------- */
applyAutoStatus('p-card', '精读')
assert.equal(statusOf('p-card'), '精读')
applyAutoStatus('p-card', '略读')
assert.equal(statusOf('p-card'), '精读', '自动状态不能降级')

/* ---------- 手动优先 ---------- */
const cited = readIndex().find((row) => row.id === 'p-cited')
upsert({ ...cited, status: '待读', statusSource: 'manual' })
applyAutoStatus('p-cited', '精读')
assert.equal(statusOf('p-cited'), '待读')
assert.equal(readStatusSource('p-cited'), 'manual')

/* ---------- 推断 ---------- */
assert.equal(inferredStatus('p-deep'), '精读')
assert.equal(inferredStatus('p-empty'), '待读')

console.log('paper status tests passed')
