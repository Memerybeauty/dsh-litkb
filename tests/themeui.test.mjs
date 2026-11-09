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

const chain = {
  id: 'c-1', status: 'draft', confidence: 0.7, title: '极坐标',
  claim: { text: '极坐标变换改善边界。' },
  provenance: { facetKey: 'f1', themeId: 't-1', matcher: 'theme-match.v1' },
  warnings: ['只有 1 篇论文支撑'],
  nodes: [{
    paperId: 'p-1', paperTitle: 'Polar paper', title: 'Polar paper', page: 3, block: 'b-1',
    evidenceId: 'q-11112222', quote: 'Polar transform improves Dice to 0.95.', relation: 'supports',
  }],
}
const detail = {
  theme: {
    id: 't-1', title: '视盘研究', tags: ['分割'], description: '综述第二章',
    facets: [{ key: 'f1', title: '极坐标变换', description: 'polar', keywords: ['polar'], enabled: true }],
    summary: { text: '' }, papers: { include: [], exclude: [] },
  },
  chains: [chain],
  facetChains: [{ facetKey: 'f1', chain: { id: 'c-1', status: 'draft', confidence: 0.7, nodes: 1, title: '极坐标' } }],
  stats: { papers: 1, facets: 1, confirmed: 0, drafts: 1, gaps: 0 },
  papers: [{
    paperId: 'p-1', title: 'Polar paper', year: 2024, score: 3.2, facets: ['f1'],
    evidence: 2, chainCount: 1, source: 'match',
  }],
  draft: null,
}

const listTheme = {
  id: 't-1', title: '视盘研究', tags: ['分割'], draftId: '', updatedAt: '2026-11-09T00:00:00Z',
  stats: { facets: 1, papers: 1, confirmed: 1, drafts: 0, gaps: 0 },
}

const empty = render([[], '', null, '', '', '', null, null, null, '', false, '', '', false])
assert.ok(empty.includes('个人工作台'))
assert.ok(empty.includes('还没有研究'))
assert.ok(empty.includes('新建研究'))

const cards = render([[listTheme], '', null, '', '', '', null, null, null, '', false, '', '', false])
assert.ok(cards.includes('视盘研究'))
assert.ok(cards.includes('1/1 条链'))
assert.ok(cards.includes('未开始写作'))

const selected = render([[listTheme], 't-1', detail, '', '', '', null, null, null, '', false, 'f1', 'c-1', false])
assert.ok(selected.includes('研究总览'))
assert.ok(selected.includes('证据链'))
assert.ok(selected.includes('链详情'))
assert.ok(selected.includes('极坐标变换改善边界'))
assert.ok(selected.includes('Polar transform improves Dice'))
assert.ok(selected.includes('确认这条链'))
assert.ok(selected.includes('去写作'))
assert.ok(selected.includes('Polar paper'))

const confirmedDetail = { ...detail, chains: [{ ...chain, status: 'confirmed' }] }
const confirmed = render([[listTheme], 't-1', confirmedDetail, '', '', '', null, null, null, '', false, 'f1', 'c-1', false])
assert.ok(confirmed.includes('插入写作'))
assert.ok(confirmed.includes('已确认'))

const editing = render([
  [], '', null, '', '', '', null, null,
  { title: '新研究', description: '', tags: '', facets: [{ title: '', description: '', keywords: '' }] },
  '', false, '', '', false,
])
assert.ok(editing.includes('新建研究'))
assert.ok(editing.includes('细分描述'))
assert.ok(editing.includes('AI 帮我拆'))

console.log('  ✓ 卡片总览：空态 / 统计 / 进度')
console.log('  ✓ 三栏：研究总览 / 证据链 / 链详情')
console.log('  ✓ 链操作：确认 / 插入写作')
console.log('  ✓ 新建研究弹窗')
console.log('\n4 passed')
