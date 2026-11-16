#!/usr/bin/env node
/**
 * 路由归属校验（P0 后续）。
 *
 * 91 条路由拆在 src/server/*-routes-*.js 之后，容易出现三类漂移：
 *   1. 新路由加进了错误的域文件；
 *   2. 删了路由但清单/文档没跟着改；
 *   3. 同一个路径在两个文件里各注册一次。
 *
 * 这个脚本把「路径 → 域文件」固化成 src/server/routes.json，并用 docs/28 的
 * 路由总数做交叉校验。任何新增/移动都要显式 --update 并一起提交。
 *
 * 用法：
 *   node scripts/check-routes.mjs           校验
 *   node scripts/check-routes.mjs --update  重新生成清单
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, 'src', 'server')
const manifestPath = join(serverDir, 'routes.json')
const docsPath = join(root, 'docs', '28_API参考.md')
const update = process.argv.includes('--update')

const files = readdirSync(serverDir)
  .filter((name) => /^\d+-routes-.+\.js$/.test(name))
  .sort()
if (!files.length) {
  console.error('[routes] src/server 下没有路由域文件')
  process.exit(1)
}

const groups = {}
const owner = new Map()
const duplicated = []
for (const file of files) {
  const text = readFileSync(join(serverDir, file), 'utf8')
  const paths = [...text.matchAll(/\broute\(\s*'([^']+)'/g)].map((match) => match[1]).sort()
  groups[file] = paths
  for (const path of paths) {
    if (owner.has(path)) duplicated.push(`${path}（${owner.get(path)} 与 ${file}）`)
    else owner.set(path, file)
  }
}

const count = [...owner.keys()].length

if (update) {
  const manifest = {
    version: 1,
    note: '路由归属清单：路径 → 域文件。由 scripts/check-routes.mjs --update 生成，改动路由时必须一起提交。',
    count,
    groups,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`[routes] 已更新 ${manifestPath}（${count} 条 / ${files.length} 个域）`)
  process.exit(0)
}

const problems = []

// 1. 路径重复
for (const item of duplicated) problems.push(`路由重复注册：${item}`)

// 2. 与清单一致
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch {
  problems.push('缺少 src/server/routes.json，请运行 node scripts/check-routes.mjs --update')
  manifest = { groups: {}, count: 0 }
}
for (const file of files) {
  const expected = new Set(manifest.groups?.[file] || [])
  const actual = new Set(groups[file])
  for (const path of actual)
    if (!expected.has(path)) problems.push(`${file} 新增路由 ${path}，确认归属后用 --update 写回清单`)
  for (const path of expected)
    if (!actual.has(path)) problems.push(`${file} 清单里有 ${path}，但代码已不再注册，请用 --update 收紧清单`)
}
for (const file of Object.keys(manifest.groups || {})) {
  if (!files.includes(file)) problems.push(`清单里的 ${file} 已不存在`)
}
if (Number(manifest.count) !== count) problems.push(`清单总数 ${manifest.count} ≠ 实际 ${count}`)

// 3. 与文档交叉校验
let docs = ''
try {
  docs = readFileSync(docsPath, 'utf8')
} catch {
  problems.push('缺少 docs/28_API参考.md')
}
const documentedCount = docs.match(/共注册 \*\*(\d+)\*\* 条/)
if (!documentedCount) problems.push('docs/28 里找不到「共注册 **N** 条」')
else if (Number(documentedCount[1]) !== count)
  problems.push(`docs/28 写的是 ${documentedCount[1]} 条，实际 ${count} 条`)

for (const file of files) {
  if (!docs.includes(file)) problems.push(`docs/28 的「实现位置」表没有提到 ${file}`)
}

if (problems.length) {
  console.error('[routes] 路由归属校验失败：')
  for (const line of problems) console.error(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`[routes] OK · ${count} 条路由 / ${files.length} 个域 · 无重复 · 与文档一致`)
