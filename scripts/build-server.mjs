/** 无构建依赖的服务端拼接器：按文件名排序拼成 lib/index.js。 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const srcDir = join(root, 'src', 'server')
const out = join(root, 'lib', 'index.js')
const parts = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
if (!parts.length) throw new Error('src/server has no parts')
const body = parts.map((name) => readFileSync(join(srcDir, name), 'utf8')).join('\n')
const banner = '/* 由 scripts/build-server.mjs 从 src/server/*.js 生成；不要直接编辑本文件。 */\n'

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
console.log(`[build:server] ${parts.length} parts -> lib/index.js`)
