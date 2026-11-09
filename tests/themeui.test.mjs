/** 研究工作台渲染冒烟（假 React）：左列表 + 右工作区（论文 / 证据链 / 写作）。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let captured = null
globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o } } }
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  .replace("return { name: 'dsh-litkb', inject: ['slots'], apply }", "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { ThemePage } }")
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9).filter((c) => c != null) })
const ReactStub = {
  createElement: h,
  useState: (v) => {
    const index = globalThis.__i++
    const preset = globalThis.__s[index]
    return [preset !== undefined ? preset : (typeof v === 'function' ? v() : v), () => {}]
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
globalThis.window.document = globalThis.document
mod.apply({ effect: (fn) => fn(), slots: { inject: () => {}, register: () => {} } })

function render(states) {
  globalThis.__i = 0
  globalThis.__s = states
  return JSON.stringify(mod.__test.ThemePage({ papers: [{ id: 'p-1', title: 'Polar paper' }], tags: [] }))
}

const detail = {
  theme: {
    id: 't-1', title: '视盘研究', tags: ['分割'], description: '综述第二章',
    facets: [{ key: 'f1', title: '极坐标变换', description: 'polar', keywords: ['polar'], enabled: true }],
    summary: { text: '' }, papers: { include: [], exclude: [] },
  },
  facetChains: [{ facetKey: 'f1', chain: { id: 'c-1', status: 'draft', confidence: 0.7, nodes: 2, title: '极坐标' } }],
  chains: [{ id: 'c-1', status: 'draft', provenance: { facetKey: 'f1', themeId: 't-1' }, nodes: [{ paperId: 'p-1' }] }],
  stats: { papers: 1, facets: 1, confirmed: 0, drafts: 1, gaps: 0 },
  papers: [{
    paperId: 'p-1', title: 'Polar paper', year: 2024, score: 3.2, facets: ['f1'],
    evidence: 2, chainCount: 1, source: 'match',
  }],
  draft: null,
}

const listTheme = {
  id: 't-1', title: '视盘研究', tags: ['分割'], draftId: '', updatedAt: '2026-11-09T00:00:00Z',
  stats: { facets: 1, papers: 1, confirmed: 0, drafts: 1, gaps: 0 },
}

const empty = render([[], '', null, '', '', '', null, null, null, '', false, null, false])
assert.ok(empty.includes('从一个研究开始'))
assert.ok(empty.includes('新建研究'))
assert.ok(empty.includes('还没有研究'))

const unselected = render([[listTheme], '', null, '', '', '', null, null, null, '', false, null, false])
assert.ok(unselected.includes('视盘研究'))
assert.ok(unselected.includes('从左栏选一个研究'))
assert.ok(!unselected.includes('先确认这些论文是否切题'), '未选中研究时不显示研究操作')

const selected = render([[listTheme], 't-1', detail, '', '', '', null, null, null, '', false, null, false])
assert.ok(selected.includes('论文 1'))
assert.ok(selected.includes('先确认这些论文是否切题'))
assert.ok(selected.includes('Polar paper'))
assert.ok(selected.includes('证据链'))
assert.ok(selected.includes('极坐标变换'))
assert.ok(selected.includes('待审草稿'))
assert.ok(selected.includes('写作'))
assert.ok(selected.includes('生成提纲'))
assert.ok(!selected.includes('在写作页打开'), '写作统一回主写作页')
assert.ok(selected.includes('还没有文稿'))

const editing = render([
  [], '', null, '', '', '', null, null,
  { title: '新研究', description: '', tags: '', facets: [{ title: '', description: '', keywords: '' }] },
  '', false, null, false,
])
assert.ok(editing.includes('新建研究'))
assert.ok(editing.includes('细分描述'))
assert.ok(editing.includes('AI 帮我拆'))

const withDraft = { ...detail, draft: { id: 'd-1', title: '视盘研究 · 初稿', chars: 120, citations: 3, missing: 0, updated: '' } }
const writing = render([[listTheme], 't-1', withDraft, '', '', '', null, null, null, '', false, null, false])
assert.ok(writing.includes('打开写作页'))
assert.ok(writing.includes('追加提纲到文稿'))

console.log('  ✓ 空态 / 左列表 / 未选中')
console.log('  ✓ 论文优先：表格 + 匹配入口')
console.log('  ✓ 证据链：细分 / 待审 / 覆盖矩阵')
console.log('  ✓ 写作：只生成提纲 + 跳写作页')
console.log('\n4 passed')
