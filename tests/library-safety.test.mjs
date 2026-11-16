/**
 * 数据写入安全：索引坏行备份、卡片原子写、陈旧 record 不覆盖新元数据。
 * 用临时库，不碰真实数据。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-safety-'))
process.env.LITKB_LIBRARY = root

const library = await import('../lib/library.js')
const cards = await import('../lib/cards.js')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error?.message || error}`)
    process.exitCode = 1
  }
}

library.ensureLibrary()
const good1 = JSON.stringify({
  id: 'p-1',
  title: '第一篇',
  authors: '张三',
  year: '2024',
  type: '学术期刊',
  topics: [],
})
const good2 = JSON.stringify({
  id: 'p-2',
  title: '第二篇',
  authors: '李四',
  year: '2023',
  type: '学术期刊',
  topics: [],
})
writeFileSync(library.PATHS.index, `${good1}\n{ 坏掉的一行\n${good2}\n`, 'utf8')

test('坏行被跳过，但原始索引备份为 .bak', () => {
  const rows = library.readIndex()
  assert.equal(rows.length, 2)
  assert.equal(library.indexBadLines(), 1)
  const bak = `${library.PATHS.index}.bak`
  assert.ok(existsSync(bak), '应生成 index.jsonl.bak')
  assert.ok(readFileSync(bak, 'utf8').includes('{ 坏掉的一行'))
})

test('坏行存在时写入索引不会覆盖备份', () => {
  const bak = `${library.PATHS.index}.bak`
  const before = readFileSync(bak, 'utf8')
  library.upsert({ id: 'p-1', title: '第一篇（改名）', authors: '张三', year: '2024', type: '学术期刊', topics: [] })
  assert.equal(readFileSync(bak, 'utf8'), before, '备份应是首次发现坏行时的原件')
  assert.equal(library.indexBadLines(), 0, '重写后索引不再有坏行')
})

test('writeCard 用索引里的最新元数据，陈旧 record 不覆盖标题', () => {
  const stale = { id: 'p-1', title: '第一篇（改名）', authors: '张三', year: '2024' }
  library.upsert({ id: 'p-1', title: '最新标题', authors: '张三', year: '2024', type: '学术期刊', topics: [] })
  cards.writeCard({ sections: [], evidence: [], annotations: [] }, stale)
  const row = library.readIndex().find((item) => item.id === 'p-1')
  assert.equal(row.title, '最新标题')
  assert.ok(readFileSync(join(library.PATHS.cards, 'p-1.md'), 'utf8').includes('最新标题'))
})

test('卡片写入后没有残留临时文件，JSON 可解析', () => {
  const left = readdirSync(library.PATHS.cards).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(left, [])
  const card = JSON.parse(readFileSync(join(library.PATHS.cards, 'p-1.card.json'), 'utf8'))
  assert.ok(Array.isArray(card.evidence))
})

console.log(`\n${passed} passed`)
