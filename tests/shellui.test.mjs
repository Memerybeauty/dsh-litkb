/** P4.0 原生主面板：图标 + 页面外壳（假 React，不跑浏览器）。 */
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
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { LitkbIcon, LibraryPage, Workspace, Detail, PdfRail, LitkbSettings, ParsePanel, CardPanel, ManagePanel, TagsEditor, AskPanel, WritingPage, DeepReadPanel, ChainDialog, GraphPanel, ChainGraphView, PaperList, SkeletonRows, AutoChainPanel, SearchPage, ComparePanel } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({
  type: typeof type === 'function' ? type.name : type,
  props: props || {},
  children: children.flat(9).filter((c) => c != null),
})
const ReactStub = {
  createElement: h,
  useState: (v) => {
    const index = globalThis.__i++
    const preset = globalThis.__s?.[index]
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
const injected = []
mod.apply({ effect: (fn) => fn(), slots: { inject: (name) => injected.push(name), register: () => {} } })
assert.ok(source.includes('--dsw-alias-bg-base'), '令牌必须映射宿主 bg-base')
assert.ok(!/--litkb-bg:\s*var\(--litkb-bg\)/.test(source), '令牌不能自引用')
assert.ok(source.includes('--litkb-accent-text:'), 'accent-text 必须定义')
assert.ok(source.includes('--litkb-violet:'), 'violet 必须定义')
assert.ok(source.includes('--litkb-text-3:color-mix'), 'text-3 必须定义')
assert.ok(source.includes('.litkb-theme-light{'), '必须有显式浅色主题类')
assert.ok(source.includes('.litkb-theme-dark{'), '必须有显式深色主题类')
assert.ok(source.includes('.litkb-wbPage{position:relative}'), '抽屉必须相对工作台页定位')
assert.ok(source.includes('.litkb-body.is-graph{'), '图谱页必须有独立高度上下文')
assert.ok(source.includes('.litkb-body.is-graph .litkb-graphPage{height:100%'), '图谱页需占满可用高度')
assert.ok(source.includes('.litkb-moreList{') && source.includes('max-height:min(60vh,420px)'), '标签菜单需限高可滚动')
assert.ok(source.includes('.litkb-ingestBar{'), '入库自动处理需要进度条样式')
assert.ok(
  !source.includes('flex-direction:column;gap:12px;overflow:hidden;padding:18px 24px}'),
  '工作台页不能裁掉下拉菜单',
)
assert.ok(source.includes('.litkb-chainRel.litkb-input'), '关系下拉宽度不能被 .litkb-input 覆盖')
assert.ok(source.includes('.litkb-chainCheck{width:14px'), '复选框类名不能撞添加证据面板')
assert.ok(source.includes('onClick: () => buildFromSelection(selHint)'), '解析页选区建链必须走证据优先')
assert.ok(!source.includes("mode: 'claim', claim: selHint.text"), '不能再把选句当论点')
assert.ok(!source.includes('.litkb-chainPick{width:14px'), '添加证据面板不能被复选框样式压窄')
assert.ok(
  source.includes('onLocate: (page, blockId, blockIds) => onOpenPdf(page, blockId, blockIds)'),
  'Detail 不能用 Workspace 作用域的 openPdf',
)

function render(component, props, states = []) {
  globalThis.__i = 0
  globalThis.__s = states
  return JSON.stringify(mod.__test[component](props))
}

const icon = JSON.stringify(mod.__test.LitkbIcon({ size: 20, active: true }))
assert.ok(icon.includes('"width":20'))
assert.ok(icon.includes('svg'))

const pageEl = mod.__test.LibraryPage({})
assert.equal(pageEl.type, 'Workspace')
const page = render('Workspace', { embedded: true })
assert.ok(page.includes('litkb-panel'))
assert.ok(page.includes('is-embedded'))
assert.ok(page.includes('文献工作台'))
assert.ok(!page.includes('litkb-overlay'))
assert.ok(page.includes('litkb-headTop'))
assert.ok(page.includes('litkb-theme-light'))

const libraryPage = render('Workspace', { embedded: true }, [true, '论文库'])
assert.ok(libraryPage.includes('搜论文 / 作者 / 标签'))
assert.ok(libraryPage.includes('＋ 导入 PDF'))
assert.ok(libraryPage.includes('litkb-headKpis'))
assert.ok(libraryPage.includes('横向精读'))
assert.ok(libraryPage.includes('检索'))
assert.ok(!page.includes('"className":"litkb-page"'), '主面板不能复用 p.N 按钮类，否则全文下划线/按钮尺寸异常')
assert.ok(!page.includes('关闭（Esc）'))
assert.ok(injected.includes('sidebar.panellist'))
assert.ok(injected.includes('main'))
assert.ok(injected.includes('settings.section'))
assert.ok(!injected.includes('shell.overlay'))

const detail = render('Detail', {
  paper: { id: 'p-1', title: 'T', year: 2025, type: '学术期刊', topics: [] },
  tags: [],
  types: ['学术期刊'],
  inline: true,
  onClose() {},
  onSaved() {},
  onRefresh() {},
  onOpenPdf() {},
})
assert.ok(detail.includes('litkb-detailInline'))
assert.ok(!detail.includes('litkb-drawerWrap'))
assert.ok(detail.includes('原文解析'))
assert.ok(detail.includes('精读'))
assert.ok(!detail.includes('精读·11板块'))
assert.ok(detail.includes('litkb-detailMeta'))
assert.ok(detail.includes('打开原文'))
const deepTab = render(
  'Detail',
  {
    paper: { id: 'p-1', title: 'T', year: 2025, type: '学术期刊', topics: [] },
    tags: [],
    types: ['学术期刊'],
    inline: true,
    onClose() {},
    onSaved() {},
    onRefresh() {},
    onOpenPdf() {},
  },
  ['deep'],
)
assert.ok(deepTab.includes('DeepReadPanel'))
assert.ok(!deepTab.includes('ParsePanel'))

const card = {
  model: 'fake',
  generatedAt: '2026-11-05T00:00:00Z',
  status: 'ready',
  sections: [
    { key: 'oneLine', title: '一句话', text: '提出方法。', evidence: ['q-1'] },
    { key: 'method', title: '方法', text: '两阶段。', evidence: ['q-1'] },
  ],
  evidence: [{ id: 'q-1', page: 3, quote: '原文', block: 'b-1' }],
  annotations: [],
  warnings: [],
  statusHistory: [],
}
const pdfCalls = []
globalThis.__i = 0
globalThis.__s = [
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
  '精读',
  false,
  {},
  null,
  null,
]
const tree = mod.__test.CardPanel({
  paper: { id: 'p-1', title: 'T' },
  onChanged() {},
  onOpenPdf: (...args) => pdfCalls.push(args),
})
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const hit = findNode(child, predicate)
    if (hit) return hit
  }
  return null
}
const evidenceButton = findNode(tree, (node) => node.type === 'button' && node.props?.className === 'litkb-evPage')
assert.ok(evidenceButton, 'p.N 按钮存在')
evidenceButton.props.onClick()
assert.deepEqual(pdfCalls, [[3, 'b-1']])

const parseDoc = {
  parser: 'fake',
  stats: { blocks: 1 },
  quality: { layout: 1 },
  pages: [
    {
      page: 1,
      width: 1000,
      height: 1000,
      blocks: [{ id: 'b-1', role: 'paragraph', section: 'method', text: '正文内容', bbox: [0, 0, 1, 1] }],
    },
  ],
}
const parse = render('ParsePanel', { paper: { id: 'p-1' }, flat: true, onOpenPdf() {} }, [
  parseDoc,
  null,
  { paddle: { configured: true, model: 'PaddleOCR-VL-1.6' } },
  null,
  null,
  'source',
  'summary',
  '',
  false,
  false,
  '',
  '',
  false,
  false,
  [],
  false,
  null,
])
assert.ok(parse.includes('正文内容'))
assert.ok(parse.includes('导出 MD'))
assert.ok(!parse.includes('access token'))

const groupDoc = {
  ...parseDoc,
  pages: [
    {
      ...parseDoc.pages[0],
      blocks: [
        parseDoc.pages[0].blocks[0],
        { id: 'b-2', role: 'paragraph', section: 'method', text: '第二块', bbox: [0, 0.2, 1, 0.4] },
      ],
    },
  ],
  paragraphs: [
    {
      page: 1,
      pageEnd: 1,
      role: 'paragraph',
      text: '整段内容',
      blockIds: ['b-1', 'b-2'],
      firstBlockId: 'b-1',
    },
  ],
}
const groupStates = [
  groupDoc,
  null,
  { paddle: { configured: true, model: 'PaddleOCR-VL-1.6' } },
  null,
  null,
  'source',
  'summary',
  '',
  false,
  false,
  '',
  'b-1',
  false,
  true,
  true,
  null,
]
const groupParse = render('ParsePanel', { paper: { id: 'p-1' }, flat: true, onOpenPdf() {} }, groupStates)
assert.ok(groupParse.includes('整段内容'))
assert.equal((groupParse.match(/2px solid var\(--litkb-accent\)/g) || []).length >= 2, true)

function findBy(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const hit = findBy(child, predicate)
    if (hit) return hit
  }
  return null
}
const located = []
globalThis.__i = 0
globalThis.__s = groupStates
const parseTree = mod.__test.ParsePanel({
  paper: { id: 'p-1' },
  flat: true,
  onLocate: (page, blockId, blockIds) => located.push({ page, blockId, blockIds }),
})
findBy(parseTree, (node) => node.props?.id === 'blk-b-1').props.onClick()
assert.equal(located.length, 1)
assert.equal(located[0].page, 1)
assert.equal(located[0].blockId, 'b-1')
assert.deepEqual(located[0].blockIds, ['b-1', 'b-2'])

const railDoc = {
  pages: [
    {
      page: 1,
      width: 1000,
      height: 1000,
      blocks: [
        { id: 'b-1', role: 'paragraph', text: '整段开始', bbox: [0, 0, 1, 0.2] },
        { id: 'b-2', role: 'paragraph', text: '整段结束', bbox: [0, 0.2, 1, 0.4] },
      ],
    },
  ],
}
const railStates = [railDoc, null, 'pdf', 1, 'b-1', null, '', '', 1.35, 'evidence', []]
const groupRail = render(
  'PdfRail',
  {
    paper: { id: 'p-1' },
    page: 1,
    blockId: 'b-1',
    blockIds: ['b-1', 'b-2'],
  },
  railStates,
)
assert.equal((groupRail.match(/2px solid var\(--litkb-accent\)/g) || []).length >= 2, true)

const blockChainReqs = []
globalThis.__i = 0
globalThis.__s = [
  parseDoc,
  null,
  { paddle: { configured: true, model: 'PaddleOCR-VL-1.6' } },
  null,
  null,
  'source',
  'summary',
  '',
  false,
  false,
  '',
  '',
  false,
  false,
  null,
  null,
]
const parseChainTree = mod.__test.ParsePanel({
  paper: { id: 'p-1' },
  flat: true,
  onOpenPdf() {},
  onBuildChain: (request) => blockChainReqs.push(request),
})
let blockChainButton = null
walk(parseChainTree, (node) => {
  if (!blockChainButton && node.type === 'button' && JSON.stringify(node.children).includes('建链'))
    blockChainButton = node
})
assert.ok(blockChainButton, '解析稿每段有建链按钮')
blockChainButton.props.onClick({ stopPropagation() {} })
assert.equal(blockChainReqs.length, 1)
assert.equal(blockChainReqs[0].blockId, 'b-1')
assert.equal(blockChainReqs[0].mode, 'block')

console.log('  ✓ 原生主面板：侧边栏图标 + 嵌入式页面，不再注册 overlay')
console.log('  ✓ 解析稿：平铺渲染，配置项已移出')
console.log('  ✓ 证据 p.N：点击回调携带页码与块')

const rail = render('PdfRail', {
  paper: { id: 'p-1', title: 'T', pages: 10 },
  page: 3,
  blockId: 'b-1',
})
assert.ok(rail.includes('litkb-pdfRail'))
assert.ok(rail.includes('3 / 10'))
assert.ok(rail.includes('/api/litkb/page?id=p-1&page=3'))
console.log('  ✓ 详情内联：无抽屉容器，解析稿入口保留')
const settingsHtml = render('LitkbSettings', {
  initial: {
    settings: {
      library: '/tmp/lib',
      paddle: { configured: true, model: 'PaddleOCR-VL-1.6', enabled: true, source: 'settings' },
    },
    llm: { available: true, route: { provider: 'fake', model: 'fake' } },
  },
})
assert.ok(settingsHtml.includes('文献工作台'))
assert.ok(settingsHtml.includes('PaddleOCR'))
console.log('  ✓ 右栏原文：页码 / 页图常驻')
const manage = render(
  'ManagePanel',
  { tags: [{ name: '分割', count: 2, keywords: [] }], onClose() {}, onChanged() {} },
  ['tags'],
)
assert.ok(manage.includes('标签与术语'))
assert.ok(manage.includes('术语表'))
const tagsHtml = render('TagsEditor', { tags: [{ name: '分割', count: 2, keywords: [] }], onChanged() {} }, [])
assert.ok(tagsHtml.includes('添加标签'))
console.log('  ✓ 设置页：库路径 / PaddleOCR / 模型')
const askInline = render(
  'AskPanel',
  {
    inline: true,
    paper: { id: 'p-1' },
    selection: { text: '选中句', page: 3 },
    onClose() {},
    onOpenPdf() {},
    onSaved() {},
  },
  ['', null, false, '', false, false],
)
assert.ok(askInline.includes('litkb-askInline'))
assert.ok(!askInline.includes('litkb-askWrap'))
console.log('  ✓ 管理页：标签与术语表同屏')
const citationCalls = []
globalThis.__i = 0
globalThis.__s = [
  {
    markdown: '## 2. 研究内容\n\n正文 [[p-1#^q-11111111|p.5]]。',
    sections: [],
    numbers: [{ value: '1.5', page: 5, block: 'b-1', evidenceId: 'q-11111111', verified: true }],
    evidence: [{ id: 'q-11111111', page: 5, block: 'b-1' }],
    model: 'fake',
    generatedAt: '2026-11-05T00:00:00Z',
  },
  null,
  false,
  false,
  '',
]
const citationTree = mod.__test.DeepReadPanel({
  paper: { id: 'p-1' },
  onOpenPdf: (page, block) => citationCalls.push([page, block]),
})
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}
walk(citationTree, (node) => {
  if (node.props?.className === 'litkb-citeChip' && !citationCalls.length) node.props.onClick()
})
assert.deepEqual(citationCalls, [[5, 'b-1']])

const writing = render('WritingPage', { insertRequest: null, onConsumed() {} }, [])
assert.ok(writing.includes('还没有文稿'))
assert.ok(writing.includes('新建文稿'))
const writingPreview = render(
  'WritingPage',
  {
    insertRequest: null,
    onConsumed() {},
    onOpenPaper() {},
  },
  [
    [{ id: 'd-1', title: '测试', chars: 30, citations: 1 }],
    'd-1',
    { id: 'd-1', title: '测试', body: '' },
    '测试',
    '#宋健打开\n\n方法有效 [[p-aaaaaaaa#^q-11111111|Gao 2024, p.3]]。',
    'preview',
    false,
    '已保存',
    '',
    '',
    '',
    [],
    false,
    'citations',
    { citations: [{}], references: [], missing: [] },
    '',
  ],
)
assert.ok(writingPreview.includes('litkb-citeChip'))
assert.ok(writingPreview.includes('Gao 2024, p.3'))
assert.ok(!writingPreview.includes('[[p-aaaaaaaa'))
assert.ok(writingPreview.includes('"type":"h1"'))
assert.ok(writingPreview.includes('宋健打开'))
assert.ok(writingPreview.includes('专注'))
assert.ok(writingPreview.includes('AI 扩写意图'))
console.log('  ✓ 追问面板：右栏内联，无弹窗壳')
const deep = render('DeepReadPanel', { paper: { id: 'p-1', title: 'T' }, onOpenPdf() {} }, [
  null,
  null,
  false,
  false,
  '',
])
assert.ok(deep.includes('还没有精读'))
assert.ok(deep.includes('生成精读'))
const deepMd = render('DeepReadPanel', { paper: { id: 'p-1', title: 'T' }, onOpenPdf() {} }, [
  {
    markdown: '## 1. 文献基本资料\n\n- 标题：T\n\n## 2. 研究内容\n\n问题 [p.2]。',
    sections: [],
    numbers: [{ value: '0.95', sectionTitle: '结论', page: 2, verified: true, quote: '0.95' }],
    model: 'fake',
    generatedAt: '2026-11-05T00:00:00Z',
  },
  null,
  false,
  false,
  '',
])
assert.ok(deepMd.includes('litkb-deepMd'))
assert.ok(deepMd.includes('文献基本资料'))
assert.ok(deepMd.includes('litkb-citeChip'))
assert.ok(deepMd.includes('数值核对'))
const deepClaims = render('DeepReadPanel', { paper: { id: 'p-1', title: 'T' }, onOpenPdf() {}, onBuildChain() {} }, [
  {
    markdown: '## 7. 结论\n\n极坐标改善边界 [[p-1#^q-11111111|p.5]]。',
    sections: [],
    numbers: [],
    model: 'fake',
    generatedAt: '2026-11-05T00:00:00Z',
  },
  null,
  false,
  false,
  '',
  [
    {
      paperId: 'p-1',
      sectionKey: 'conclusion',
      sectionTitle: '结论',
      text: '极坐标改善边界',
      evidenceIds: ['q-11111111'],
      pages: [5],
    },
  ],
  '',
])
assert.ok(deepClaims.includes('论点与证据链'))
assert.ok(deepClaims.includes('用它建链'))
assert.ok(deepClaims.includes('极坐标改善边界'))

const deepSections = render(
  'DeepReadPanel',
  {
    paper: { id: 'p-1', title: 'T' },
    onOpenPdf() {},
    onBuildChain() {},
  },
  [
    {
      markdown: '',
      model: 'fake',
      generatedAt: '2026-11-06T00:00:00Z',
      numbers: [],
      sections: [
        { key: 'profile', title: '文献基本资料', index: 1, markdown: '- 标题：T' },
        { key: 'conclusion', title: '结论', index: 7, markdown: '极坐标改善边界 [[p-1#^q-11111111|p.5]]。' },
      ],
    },
    null,
    false,
    false,
    '',
    [],
    '',
    '',
  ],
)
assert.ok(deepSections.includes('litkb-deepNav'))
assert.ok(deepSections.includes('deep-sec-conclusion'))
assert.ok(deepSections.includes('结论'))
assert.ok(deepSections.includes('隐藏导航'))

const searchPage = render(
  'SearchPage',
  {
    onOpenPaper() {},
    onOpenChain() {},
    onOpenPdf() {},
  },
  [],
)
assert.ok(searchPage.includes('证据链检索'))
assert.ok(searchPage.includes('链答案'))
assert.ok(searchPage.includes('只看证据'))
assert.ok(searchPage.includes('从证据链里找答案'))

const comparePanel = render(
  'ComparePanel',
  {
    papers: [
      { id: 'p-1', title: '论文一' },
      { id: 'p-2', title: '论文二' },
    ],
    onOpenPaper() {},
    onBuildCompareChain() {},
    onSaveCompare() {},
  },
  [
    ['p-1', 'p-2'],
    {
      papers: [
        {
          id: 'p-1',
          title: '论文一',
          authors: 'A',
          year: 2024,
          available: true,
          sections: { conclusion: { title: '结论', index: 7, markdown: 'Dice 0.95。' } },
        },
        {
          id: 'p-2',
          title: '论文二',
          authors: 'B',
          year: 2025,
          available: true,
          sections: { conclusion: { title: '结论', index: 7, markdown: 'Dice 0.80。' } },
        },
      ],
      sections: [{ key: 'conclusion', title: '结论', index: 7 }],
    },
    false,
    false,
    {},
    false,
    '',
    '',
  ],
)
assert.ok(comparePanel.includes('只看差异'))
assert.ok(comparePanel.includes('存为文稿'))
assert.ok(comparePanel.includes('对比链'))
assert.ok(comparePanel.includes('数字差异'))
assert.ok(source.includes('.litkb-compareGrid{'))
assert.ok(!source.includes('.litkb-compareGrid{display:flex'))

const searchResult = render(
  'SearchPage',
  {
    onOpenPaper() {},
    onOpenChain() {},
    onSaveAnswer() {},
    papers: [{ id: 'p-1', title: '论文一' }],
    tags: [{ name: '分割' }],
  },
  [
    '极坐标',
    'answer',
    false,
    {
      answer: '极坐标改善边界 [[p-1#^q-11111111|Wu 2024, p.5]]',
      citations: [{ paperId: 'p-1', page: 5, evidenceId: 'q-11111111', title: '论文一' }],
      chains: [],
      evidence: [],
      trace: [],
      took: 12,
      warnings: [],
    },
    [],
    { paperId: '', tag: '', yearFrom: '', yearTo: '' },
    '',
    false,
    '',
  ],
)
assert.ok(searchResult.includes('全部论文'))
assert.ok(searchResult.includes('全部标签'))
assert.ok(searchResult.includes('复制答案'))
assert.ok(searchResult.includes('存为文稿'))

const autoChain = render(
  'AutoChainPanel',
  {
    onClose() {},
    onChanged() {},
    onOpenChain() {},
  },
  [],
)
assert.ok(autoChain.includes('自动建链与审核'))
assert.ok(autoChain.includes('开始自动建链'))
assert.ok(autoChain.includes('待审核草稿'))
assert.ok(autoChain.includes('高置信度'))
assert.ok(autoChain.includes('跨论文对比 / 矛盾'))

const dialog = render('ChainDialog', {
  seed: {
    mode: 'claim',
    chain: {
      id: 'c-12345678',
      title: '极坐标',
      origin: 'claim',
      status: 'confirmed',
      claim: { text: '极坐标改善边界', paperId: 'p-1', sectionKey: 'conclusion', source: 'deepread' },
      nodes: [
        {
          id: 'n-1',
          relation: 'supports',
          paperId: 'p-1',
          evidenceId: 'q-11111111',
          page: 5,
          block: 'b-1',
          quote: 'polar transform improves boundary',
          title: 'T',
          authors: 'Wu B.',
          year: 2024,
          note: '',
          stale: false,
        },
      ],
    },
  },
  paper: { id: 'p-1', title: 'T' },
  onClose() {},
  onSaved() {},
  onDeleted() {},
  onOpenPdf() {},
  onEvidenceChanged() {},
})
assert.ok(dialog.includes('litkb-chainModal'), '建链是弹窗，不占写作页')
assert.ok(dialog.includes('插入文稿'))
assert.ok(dialog.includes('＋ 新建文稿'))
assert.ok(dialog.includes('添加证据'))
assert.ok(dialog.includes('本论文 0'))
assert.ok(dialog.includes('全库'))

const dialogPick = render(
  'ChainDialog',
  {
    seed: { mode: 'claim', claim: '测试论点', paperId: 'p-1' },
    paper: { id: 'p-1', title: 'T' },
    onClose() {},
    onSaved() {},
    onDeleted() {},
    onOpenPdf() {},
    onEvidenceChanged() {},
  },
  [
    '',
    'claim',
    '',
    '测试论点',
    '',
    { paperId: 'p-1', source: 'manual' },
    [],
    [],
    '',
    '',
    '',
    '',
    [],
    false,
    false,
    [],
    '__new__',
    [
      {
        evidenceId: 'q-11111111',
        paperId: 'p-1',
        page: 5,
        block: 'b-1',
        quote: '已知证据原文',
        title: 'T',
        section: 'conclusion',
      },
    ],
    'paper',
    false,
  ],
)
assert.ok(dialogPick.includes('本论文 1'))
assert.ok(dialogPick.includes('已知证据原文'))
assert.ok(dialogPick.includes('添加'))
console.log('  ✓ 建链弹窗：本论文已知证据可直接添加')
assert.ok(dialog.includes('按问题跨论文找证据'))
assert.ok(dialog.includes('支持'))
assert.ok(dialog.includes('polar transform improves boundary'))
assert.ok(!writing.includes('证据链'), '写作页不再合并证据链')

const railEvidence = render(
  'PdfRail',
  {
    paper: { id: 'p-1', title: 'T', pages: 5 },
    page: 1,
    onBuildChain() {},
  },
  [
    null,
    { evidence: [{ id: 'q-11111111', page: 3, block: 'b-1', quote: '原文证据', section: 'method' }] },
    'evidence',
    1,
    null,
    null,
    '',
    '',
    1,
    'evidence',
    [],
  ],
)
assert.ok(railEvidence.includes('证据 1'))
assert.ok(railEvidence.includes('证据链 0'))
assert.ok(railEvidence.includes('建链'), '证据行可建链')

const railChains = render(
  'PdfRail',
  {
    paper: { id: 'p-1', title: 'T', pages: 5 },
    page: 1,
    onOpenChain() {},
  },
  [
    null,
    { evidence: [] },
    'evidence',
    1,
    null,
    null,
    '',
    '',
    1,
    'chains',
    [
      {
        id: 'c-12345678',
        title: '极坐标链',
        claim: '极坐标改善边界',
        origin: 'claim',
        nodes: 2,
        stale: 0,
        paperIds: ['p-1'],
        claimPaperId: 'p-1',
        updatedAt: '2026-11-05T08:00:00Z',
      },
    ],
  ],
)
assert.ok(railChains.includes('极坐标链'))
assert.ok(railChains.includes('＋ 新建链'))
assert.ok(railChains.includes('2 证据'))

const buildCalls = []
globalThis.__i = 0
globalThis.__s = [
  {
    markdown: '## 7. 结论\n\n极坐标改善边界 [[p-1#^q-11111111|p.5]]。',
    sections: [],
    numbers: [],
    model: 'fake',
    generatedAt: '2026-11-05T00:00:00Z',
  },
  null,
  false,
  false,
  '',
  [
    {
      paperId: 'p-1',
      sectionKey: 'conclusion',
      sectionTitle: '结论',
      text: '极坐标改善边界',
      evidenceIds: ['q-11111111'],
      pages: [5],
    },
  ],
  '',
]
const deepClaimsTree = mod.__test.DeepReadPanel(
  {
    paper: { id: 'p-1', title: 'T' },
    onOpenPdf() {},
    onBuildChain: (request) => buildCalls.push(request),
  },
  [
    {
      markdown: '## 7. 结论\n\n极坐标改善边界 [[p-1#^q-11111111|p.5]]。',
      sections: [],
      numbers: [],
      model: 'fake',
      generatedAt: '2026-11-05T00:00:00Z',
    },
    null,
    false,
    false,
    '',
    [
      {
        paperId: 'p-1',
        sectionKey: 'conclusion',
        sectionTitle: '结论',
        text: '极坐标改善边界',
        evidenceIds: ['q-11111111'],
        pages: [5],
      },
    ],
    '',
  ],
)
let claimButton = null
walk(deepClaimsTree, (node) => {
  if (!claimButton && node.type === 'button' && JSON.stringify(node.children).includes('用它建链')) claimButton = node
})
assert.ok(claimButton, '论点行有建链按钮')
claimButton.props.onClick()
assert.equal(buildCalls.length, 1)
assert.equal(buildCalls[0].claim, '极坐标改善边界')
assert.equal(buildCalls[0].source, 'deepread')
const listLoading = render(
  'PaperList',
  {
    papers: [],
    loading: true,
    filter: '全部',
    onFilter() {},
    onOpen() {},
    onManage() {},
    toolbar: true,
  },
  [],
)
assert.ok(listLoading.includes('SkeletonRows'))
assert.ok(!listLoading.includes('加载中…'))
const skel = render('SkeletonRows', { rows: 2 }, [])
assert.ok(skel.includes('litkb-skelRow'))
assert.ok(skel.includes('is-title'))

const listRows = render(
  'PaperList',
  {
    papers: [
      {
        id: 'p-1',
        title: '测试论文',
        authors: 'Wu B.',
        year: 2024,
        venue: 'Journal',
        type: '学术期刊',
        topics: ['情绪识别', '多模态'],
        status: '精读',
        card: { status: 'ready', evidence: 3 },
      },
    ],
    loading: false,
    filter: '全部',
    onFilter() {},
    onOpen() {},
    onManage() {},
    onAutoChain() {},
    onReview() {},
    toolbar: true,
    selectedId: 'p-1',
  },
  [],
)
assert.ok(listRows.includes('测试论文'))
assert.ok(listRows.includes('情绪识别'))
assert.ok(listRows.includes('精读'))
assert.ok(listRows.includes('自动建链'))
assert.ok(listRows.includes('审核'))

const graphPage = render('GraphPanel', {
  papers: [],
  chainRevision: 0,
  onOpenPaper() {},
  onOpenPdf() {},
  onOpenChain() {},
  onGoLibrary() {},
})
assert.ok(graphPage.includes('ChainGraphView'))
assert.ok(graphPage.includes('概念图谱'))
const graphView = render('ChainGraphView', { chainRevision: 0 }, [])
assert.ok(graphView.includes('加载知识库'))
assert.ok(graphView.includes('自动建链 / 审核'))
console.log('  ✓ 写作页：空态与新建入口')
console.log('  ✓ 精读页：空态与生成入口')
console.log('\n1 passed')
