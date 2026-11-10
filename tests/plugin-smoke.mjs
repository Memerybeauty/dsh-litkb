import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

// 测试库放到临时目录，避免写用户的 ~/Documents/文献库
const testLibrary = mkdtempSync(join(tmpdir(), 'dsh-litkb-smoke-'))
process.env.LITKB_LIBRARY = testLibrary

/* ---------- server ---------- */
const server = await import('../lib/index.js')
assert.equal(server.name, 'dsh-litkb')
assert.ok(Array.isArray(server.inject) && server.inject.includes('webServer'))

const routes = []
server.apply({
  webServer: { register: (r) => routes.push(r) },
  logger: { info() {}, warn() {} },
})
assert.equal(routes.length, 81, 'eighty-one routes registered')
const paths = routes.map((r) => r.path).sort()
assert.deepEqual(paths, [
  '/api/litkb/ask',
  '/api/litkb/blocks',
  '/api/litkb/blocks.md',
  '/api/litkb/blocks/build',
  '/api/litkb/card',
  '/api/litkb/card/annotate',
  '/api/litkb/card/evidence',
  '/api/litkb/card/generate',
  '/api/litkb/card/regenerate',
  '/api/litkb/card/restore',
  '/api/litkb/card/section',
  '/api/litkb/card/status',
  '/api/litkb/card/versions',
  '/api/litkb/chains',
  '/api/litkb/chains/auto/jobs',
  '/api/litkb/chains/auto/run',
  '/api/litkb/chains/claims',
  '/api/litkb/chains/dedupe',
  '/api/litkb/chains/delete',
  '/api/litkb/chains/graph',
  '/api/litkb/chains/insert',
  '/api/litkb/chains/layout',
  '/api/litkb/chains/propose',
  '/api/litkb/chains/read',
  '/api/litkb/chains/review',
  '/api/litkb/chains/review/batch',
  '/api/litkb/chains/save',
  '/api/litkb/compare',
  '/api/litkb/concepts',
  '/api/litkb/concepts/merge',
  '/api/litkb/concepts/update',
  '/api/litkb/deepread',
  '/api/litkb/deepread/build',
  '/api/litkb/deepread/compare',
  '/api/litkb/deepread/section',
  '/api/litkb/diag',
  '/api/litkb/drafts',
  '/api/litkb/drafts/assist',
  '/api/litkb/drafts/citations',
  '/api/litkb/drafts/delete',
  '/api/litkb/drafts/export',
  '/api/litkb/drafts/read',
  '/api/litkb/drafts/save',
  '/api/litkb/evidence/backlinks',
  '/api/litkb/evidence/export',
  '/api/litkb/evidence/search',
  '/api/litkb/export',
  '/api/litkb/glossary',
  '/api/litkb/graph',
  '/api/litkb/graph/build',
  '/api/litkb/health',
  '/api/litkb/import',
  '/api/litkb/import/link',
  '/api/litkb/maintenance',
  '/api/litkb/page',
  '/api/litkb/papers',
  '/api/litkb/pdf',
  '/api/litkb/reclassify',
  '/api/litkb/search',
  '/api/litkb/search/answer',
  '/api/litkb/search/history',
  '/api/litkb/settings',
  '/api/litkb/tags',
  '/api/litkb/tags/create',
  '/api/litkb/tags/delete',
  '/api/litkb/themes',
  '/api/litkb/themes/chain',
  '/api/litkb/themes/delete',
  '/api/litkb/themes/explore',
  '/api/litkb/themes/jobs',
  '/api/litkb/themes/jobs/cancel',
  '/api/litkb/themes/match',
  '/api/litkb/themes/outline',
  '/api/litkb/themes/papers',
  '/api/litkb/themes/read',
  '/api/litkb/themes/save',
  '/api/litkb/themes/suggest',
  '/api/litkb/themes/summary',
  '/api/litkb/translate',
  '/api/litkb/update',
  '/api/litkb/vendor/cytoscape.js',
])
const health = routes.find((r) => r.path === '/api/litkb/health')

const res = {
  code: 0,
  headers: null,
  body: '',
  writeHead(code, headers) {
    this.code = code
    this.headers = headers
  },
  end(body) {
    this.body = body
  },
}
await health.handler({ method: 'GET' }, res)
assert.equal(res.code, 200)
const payload = JSON.parse(res.body)
assert.equal(payload.ok, true)
assert.equal(payload.plugin, 'dsh-litkb')
assert.ok(payload.version)

/* ---------- client ---------- */
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (o) => {
      captured = o
    },
  },
}
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
vm.runInThisContext(code, { filename: 'lib/client.js' })
assert.ok(captured, 'module loader called')
assert.equal(captured.id, 'dsh-litkb')

const ReactStub = {
  createElement: (...args) => ({ type: args[0] }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error('unexpected require: ' + name)
})
assert.equal(typeof mod.apply, 'function')
assert.equal(mod.name, 'dsh-litkb')
assert.ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), 'declares slots service')

const injected = []
const styles = []
globalThis.document = {
  head: { appendChild: (el) => styles.push(el) },
  createElement: () => ({ setAttribute() {}, remove() {}, style: {} }),
}
mod.apply({
  effect: (fn) => {
    fn()
  },
  slots: {
    inject: (name) => injected.push(name),
    register: () => {},
  },
})
assert.ok(injected.includes('sidebar.panellist'), 'native sidebar panel icon')
assert.ok(injected.includes('main'), 'native main panel')
assert.ok(injected.includes('settings.section'), 'native settings section')
assert.ok(!injected.includes('shell.overlay'), 'overlay must not be registered')
assert.ok(!injected.includes('sidebar.footer.action'), 'footer entry replaced by panel icon')
assert.equal(styles.length, 1, 'stylesheet injected')

console.log('smoke OK · version', payload.version, '· slots', injected.join(', '))
rmSync(testLibrary, { recursive: true, force: true })
