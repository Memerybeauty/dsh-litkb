/** P4.11 检索历史：至少保留 10 条，落盘且最新在前。 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-history-'))
const { ensureLibrary, PATHS } = await import('../lib/library.js')
const { recordSearch, listSearchHistory, clearSearchHistory, SEARCH_HISTORY_LIMIT } = await import('../lib/search-history.js')
ensureLibrary()
assert.ok(SEARCH_HISTORY_LIMIT >= 10)
for (let i = 0; i < 12; i += 1) {
  recordSearch({ q: `检索问题 ${i}`, mode: i % 2 ? 'chain-answer' : 'evidence', chainIds: [`c-${i}`], evidenceIds: [`q-${i}`], citations: i })
}
const items = listSearchHistory(10)
assert.equal(items.length, 10)
assert.equal(items[0].q, '检索问题 11')
assert.equal(items[9].q, '检索问题 2')
assert.ok(existsSync(join(PATHS.cache, 'search-history.json')))
assert.ok(items[0].chainIds.length === 1)

recordSearch({ q: '   ' })
assert.equal(listSearchHistory(20).length, 12, '空查询不写入')

for (let i = 0; i < 55; i += 1) recordSearch({ q: `批量 ${i}` })
const capped = listSearchHistory(100)
assert.equal(capped.length, SEARCH_HISTORY_LIMIT)
assert.equal(capped[0].q, '批量 54')

clearSearchHistory()
assert.equal(listSearchHistory(10).length, 0)
console.log('  ✓ 最近 10 条可读、最新在前')
console.log('  ✓ 落盘 cache/search-history.json')
console.log('  ✓ 空查询忽略、上限 50、可清空')
console.log('\n3 passed')
