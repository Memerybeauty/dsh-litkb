#!/usr/bin/env node
/**
 * 语法校验：lib/ 下所有 JS + 关键 JSON。
 * 覆盖 build 产物（lib/client.js、lib/index.js）以及 40 个手写模块——旧版手工枚举 28 个，
 * 新增模块（如 theme-analysis.js）不会自动进检查。
 *
 * 说明：src/ 的分片不是独立 Program（有的在 factory 闭包里、有的以 return 结尾），
 * 单独 --check 必然失败；它们由 build 拼接进 lib/ 后再校验，坏分片同样会被这里拦下。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
let checked = 0

for (const name of readdirSync(join(root, 'lib')).sort()) {
  if (!name.endsWith('.js')) continue
  const file = join(root, 'lib', name)
  checked += 1
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failures.push({
      file: `lib/${name}`,
      message: String(error.stderr || error.message)
        .trim()
        .split('\n')
        .slice(0, 4)
        .join(' '),
    })
  }
}

for (const rel of ['package.json', 'package-lock.json', 'dsh.plugin.json']) {
  checked += 1
  try {
    JSON.parse(readFileSync(join(root, rel), 'utf8'))
  } catch (error) {
    failures.push({ file: rel, message: String(error.message) })
  }
}

if (failures.length) {
  console.error(`[check] ${failures.length} 个文件有问题：`)
  for (const item of failures) console.error(`  ✗ ${item.file}\n    ${item.message}`)
  process.exit(1)
}
console.log(`[check] ok ${checked} 个文件（lib/*.js + 3 个 JSON）`)
