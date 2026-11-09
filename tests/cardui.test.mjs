/** CardPanel 渲染冒烟（假 React，不跑浏览器）。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (o) => {
      captured = o
    },
  },
}
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(
  "return { name: 'dsh-litkb', inject: ['slots'], apply }",
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { CardPanel } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(9).filter((c) => c != null),
})
const ReactStub = {
  createElement: h,
  useState: (v) => {
    const index = globalThis.__i++
    const preset = globalThis.__s[index]
    return [preset !== undefined ? preset : typeof v === 'function' ? v() : v, () => {}]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}
const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error(name)
})
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ setAttribute() {}, remove() {}, style: {} }),
  getElementById: () => null,
}
mod.apply({ effect: (fn) => fn(), slots: { inject: () => {}, register: () => {} } })

const card = {
  model: 'fake/m',
  generatedAt: '2026-11-05T00:00:00Z',
  status: 'ready',
  sections: [
    { key: 'oneLine', title: '一句话', text: '提出方法。', evidence: ['q-1'] },
    { key: 'method', title: '方法', text: '两阶段。', evidence: [] },
  ],
  evidence: [{ id: 'q-1', page: 2, quote: '原文', block: 'b-1' }],
  annotations: [{ id: 'a-1', at: '2026-11-05T01:00:00Z', text: '这条要核对' }],
  warnings: [],
}

function render(states) {
  globalThis.__i = 0
  globalThis.__s = states
  return JSON.stringify(
    mod.__test.CardPanel({
      paper: { id: 'p-x', title: 'T' },
      onChanged() {},
      onOpenPdf() {},
    }),
  )
}

const normal = render([
  card,
  null,
  { available: true, route: { provider: 'p', model: 'm' } },
  false,
  false,
  false,
  '',
  '',
  '',
  false,
  '',
  false,
  [],
  false,
  false,
])
assert.ok(normal.includes('我的批注'))
assert.ok(normal.includes('这条要核对'))
assert.ok(normal.includes('历史版本'))
assert.ok(normal.includes('编辑'))
assert.ok(normal.includes('重生成'))
assert.ok(normal.includes('上下文'))
assert.ok(!normal.includes('反链'), '反链 UI 应在 P4 再开放')
assert.ok(normal.includes('导出 ▾'))
assert.ok(normal.includes('卡片 Markdown'))

const editing = render([
  card,
  null,
  { available: true, route: { provider: 'p', model: 'm' } },
  false,
  false,
  false,
  '',
  'method',
  '改过的内容',
  false,
  '',
  false,
  [],
  false,
  false,
])
assert.ok(editing.includes('litkb-textarea'))
assert.ok(editing.includes('保存'))
assert.ok(editing.includes('取消'))

const versions = render([
  card,
  null,
  { available: true, route: { provider: 'p', model: 'm' } },
  false,
  false,
  false,
  '',
  '',
  '',
  false,
  '',
  false,
  [{ name: 'p-x.1.json', at: '2026-11-05T01:00:00Z', bytes: 2048 }],
  true,
  false,
])
assert.ok(versions.includes('历史版本'))
assert.ok(versions.includes('恢复'))

console.log('  ✓ CardPanel 渲染：批注 / 编辑 / 历史版本')
console.log('\n1 passed')
