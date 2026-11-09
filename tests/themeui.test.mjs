/** 研究工作台渲染冒烟（假 React）：总览 / 研究内容 / 论文 / 写作。 */
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

const base = [[], '', null, 'content', '', '', '', null, null, null, '', false, null, false]

const empty = render(base)
assert.ok(empty.includes('研究工作台'))
assert.ok(empty.includes('还没有研究'))
assert.ok(empty.includes('新建研究'))

const overview = render([
  [{ id: 't-1', title: '视盘研究', tags: ['分割'], draftId: 'd-1', updatedAt: '2026-11-09T00:00:00Z', stats: { facets: 3, papers: 2, confirmed: 1, drafts: 1, gaps: 1 } }],
  '', null, 'content', '', '', '', null, null, null, '', false, null, false,
])
assert.ok(overview.includes('视盘研究'))
assert.ok(overview.includes('已确认'))
assert.ok(overview.includes('待审'))
assert.ok(overview.includes('缺口'))

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

const content = render([[], 't-1', detail, 'content', '', '', '', null, null, null, '', false, null, false])
assert.ok(content.includes('研究内容'))
assert.ok(content.includes('极坐标变换'))
assert.ok(content.includes('草稿'))
assert.ok(content.includes('看链'))
assert.ok(content.includes('综合结论'))
assert.ok(content.includes('匹配预览'))
assert.ok(content.includes('覆盖矩阵'))

const papersView = render([[], 't-1', detail, 'papers', '', '', '', null, null, null, '', false, null, false])
assert.ok(papersView.includes('手动加入论文'))
assert.ok(papersView.includes('Polar paper'))
assert.ok(papersView.includes('移出'))

const withDraft = {
  ...detail,
  draft: { id: 'd-1', title: '视盘研究 · 初稿', chars: 120, citations: 3, missing: 0, updated: '' },
}
const writing = render([[], 't-1', withDraft, 'writing', '', '', '', null, null, null, '', false, null, false])
assert.ok(writing.includes('研究文稿'))
assert.ok(writing.includes('生成提纲'))
assert.ok(writing.includes('追加到文稿'))
assert.ok(writing.includes('在写作页打开'))

const editing = render([
  [], '', null, 'content', '', '', '', null, null,
  { title: '新研究', description: '', tags: '', facets: [{ title: '', description: '', keywords: '' }] },
  '', false, null, false,
])
assert.ok(editing.includes('新建研究'))
assert.ok(editing.includes('细分描述'))
assert.ok(editing.includes('AI 帮我拆'))

console.log('  ✓ 总览：空态 / 表头 / 统计')
console.log('  ✓ 研究内容：细分卡片 / 状态 / 结论')
console.log('  ✓ 论文：列表 / 手动加入')
console.log('  ✓ 写作：文稿状态 / 提纲入口')
console.log('\n4 passed')
