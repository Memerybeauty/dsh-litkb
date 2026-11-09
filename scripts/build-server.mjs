/** 无构建依赖的服务端拼接器：按文件名排序拼成 lib/index.js。 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root = process.cwd()
const srcDir = join(root, 'src', 'server')
const parts = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
if (!parts.length) throw new Error('src/server has no parts')
const body = parts.map((name) => readFileSync(join(srcDir, name), 'utf8')).join('\n')
writeFileSync(
  join(root, 'lib', 'index.js'),
  `/* 由 scripts/build-server.mjs 从 src/server/*.js 生成；不要直接编辑本文件。 */\n${body}`,
  'utf8',
)
console.log(`[build:server] ${parts.length} parts -> lib/index.js`)
