#!/usr/bin/env node
/**
 * 版本号一致性校验：package.json / package-lock.json / dsh.plugin.json / CHANGELOG / README。
 * 用法：node scripts/check-version.mjs
 * 任一不一致 → 退出码 1，并在 stderr 指出是哪一处。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const fail = []
const seen = []

function expect(label, actual, expected) {
  seen.push({ label, actual })
  if (actual !== expected) fail.push(`${label}: ${actual || '(缺失)'} ≠ ${expected}`)
}

const pkg = JSON.parse(read('package.json'))
const version = String(pkg.version || '')
expect('package.json', version, version)

try {
  const lock = JSON.parse(read('package-lock.json'))
  expect('package-lock.json', String(lock.version || ''), version)
  expect('package-lock.json packages[""]', String(lock.packages?.['']?.version || ''), version)
} catch {
  fail.push('package-lock.json: 无法解析')
}

try {
  const manifest = JSON.parse(read('dsh.plugin.json'))
  expect('dsh.plugin.json', String(manifest.version || ''), version)
} catch {
  fail.push('dsh.plugin.json: 无法解析')
}

const changelog = read('CHANGELOG.md')
const firstHeading = changelog.match(/^##\s+v?(\d+\.\d+\.\d+\S*)/m)
expect('CHANGELOG.md 首条', firstHeading ? firstHeading[1] : '', version)

const readme = read('README.md')
const readmeVersion = readme.match(/\*\*版本\*\*：\*\*(\d+\.\d+\.\d+)\*\*/)
if (readmeVersion) expect('README.md 版本行', readmeVersion[1], version)
else fail.push('README.md: 找不到 **版本**：**x.y.z** 行')

if (fail.length) {
  console.error('[check-version] 版本号不一致：')
  for (const line of fail) console.error(`  ✗ ${line}`)
  console.error(`\n以 package.json 为准统一到 ${version}；发布前先跑 npm version 再同步其余文件。`)
  process.exit(1)
}

console.log(`[check-version] ok ${version}（${seen.length} 处一致：package.json / lock / plugin / CHANGELOG / README）`)
