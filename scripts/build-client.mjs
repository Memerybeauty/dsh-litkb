/**
 * 无构建依赖的客户端拼接器。
 * 源文件是同一个 factory 作用域内的片段；按文件名排序拼成 lib/client.js。
 * 这样保留 DSH ModuleLoader 的单文件加载方式，同时让源码按功能分区。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const srcDir = join(root, 'src', 'client')
const parts = readdirSync(srcDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
if (!parts.length) throw new Error('src/client has no parts')
const body = parts.map((name) => readFileSync(join(srcDir, name), 'utf8')).join('\n')
const banner = `/* eslint-disable */\n/* 由 scripts/build-client.mjs 从 src/client/*.js 生成；不要直接编辑本文件。 */\n`
writeFileSync(join(root, 'lib', 'client.js'), banner + body, 'utf8')
console.log(`[build:client] ${parts.length} parts -> lib/client.js`)
