/**
 * 中英对照（P2.3）：按块翻译、术语强制、译后校验、按块缓存。
 *
 * 设计约束：
 * - 逐块翻译，不合并块、不改块序；
 * - 数字/单位/引用标记必须原样保留；术语表命中词必须用指定译名；
 * - 失败只影响该块，原文照常显示；
 * - 缓存按块存，模型/prompt/glossaryHash 变化时懒失效。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATHS } from './library.js'
import { readBlocks } from './blocks.js'
import { checkTermTargets, glossaryHash, readGlossary } from './glossary.js'
import { callModel, resolveRoute } from './cardgen.js'

export const PROMPT_VERSION = 'translate-zh.v1'
const HERE = dirname(fileURLToPath(import.meta.url))
const PROMPT_PATH = join(HERE, '..', 'prompts', `${PROMPT_VERSION}.md`)
const BATCH_CHARS = 2000
const BATCH_ITEMS = 12
const MAX_OUTPUT_TOKENS = 8192

export function loadPrompt() {
  return readFileSync(PROMPT_PATH, 'utf8')
}

export function translationPath(id) {
  return join(PATHS.translations, `${id}.zh.json`)
}

export function readTranslation(id) {
  const file = translationPath(id)
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data.blocks === 'object' ? data : null
  } catch {
    return null
  }
}

export function writeTranslation(doc) {
  if (!existsSync(PATHS.translations)) mkdirSync(PATHS.translations, { recursive: true })
  const file = translationPath(doc.paperId)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
  renameSync(tmp, file)
  return doc
}

export function translationSummary(doc) {
  if (!doc) return null
  const counts = { ok: 0, warn: 0, stale: 0, failed: 0, skipped: 0 }
  for (const block of Object.values(doc.blocks || {})) {
    if (counts[block.status] !== undefined) counts[block.status] += 1
  }
  return {
    model: doc.model,
    prompt: doc.prompt,
    glossaryHash: doc.glossaryHash,
    updatedAt: doc.updatedAt,
    blocks: Object.keys(doc.blocks || {}).length,
    ...counts,
  }
}

function flattenBlocks(doc) {
  const blocks = []
  for (const page of doc.pages || []) {
    for (const block of page.blocks || []) {
      if (!block.text || !block.text.trim()) continue
      if (block.role === 'header' || block.role === 'footer') continue
      blocks.push({ ...block, page: page.page })
    }
  }
  return blocks
}

/** 范围选择：summary / section / paper / block。 */
export function selectBlocks(doc, params = {}) {
  const all = flattenBlocks(doc)
  const scope = params.scope || 'summary'
  if (scope === 'block') {
    const ids = new Set(params.blockIds || [])
    return all.filter((b) => ids.has(b.id))
  }
  if (scope === 'section') {
    return all.filter((b) => b.section === params.section)
  }
  if (scope === 'paper') {
    return all.filter((b) => b.section !== 'references' && b.role !== 'reference')
  }
  // summary 默认：摘要 + 结论
  return all.filter((b) => b.role === 'abstract' || b.section === 'abstract' || b.section === 'conclusion')
}

export function isChineseText(text) {
  const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (String(text).match(/[A-Za-z]/g) || []).length
  return cjk > 0 && cjk >= latin * 0.5
}

const NUMBER_TOKEN = /\[\d+(?:\s*[-–,]\s*\d+)*\]|10\.\d{4,9}\/[^\s，。；、）)]+|\d+(?:[.,]\d+)?\s*%?/g

export function numberTokens(text) {
  return [...new Set((String(text).match(NUMBER_TOKEN) || []).map((t) => t.replace(/\s+/g, '')))]
}

/**
 * 译后校验：数字/引用保留、术语命中、长度。
 * @returns {{ok:boolean, issues:string[]}}
 */
export function validateBlock(source, translation, terms) {
  const issues = []
  const target = String(translation || '').trim()
  if (!target) return { ok: false, issues: ['译文为空'] }
  const compact = target.replace(/\s+/g, '')
  for (const token of numberTokens(source)) {
    if (!compact.includes(token.replace(/\s+/g, ''))) issues.push(`缺少数字/引用：${token}`)
  }
  const missingTerms = checkTermTargets(source, target, terms)
  for (const term of missingTerms) issues.push(`术语未按表：${term.source} → ${term.target}`)
  const sourceLen = String(source).replace(/\s+/g, '').length
  const ratio = target.length / Math.max(1, sourceLen)
  if (sourceLen > 40 && (ratio < 0.3 || ratio > 1.5)) issues.push(`长度异常：${ratio.toFixed(2)}`)
  return { ok: issues.length === 0, issues }
}

export function splitBatches(blocks) {
  const batches = []
  let current = []
  let chars = 0
  for (const block of blocks) {
    const length = block.text.length
    if (current.length && (current.length >= BATCH_ITEMS || chars + length > BATCH_CHARS)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(block)
    chars += length
  }
  if (current.length) batches.push(current)
  return batches
}

function parseArray(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.translations)) return parsed.translations
  throw new Error('模型未返回数组')
}

function glossaryBlock(terms) {
  if (!terms.length) return ''
  const lines = terms.map((t) => `- ${t.source} → ${t.target}`)
  return `\n\n术语表（必须遵守）：\n${lines.join('\n')}`
}

async function translateBatch(ctx, route, blocks, terms, signal) {
  const system = `${loadPrompt()}${glossaryBlock(terms)}`
  const payload = blocks.map((block, index) => ({ i: index, text: block.text }))
  const { text } = await callModel(ctx, route, system, JSON.stringify(payload), signal, {
    maxTokens: MAX_OUTPUT_TOKENS,
    reasoningEffort: 'off',
  })
  const items = parseArray(text)
  const map = new Map()
  for (const item of items) {
    const index = Number(item?.i)
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length) continue
    map.set(index, String(item?.text || '').trim())
  }
  return map
}

function newStore(paperId, route, hash) {
  return {
    schema: 1,
    paperId,
    target: 'zh',
    model: `${route.provider}/${route.model}`,
    prompt: PROMPT_VERSION,
    glossaryHash: hash,
    updatedAt: new Date().toISOString(),
    blocks: {},
  }
}

/**
 * 执行一次翻译。返回 {doc, total, translated, failed}。
 * @param {{ctx:any, record:any, params:object, force?:boolean, onProgress?:Function, signal?:AbortSignal}} input
 */
export async function translateDocument({ ctx, record, params = {}, force = false, onProgress, signal }) {
  const blocksDoc = readBlocks(record.id)
  if (!blocksDoc) {
    throw Object.assign(new Error('解析稿尚未构建，无法翻译'), { code: 'no_blocks' })
  }
  const route = resolveRoute(ctx)
  if (!route) throw Object.assign(new Error('未找到可用的默认模型'), { code: 'no_model' })
  const glossary = readGlossary()
  const hash = glossaryHash(glossary.terms)

  let store = readTranslation(record.id)
  const modelId = `${route.provider}/${route.model}`
  if (!store) {
    store = newStore(record.id, route, hash)
  } else if (store.prompt !== PROMPT_VERSION || store.model !== modelId || store.glossaryHash !== hash) {
    // 术语表 / 模型 / 提示词变化：旧译文保留但标 stale，避免翻译一个范围时把其他块删掉
    for (const block of Object.values(store.blocks || {})) {
      if (block.status === 'ok' || block.status === 'warn') block.status = 'stale'
    }
    store.prompt = PROMPT_VERSION
    store.model = modelId
    store.glossaryHash = hash
    store.updatedAt = new Date().toISOString()
  }

  const selected = selectBlocks(blocksDoc, params)
  if (!selected.length) {
    throw Object.assign(new Error('该范围没有可翻译的块'), { code: 'no_blocks_in_scope' })
  }

  const pending = selected.filter((block) => {
    if (force) return true
    const cached = store.blocks[block.id]
    return !cached || cached.status === 'failed' || cached.status === 'warn' || cached.status === 'stale'
  })
  onProgress?.({ total: pending.length, done: 0, failed: 0, step: '准备翻译' })

  let done = 0
  let failed = 0
  const toTranslate = []
  // 原文已是中文的块直接标 skipped，不浪费模型调用
  for (const block of pending) {
    if (isChineseText(block.text)) {
      store.blocks[block.id] = {
        text: block.text, status: 'skipped', page: block.page, at: new Date().toISOString(),
        issues: ['原文已是中文'],
      }
      done += 1
    } else {
      toTranslate.push(block)
    }
  }
  if (done) {
    store.updatedAt = new Date().toISOString()
    writeTranslation(store)
    onProgress?.({
      total: pending.length, done, failed,
      step: toTranslate.length ? '准备翻译' : '原文已是中文，无需翻译',
    })
  }

  for (const batch of splitBatches(toTranslate)) {
    let result = null
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      try {
        result = await translateBatch(ctx, route, batch, glossary.terms, signal)
      } catch (error) {
        if (attempt === 1) {
          for (const block of batch) {
            store.blocks[block.id] = {
              text: '', status: 'failed', page: block.page, at: new Date().toISOString(),
              issues: [String(error?.message || error)],
            }
            failed += 1
            done += 1
          }
        }
      }
    }
    if (!result) {
      store.updatedAt = new Date().toISOString()
      writeTranslation(store)
      onProgress?.({ total: pending.length, done, failed, step: `翻译 ${done}/${pending.length} 块` })
      continue
    }

    for (let index = 0; index < batch.length; index += 1) {
      const block = batch[index]
      const text = result.get(index) || ''
      if (!text) {
        store.blocks[block.id] = {
          text: '', status: 'failed', page: block.page, at: new Date().toISOString(),
          issues: ['模型未返回该块'],
        }
        failed += 1
      } else {
        const check = validateBlock(block.text, text, glossary.terms)
        store.blocks[block.id] = {
          text, status: check.ok ? 'ok' : 'warn', page: block.page,
          at: new Date().toISOString(), issues: check.issues,
        }
      }
      done += 1
    }
    store.updatedAt = new Date().toISOString()
    writeTranslation(store)
    onProgress?.({ total: pending.length, done, failed, step: `翻译 ${done}/${pending.length} 块` })
  }

  if (!Object.keys(store.blocks).length) {
    throw Object.assign(new Error('没有生成任何译文'), { code: 'empty_translation' })
  }
  onProgress?.({ total: pending.length, done, failed, step: '完成' })
  return { doc: store, total: pending.length, translated: done - failed, failed }
}
