/**
 * 内联 Markdown 链接的协议白名单：正文里的链接来自模型/PDF，不能直接进 href。
 */
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
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { safeHref, inlineMd } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const h = (type, props, ...children) => ({
  type: typeof type === 'function' ? type.name : type,
  props: props || {},
  children: children.flat(9).filter((c) => c != null),
})
const mod = captured.factory((name) => {
  if (name === 'react') return { createElement: h, useState: (v) => [v, () => {}] }
  throw new Error(name)
})
const { safeHref, inlineMd } = mod.__test

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

test('safeHref 放行 http/https/mailto 与站内相对链接', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(safeHref('http://example.com'), 'http://example.com')
  assert.equal(safeHref('mailto:a@b.com'), 'mailto:a@b.com')
  assert.equal(safeHref('/api/litkb/pdf?id=p-1'), '/api/litkb/pdf?id=p-1')
  assert.equal(safeHref('./notes/x.md'), './notes/x.md')
  assert.equal(safeHref('#section-1'), '#section-1')
})

test('safeHref 拒绝脚本协议、data 与协议相对跳转以外的危险串', () => {
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('JavaScript:alert(1)'), null)
  assert.equal(safeHref(' javascript:alert(1)'), null)
  assert.equal(safeHref('java\tscript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(safeHref('vbscript:msgbox(1)'), null)
  assert.equal(safeHref(''), null)
  assert.equal(safeHref(null), null)
})

test('inlineMd：危险链接退回纯文本，安全链接才渲染成 a', () => {
  const unsafe = inlineMd('见 [点我](javascript:alert(1))')
  assert.equal(
    unsafe.some((node) => node && node.type === 'a'),
    false,
  )
  assert.ok(unsafe.some((node) => node === '见 '))
  assert.ok(unsafe.some((node) => typeof node === 'string' && node.includes('点我')))

  const safe = inlineMd('见 [文档](https://example.com/doc)')
  const anchor = safe.find((node) => node && node.type === 'a')
  assert.ok(anchor, '安全链接应渲染成 a')
  assert.equal(anchor.props.href, 'https://example.com/doc')
  assert.equal(anchor.props.rel, 'noreferrer noopener')
})

console.log(`\n${passed} passed`)
