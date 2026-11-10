/** 产品化 UI 冒烟：首次欢迎、上手进度、隐藏与完成态。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (options) => {
      captured = options
    },
  },
}
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replace(
  "return { name: 'dsh-litkb', inject: ['slots'], apply }",
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { OnboardingPanel, formatBytes, LitkbSettings } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(9).filter((child) => child != null),
})
const ReactStub = {
  createElement: h,
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
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

function render(props) {
  return JSON.stringify(
    mod.__test.OnboardingPanel({
      onDismiss: () => {},
      onImport: () => {},
      onOpenLibrary: () => {},
      onOpenWriting: () => {},
      onCreateTheme: () => {},
      ...props,
    }),
  )
}

const emptyGuide = {
  ok: true,
  version: '0.11.0',
  items: [
    { key: 'paper', title: '导入第一篇论文', hint: 'PDF 拖拽', done: false, count: 0, target: 'library' },
    { key: 'card', title: '生成七段卡', hint: '打开论文', done: false, count: 0, target: 'library' },
    { key: 'chain', title: '建一条证据链', hint: '审核确认', done: false, count: 0, target: 'library' },
    { key: 'theme', title: '建一个研究并探索', hint: '开始探索', done: false, count: 0, target: 'theme' },
    { key: 'draft', title: '写一份文稿', hint: '插入引用', done: false, count: 0, target: 'writing' },
  ],
  completed: 0,
  total: 5,
  next: 'paper',
  counts: { papers: 0, cards: 0, chains: 0, themes: 0, drafts: 0 },
}

const welcome = render({ guide: emptyGuide, dismissed: false })
assert.match(welcome, /把论文变成可追溯的证据链/)
assert.match(welcome, /导入第一篇 PDF/)
assert.match(welcome, /浏览论文库/)
assert.match(welcome, /新建研究/)

const progressGuide = {
  ...emptyGuide,
  counts: { ...emptyGuide.counts, papers: 2, cards: 1 },
  completed: 2,
  next: 'chain',
}
const progress = render({ guide: progressGuide, dismissed: false })
assert.match(progress, /上手进度/)
assert.match(progress, /2\/5/)
assert.match(progress, /建一条证据链/)
assert.doesNotMatch(progress, /把论文变成可追溯的证据链/)

assert.equal(render({ guide: progressGuide, dismissed: true }), 'null')
const complete = { ...emptyGuide, completed: 5, counts: { papers: 3, cards: 3, chains: 2, themes: 1, drafts: 1 } }
assert.equal(render({ guide: complete, dismissed: false }), 'null')
const forced = render({ guide: complete, dismissed: false, force: true })
assert.match(forced, /上手完成/)
assert.match(forced, /5\/5/)
assert.match(forced, /关闭/)
assert.equal(render({ guide: null, dismissed: false }), 'null')

assert.equal(mod.__test.formatBytes(0), '0 B')
assert.equal(mod.__test.formatBytes(2048), '2.0 KB')
assert.equal(mod.__test.formatBytes(5 * 1024 * 1024), '5.0 MB')

const settingsHtml = JSON.stringify(
  mod.__test.LitkbSettings({
    initial: {
      settings: {
        library: '/tmp/litkb',
        paddle: { configured: false, source: '', model: 'PaddleOCR-VL-1.6', enabled: true },
      },
      llm: { available: true, route: { provider: 'deepseek', model: 'deepseek-chat' } },
    },
  }),
)
assert.match(settingsHtml, /数据与备份/)
assert.match(settingsHtml, /下载整库备份/)
assert.match(settingsHtml, /从备份恢复/)
assert.match(settingsHtml, /上手引导/)
assert.match(settingsHtml, /重新显示上手引导/)
assert.match(settingsHtml, /关于/)
assert.match(settingsHtml, /复制诊断信息/)

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
for (const text of [
  '/api/litkb/backup',
  '/api/litkb/restore?confirm=restore',
  '下载整库备份',
  '从备份恢复',
  '复制诊断信息',
]) {
  assert.ok(client.includes(text), `client 包含 ${text}`)
}

console.log('product UI tests passed')
