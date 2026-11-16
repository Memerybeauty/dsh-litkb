#!/usr/bin/env node
/**
 * P2 客户端分片边界校验。
 *
 * 客户端受 DSH ModuleLoader 限制必须打成单文件（lib/client.js），12 个分片共享
 * 同一个 factory 闭包。为了让「每个分片能单独维护」，这里用显式契约代替模块边界：
 *
 * 1. 兄弟分片之间禁止裸引用对方的名字，一律走 SHARED.xxx；
 * 2. 每个分片在文件末尾用 Object.assign(SHARED, { ... }) 登记自己对外提供的名字；
 * 3. src/client/contracts.json 固化「谁用了谁的什么」，新增依赖必须显式登记；
 * 4. 00-base.js 是共享底座（React / h / api / 格式化工具），允许各片裸用，不纳入契约。
 *
 * 用法：
 *   node scripts/check-client-boundaries.mjs           校验
 *   node scripts/check-client-boundaries.mjs --update  重新生成 contracts.json
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src', 'client')
const contractPath = join(clientDir, 'contracts.json')
const require = createRequire(join(root, 'package.json'))
const espree = require('espree')
const eslintScope = require('eslint-scope')

const BASE = '00-base.js'
const update = process.argv.includes('--update')

const files = readdirSync(clientDir).filter((name) => name.endsWith('.js')).sort()
if (!files.length) {
  console.error('[boundaries] src/client 下没有分片')
  process.exit(1)
}
const parts = files.map((name) => readFileSync(join(clientDir, name), 'utf8'))
const joined = parts.join('\n')

// 解析「拼接后」的脚本：分片单独看不是完整程序，拼起来才是 factory 闭包。
const ast = espree.parse(joined, { ecmaVersion: 2022, sourceType: 'script', range: true, loc: true })
const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script' })
const factory = (() => {
  let found = null
  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ArrowFunctionExpression' && parent?.type === 'Property' && parent.key?.name === 'factory') found = node
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (Array.isArray(value)) for (const child of value) walk(child, node)
      else if (value && typeof value.type === 'string') walk(value, node)
    }
  }
  walk(ast, null)
  return found
})()
if (!factory) {
  console.error('[boundaries] 找不到 ModuleLoader 的 factory 函数')
  process.exit(1)
}

// 位置 → 分片
const spans = []
let offset = 0
for (let i = 0; i < files.length; i += 1) {
  spans.push({ start: offset, end: offset + parts[i].length, index: i })
  offset += parts[i].length + 1
}
const fragmentAt = (position) => spans.find((span) => position >= span.start && position < span.end)

const scope = manager.acquire(factory)
const bare = []
const providersByFragment = {}
for (const variable of scope.variables) {
  if (variable.defs.length !== 1) continue
  const defFragment = fragmentAt(variable.defs[0].name.range[0])
  if (!defFragment || files[defFragment.index] === BASE) continue
  const cross = variable.references
    .map((ref) => ({ ref, fragment: fragmentAt(ref.identifier.range[0]) }))
    .filter(({ fragment }) => fragment && fragment.index !== defFragment.index)
  if (!cross.length) continue
  for (const { ref, fragment } of cross) {
    bare.push({
      file: files[fragment.index],
      line: joined.slice(0, ref.identifier.range[0]).split('\n').length,
      name: variable.name,
      from: files[defFragment.index],
    })
  }
  if (!update) continue
  providersByFragment[files[defFragment.index]] ||= new Set()
  providersByFragment[files[defFragment.index]].add(variable.name)
}

// 解析每个分片登记 / 消费的 SHARED 名字
const declaredProviders = {}
const declaredConsumers = {}
for (let i = 0; i < files.length; i += 1) {
  const name = files[i]
  const text = parts[i]
  for (const match of text.matchAll(/Object\.assign\(\s*SHARED\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    const names = match[1].split(',').map((item) => item.trim()).filter(Boolean)
    declaredProviders[name] = [...new Set([...(declaredProviders[name] || []), ...names])].sort()
  }
  const used = [...new Set([...text.matchAll(/\bSHARED\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))].sort()
  if (used.length) declaredConsumers[name] = used
}

const known = new Set(Object.values(declaredProviders).flat())
const problems = []

// 1. 兄弟分片不得裸引用
for (const hit of bare) {
  problems.push(`${hit.file}:${hit.line} 裸引用 ${hit.name}（来自 ${hit.from}），请改成 SHARED.${hit.name}`)
}

// 2. 用到的 SHARED 名字必须有分片登记
for (const [consumer, names] of Object.entries(declaredConsumers)) {
  for (const name of names) {
    if (!known.has(name)) problems.push(`${consumer} 使用 SHARED.${name}，但没有任何分片登记提供它`)
  }
}

// 3. Object.assign 里登记的必须是本片定义的名字
for (const [name, names] of Object.entries(declaredProviders)) {
  const defined = new Set([...parts[files.indexOf(name)].matchAll(/^    (?:async )?function ([A-Za-z0-9_$]+)|^    (?:const|let) ([A-Za-z0-9_$]+)/gm)].map((match) => match[1] || match[2]))
  for (const n of names) if (!defined.has(n)) problems.push(`${name} 登记了 SHARED.${n}，但本片没有定义 ${n}`)
}

if (update) {
  const contract = {
    version: 1,
    note: '客户端分片契约：providers = 每片对外提供的名字；consumers = 每片经 SHARED 使用的名字。由 scripts/check-client-boundaries.mjs --update 生成。',
    providers: Object.fromEntries(Object.entries(declaredProviders).sort(([a], [b]) => a.localeCompare(b))),
    consumers: Object.fromEntries(Object.entries(declaredConsumers).sort(([a], [b]) => a.localeCompare(b))),
  }
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`)
  console.log(`[boundaries] 已更新 ${contractPath}`)
  process.exit(0)
}

// 4. 实际使用时与 contracts.json 对齐（新增依赖必须显式登记）
let contract = { providers: {}, consumers: {} }
try {
  contract = JSON.parse(readFileSync(contractPath, 'utf8'))
} catch {
  problems.push('缺少 src/client/contracts.json，请运行 node scripts/check-client-boundaries.mjs --update')
}
for (const [consumer, names] of Object.entries(declaredConsumers)) {
  const allowed = new Set(contract.consumers?.[consumer] || [])
  for (const name of names) {
    if (!allowed.has(name)) problems.push(`${consumer} 新增了未登记的依赖 SHARED.${name}，确认后用 --update 写回契约`)
  }
}
for (const [consumer, names] of Object.entries(contract.consumers || {})) {
  const actual = new Set(declaredConsumers[consumer] || [])
  for (const name of names) {
    if (!actual.has(name)) problems.push(`${consumer} 的契约里有 SHARED.${name}，但代码已不再使用，请用 --update 收紧契约`)
  }
}
for (const [provider, names] of Object.entries(declaredProviders)) {
  const declared = new Set(contract.providers?.[provider] || [])
  for (const name of names) if (!declared.has(name)) problems.push(`${provider} 新登记了 SHARED.${name}，请用 --update 写回契约`)
}

if (problems.length) {
  console.error('[boundaries] 客户端分片边界校验失败：')
  for (const line of problems) console.error(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`[boundaries] OK · ${files.length} 个分片 · ${known.size} 个 SHARED 名字 · 0 处裸引用`)
