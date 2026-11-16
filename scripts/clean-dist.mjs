#!/usr/bin/env node
/**
 * 清理 dist/ 里的历史发布包，只保留最近 N 个版本。
 * 用法：node scripts/clean-dist.mjs [--keep 5] [--dry-run]
 * 默认保留 5 个；先跑 --dry-run 看会删什么。
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const keepIndex = args.indexOf('--keep')
const keep = keepIndex >= 0 ? Math.max(1, Number(args[keepIndex + 1]) || 5) : 5

const dir = join(root, 'dist')
if (!existsSync(dir)) {
  console.log('[clean-dist] 没有 dist/，无需清理')
  process.exit(0)
}

const packages = readdirSync(dir)
  .filter((name) => /^dsh-litkb-\d+\.\d+\.\d+\.tgz$/.test(name))
  .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs, size: statSync(join(dir, name)).size }))
  .sort((a, b) => b.at - a.at)

const doomed = packages.slice(keep)
if (!doomed.length) {
  console.log(`[clean-dist] 只有 ${packages.length} 个包，保留 ${keep} 个，无需清理`)
  process.exit(0)
}

const bytes = doomed.reduce((sum, item) => sum + item.size, 0)
console.log(
  `[clean-dist] ${dryRun ? '将删除' : '删除'} ${doomed.length} 个旧包，释放 ${(bytes / 1024 / 1024).toFixed(1)}MB：`,
)
for (const item of doomed) {
  console.log(`  - ${item.name}`)
  if (!dryRun) unlinkSync(join(dir, item.name))
}
if (dryRun) console.log('（--dry-run：未真正删除）')
