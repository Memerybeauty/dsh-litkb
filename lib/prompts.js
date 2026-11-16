/**
 * Prompt 统一入口（P3）。
 *
 * 以前每个模块各自拼 `join(HERE, '..', 'prompts', ...)`，版本常量散在 6 个文件里：
 * 升一版 prompt 要改多处，评测结果也无法和版本号一一对上。
 * 现在只有这一张版本表 + 一个加载函数；模块只声明「我用哪个版本」。
 *
 * 加载失败会抛 `prompt_missing`，而不是返回空串——空 prompt 会静默产出垃圾结果。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PROMPT_DIR = join(HERE, '..', 'prompts')

/**
 * prompt 版本总表。
 * 约定：文件名 = `<version>.md`；升级 prompt 时新增文件并在这里改一行。
 */
export const PROMPT_VERSIONS = Object.freeze({
  sevenSections: 'seven-sections.v2',
  deepRead: 'deep-read.v1',
  translate: 'translate-zh.v1',
  ask: 'ask-page-cited.v1',
  answer: 'chain-answer.v1',
  claim: 'chain-claim.v1',
  writeEvidence: 'write-evidence.v1',
  graphExtract: 'graph-extract.v1',
  graphNormalize: 'graph-normalize.v1',
  themeSummary: 'theme-summary.v1',
  themeReview: 'theme-review.v1',
})

const cache = new Map()

export function promptPath(version) {
  return join(PROMPT_DIR, `${version}.md`)
}

/** 读取并缓存 prompt 正文；同一进程内同一个版本只读一次磁盘。 */
export function loadPrompt(version) {
  const name = String(version || '').trim()
  if (!name) throw Object.assign(new Error('缺少 prompt 版本'), { code: 'prompt_missing' })
  if (cache.has(name)) return cache.get(name)
  let text
  try {
    text = readFileSync(promptPath(name), 'utf8')
  } catch (error) {
    throw Object.assign(new Error(`prompt 文件缺失：${name}.md`), { code: 'prompt_missing', cause: error })
  }
  cache.set(name, text)
  return text
}

/** 供测试与诊断：列出总表里所有版本。 */
export function listPromptVersions() {
  return Object.values(PROMPT_VERSIONS).sort()
}
