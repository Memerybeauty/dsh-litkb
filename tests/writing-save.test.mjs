/**
 * 退出时保存：组件卸载时没有 await 的机会，只能 sendBeacon / fetch(keepalive)。
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
  "return { name: 'dsh-litkb', inject: ['slots'], apply, __test: { saveOnExit } }",
)
vm.runInThisContext(source, { filename: 'lib/client.js' })

const mod = captured.factory((name) => {
  if (name === 'react') return { createElement: () => null, useState: (v) => [v, () => {}] }
  throw new Error(name)
})
const { saveOnExit } = mod.__test

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

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalFetch = globalThis.fetch
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}
function restore() {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete globalThis.navigator
  globalThis.fetch = originalFetch
}

test('优先用 sendBeacon，body 是可解析的 JSON', () => {
  const calls = []
  setNavigator({
    sendBeacon: (path, blob) => {
      calls.push({ path, blob })
      return true
    },
  })
  globalThis.fetch = () => {
    throw new Error('不该走 fetch')
  }
  const ok = saveOnExit('/api/litkb/drafts/save', { id: 'd-1', title: 't', body: 'b' })
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/api/litkb/drafts/save')
  assert.equal(calls[0].blob.type, 'application/json')
})

test('sendBeacon 拒绝时退回 fetch(keepalive)', () => {
  setNavigator({ sendBeacon: () => false })
  const calls = []
  globalThis.fetch = (path, options) => {
    calls.push({ path, options })
    return Promise.resolve({ ok: true })
  }
  const ok = saveOnExit('/api/litkb/drafts/save', { id: 'd-1' })
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.keepalive, true)
  assert.equal(JSON.parse(calls[0].options.body).id, 'd-1')
})

test('两者都不可用时返回 false，交给调用方提示', () => {
  setNavigator(undefined)
  delete globalThis.fetch
  try {
    const ok = saveOnExit('/api/litkb/drafts/save', { id: 'd-1' })
    assert.equal(ok, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

restore()
console.log(`\n${passed} passed`)
