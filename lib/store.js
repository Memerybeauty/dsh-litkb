/**
 * 存储端口（P1）：把「库根目录」收敛成唯一入口。
 *
 * 为什么单列一个文件：
 * - 领域模块（cards / chains / themes / graph …）只需要「路径在哪里」，
 *   不应该连带依赖 library.js 的索引实现；
 * - 测试与多库场景可以 useStore()/withStore() 换一个库实例，
 *   不必改环境变量、也不必重新 import 模块。
 *
 * 约束：同一进程同一时刻只有一个活动库；async 代码不要跨 await 换库。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认库根目录：环境变量优先，其次 ~/Documents/文献库。 */
export function defaultRoot() {
  return process.env.LITKB_LIBRARY || join(homedir(), 'Documents', '文献库')
}

/** 库内的固定子目录（ensureLibrary 与备份共用，避免两处各写一份）。 */
export const LIBRARY_DIRS = [
  'papers', 'text', 'cards', 'blocks', 'translations',
  'drafts', 'deepread', 'chains', 'themes', 'concepts', 'exports',
]

/**
 * 一个库实例：根目录 + 全部派生路径。
 * 纯数据、不可变，便于比较与注入。
 */
export function createStore(root = defaultRoot()) {
  const base = String(root)
  const paths = {
    root: base,
    papers: join(base, 'papers'),
    text: join(base, 'text'),
    cards: join(base, 'cards'),
    blocks: join(base, 'blocks'),
    translations: join(base, 'translations'),
    drafts: join(base, 'drafts'),
    deepread: join(base, 'deepread'),
    chains: join(base, 'chains'),
    themes: join(base, 'themes'),
    cache: join(base, 'cache', 'pages'),
    glossary: join(base, 'glossary.json'),
    concepts: join(base, 'concepts'),
    exports: join(base, 'exports'),
    index: join(base, 'index.jsonl'),
    tags: join(base, 'tags.json'),
  }
  return Object.freeze({ root: base, paths: Object.freeze(paths) })
}

/** 启动时确定活动库：读环境变量一次，之后由 useStore 控制。 */
let active = createStore()

export function currentStore() {
  return active
}

/**
 * 切换活动库。传字符串等价于 createStore(字符串)。
 * 返回切换前的库，方便手动还原。
 */
export function useStore(next) {
  const prev = active
  active = typeof next === 'string' ? createStore(next) : next
  return prev
}

/**
 * 在指定库上执行一段同步逻辑，结束后还原。
 * 注意：不要把异步任务包进来——await 期间活动库可能被别的调用改掉。
 */
export function withStore(next, fn) {
  const prev = useStore(next)
  try {
    return fn(active)
  } finally {
    useStore(prev)
  }
}

/** 回到默认库（测试收尾用）。 */
export function resetStore() {
  return useStore(createStore())
}

/**
 * 兼容视图：老代码写 PATHS.xxx。
 * 每次读取都走当前活动库，因此切换库后不需要改任何调用点。
 */
export const PATHS = new Proxy({}, {
  get: (_, key) => currentStore().paths[key],
  has: (_, key) => key in currentStore().paths,
  ownKeys: () => Reflect.ownKeys(currentStore().paths),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
})
