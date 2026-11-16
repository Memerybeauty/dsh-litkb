/** P1 存储端口：多库切换、注入、隔离。 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'dsh-litkb-store-'))
process.env.LITKB_LIBRARY = join(base, 'default')

const { createStore, currentStore, PATHS, resetStore, useStore, withStore } = await import('../lib/store.js')
const { ensureLibrary, readIndex, upsert } = await import('../lib/library.js')

const libraryA = join(base, 'a')
const libraryB = join(base, 'b')

// 1. createStore 是纯函数：同一根目录得到等价路径，不同根目录互不影响
const a = createStore(libraryA)
const b = createStore(libraryB)
assert.equal(a.paths.root, libraryA)
assert.equal(b.paths.root, libraryB)
assert.notEqual(a.paths.index, b.paths.index)
assert.ok(Object.isFrozen(a.paths), 'paths 不可变，避免运行期被就地改写')

// 2. 切换活动库后，兼容视图 PATHS 立即跟着走
const previous = useStore(a)
assert.equal(currentStore().root, libraryA)
assert.equal(PATHS.root, libraryA)
assert.equal(PATHS.index, join(libraryA, 'index.jsonl'))

// 3. ensureLibrary 只初始化当前库
ensureLibrary()
assert.ok(existsSync(join(libraryA, 'papers')))
assert.equal(existsSync(join(libraryB, 'papers')), false)

// 4. 写入 A 不影响 B：索引缓存必须按库区分
upsert({ id: 'p-a', title: 'A 库论文', sha256: 'aaa' })
assert.equal(readIndex().length, 1)

useStore(b)
ensureLibrary()
assert.deepEqual(readIndex(), [], '切换库后不能命中 A 库的索引缓存')
upsert({ id: 'p-b', title: 'B 库论文', sha256: 'bbb' })
assert.deepEqual(
  readIndex().map((row) => row.id),
  ['p-b'],
)

useStore(a)
assert.deepEqual(
  readIndex().map((row) => row.id),
  ['p-a'],
  '切回 A 库读到自己的数据',
)
assert.match(readFileSync(PATHS.index, 'utf8'), /p-a/)
assert.doesNotMatch(readFileSync(join(libraryB, 'index.jsonl'), 'utf8'), /p-a/)

// 5. withStore 执行完自动还原，即使函数抛错也还原
const seenRoot = withStore(b, (store) => store.root)
assert.equal(seenRoot, libraryB)
assert.equal(currentStore().root, libraryA, 'withStore 结束后回到原库')
assert.throws(
  () =>
    withStore(b, () => {
      throw new Error('boom')
    }),
  /boom/,
)
assert.equal(currentStore().root, libraryA, '抛错也要还原')

// 6. resetStore 回到默认库（环境变量指定的那个）
resetStore()
assert.equal(currentStore().root, join(base, 'default'))
assert.equal(useStore(previous).root, join(base, 'default'))

console.log('store tests passed')
