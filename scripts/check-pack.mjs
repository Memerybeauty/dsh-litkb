#!/usr/bin/env node
/**
 * 发布包体积守门：`npm pack --dry-run` 只打包 files 白名单。
 * 目标：运行时只需要 lib/ + prompts/ + 清单文件，docs 截图与 src 不应进包。
 * 用法：node scripts/check-pack.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_UNPACKED = 3 * 1024 * 1024

let report
try {
  // 独立缓存目录：避免受用户 ~/.npm 权限/脏缓存影响
  const cache = mkdtempSync(join(tmpdir(), 'dsh-litkb-pack-'))
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  report = JSON.parse(out)
} catch (error) {
  console.error('[check-pack] npm pack --dry-run 失败：')
  console.error(String(error.stderr || error.message))
  process.exit(1)
}

const item = Array.isArray(report) ? report[0] : report
if (!item) {
  console.error('[check-pack] 没有拿到 pack 报告')
  process.exit(1)
}

const files = item.files || []
const problems = []
const unpacked = Number(item.unpackedSize) || 0

if (unpacked > MAX_UNPACKED) {
  problems.push(
    `unpackedSize ${(unpacked / 1024 / 1024).toFixed(2)}MB 超过 ${(MAX_UNPACKED / 1024 / 1024).toFixed(1)}MB`,
  )
}
for (const entry of files) {
  if (entry.path.startsWith('docs/')) problems.push(`不应打包 docs/：${entry.path}`)
  if (entry.path.startsWith('src/')) problems.push(`不应打包 src/：${entry.path}`)
}

// 运行时必需品必须在包里
for (const required of ['lib/index.js', 'lib/client.js', 'dsh.plugin.json', 'cordis.patch.yml']) {
  if (!files.some((entry) => entry.path === required)) problems.push(`缺少运行时文件：${required}`)
}

if (problems.length) {
  console.error('[check-pack] 发布包不符合预期：')
  for (const line of problems.slice(0, 12)) console.error(`  ✗ ${line}`)
  console.error(`\n当前包：${files.length} 个文件 / ${(unpacked / 1024 / 1024).toFixed(2)}MB（解包）`)
  process.exit(1)
}

console.log(`[check-pack] ok ${files.length} 个文件 / ${(unpacked / 1024 / 1024).toFixed(2)}MB（解包）`)
