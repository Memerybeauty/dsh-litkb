/** P3 prompt 统一层：版本表、文件存在性、缓存与错误码。 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'

process.env.LITKB_LIBRARY = '/tmp/dsh-litkb-prompts-test'
const { PROMPT_DIR, PROMPT_VERSIONS, listPromptVersions, loadPrompt, promptPath } = await import('../lib/prompts.js')

// 1. 总表里的每个版本都必须有对应文件，且内容非空
for (const version of listPromptVersions()) {
  const file = promptPath(version)
  assert.ok(existsSync(file), `缺少 prompt 文件：${version}.md`)
  const text = loadPrompt(version)
  assert.ok(text.trim().length > 50, `prompt 内容过短：${version}`)
}

// 2. 文件名与版本号一一对应
const files = readdirSync(PROMPT_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort()
for (const version of listPromptVersions()) {
  assert.ok(files.includes(`${version}.md`), `prompts/ 下没有 ${version}.md`)
}

// 3. 同一版本只读一次磁盘（缓存返回同一个字符串）
assert.equal(loadPrompt(PROMPT_VERSIONS.deepRead), loadPrompt(PROMPT_VERSIONS.deepRead))

// 4. 缺失 / 空版本必须显式失败，不能返回空串
assert.throws(
  () => loadPrompt('no-such-prompt.v9'),
  (error) => error.code === 'prompt_missing',
)
assert.throws(
  () => loadPrompt(''),
  (error) => error.code === 'prompt_missing',
)

// 5. 各模块导出的版本常量必须来自总表，避免两处各写一份
const cardgen = await import('../lib/cardgen.js')
const translate = await import('../lib/translate.js')
const ask = await import('../lib/ask.js')
const review = await import('../lib/review.js')
const graph = await import('../lib/graph.js')
assert.equal(cardgen.PROMPT_VERSION, PROMPT_VERSIONS.sevenSections)
assert.equal(translate.PROMPT_VERSION, PROMPT_VERSIONS.translate)
assert.equal(ask.ASK_PROMPT_VERSION, PROMPT_VERSIONS.ask)
assert.equal(review.SUMMARY_PROMPT_VERSION, PROMPT_VERSIONS.themeSummary)
assert.equal(review.REVIEW_PROMPT_VERSION, PROMPT_VERSIONS.themeReview)
assert.equal(graph.EXTRACT_PROMPT_VERSION, PROMPT_VERSIONS.graphExtract)
assert.equal(graph.NORMALIZE_PROMPT_VERSION, PROMPT_VERSIONS.graphNormalize)

// 6. 模块的加载函数与总表内容一致
assert.equal(translate.loadPrompt(), loadPrompt(PROMPT_VERSIONS.translate))
assert.equal(ask.loadAskPrompt(), loadPrompt(PROMPT_VERSIONS.ask))

console.log('prompt tests passed')
