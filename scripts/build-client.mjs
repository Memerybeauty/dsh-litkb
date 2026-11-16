/**
 * 无构建依赖的客户端拼接器。
 * 源文件是同一个 factory 作用域内的片段；按文件名排序拼成 lib/client.js。
 * 这样保留 DSH ModuleLoader 的单文件加载方式，同时让源码按功能分区。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const srcDir = join(root, 'src', 'client')
const out = join(root, 'lib', 'client.js')
const parts = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
if (!parts.length) throw new Error('src/client has no parts')
const body = parts.map((name) => readFileSync(join(srcDir, name), 'utf8')).join('\n')
const banner = `/* 由 scripts/build-client.mjs 从 src/client/*.js 生成；不要直接编辑本文件。 */\n/* 浏览器全局与 lint 规则见 eslint.config.js 的 lib/client.js 段。 */\n`

// 先写临时文件并做语法检查，通过后再原子替换：
// 坏源码不会覆盖上一份可用产物，build 也不会「成功但产物不可加载」。
const tmp = `${out}.build.tmp.js`
writeFileSync(tmp, banner + body, 'utf8')
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
} catch (error) {
  rmSync(tmp, { force: true })
  console.error(String(error.stderr || error.message))
  process.exit(1)
}
renameSync(tmp, out)
console.log(`[build:client] ${parts.length} parts -> lib/client.js`)
