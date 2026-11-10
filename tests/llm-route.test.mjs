/** 工作台模型路由：固定 DeepSeek / 跟随宿主 / 环境变量覆盖。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-llm-route-'))
process.env.LITKB_LIBRARY = root
delete process.env.LITKB_LLM_PROVIDER
delete process.env.LITKB_LLM_MODEL

const { ensureLibrary } = await import('../lib/library.js')
const { publicSettings, writeSettings } = await import('../lib/settings.js')
const { resolveRoute, callModel } = await import('../lib/cardgen.js')
ensureLibrary()

function hostCtx() {
  return {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      }
      if (name === 'llm') {
        return {
          stream(options) {
            this.captured = options
            return (async function* () {
              yield { type: 'text-delta', text: 'ok' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      return undefined
    },
  }
}

/* ---------- 默认跟随宿主 ---------- */
assert.deepEqual(resolveRoute(hostCtx()), { provider: 'deepseek-account', model: 'deepseek-flash' })
assert.equal(publicSettings().llm.mode, 'host')

/* ---------- 固定 DeepSeek ---------- */
writeSettings({ llm: { mode: 'fixed', provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
assert.deepEqual(resolveRoute(hostCtx()), { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
assert.equal(publicSettings().llm.mode, 'fixed')
assert.equal(publicSettings().llm.model, 'deepseek-v4-pro')

/* ---------- 环境变量优先 ---------- */
process.env.LITKB_LLM_PROVIDER = 'env-provider'
process.env.LITKB_LLM_MODEL = 'env-model'
assert.deepEqual(resolveRoute(hostCtx()), { provider: 'env-provider', model: 'env-model' })
delete process.env.LITKB_LLM_PROVIDER
delete process.env.LITKB_LLM_MODEL

/* ---------- DeepSeek V4 不支持 off，映射为 high ---------- */
function streamCtx() {
  const captured = []
  return {
    captured,
    ctx: {
      get(name) {
        if (name !== 'llm') return undefined
        return {
          stream(options) {
            captured.push(options)
            return (async function* () {
              yield { type: 'text-delta', text: 'ok' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      },
    },
  }
}

const first = streamCtx()
await callModel(first.ctx, { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, 's', 'u', null, {
  reasoningEffort: 'off',
})
assert.equal(first.captured[0].reasoningEffort, 'high')

const second = streamCtx()
await callModel(second.ctx, { provider: 'deepseek-account', model: 'deepseek-flash' }, 's', 'u', null, {
  reasoningEffort: 'off',
})
assert.equal(second.captured[0].reasoningEffort, 'off')

/* ---------- 切回宿主 ---------- */
writeSettings({ llm: { mode: 'host', provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
assert.deepEqual(resolveRoute(hostCtx()), { provider: 'deepseek-account', model: 'deepseek-flash' })
assert.equal(publicSettings().llm.mode, 'host')

console.log('llm route tests passed')
