/**
 * 七段卡生成（P2.1）：
 *   分页原文 → 章节切分 → 预算裁剪 → 一次模型调用 → JSON 校验
 *   → 引文回贴原文（证据块）→ 卡片对象。
 *
 * 不编造：模型给的引文必须能在原文定位，定位失败就丢弃并记 warning；
 * 模型漏段就写「需人工补充」，状态降为 partial。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitSections } from './sections.js'
import { buildPageIndex, locateQuote, makeEvidence } from './evidence.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PROMPT_VERSION = 'seven-sections.v2'
const PROMPT_PATH = join(HERE, '..', 'prompts', `${PROMPT_VERSION}.md`)

export const SECTION_DEFS = [
  { key: 'oneLine', title: '一句话', needsEvidence: true },
  { key: 'problem', title: '问题与动机', needsEvidence: true },
  { key: 'method', title: '方法', needsEvidence: true },
  { key: 'data', title: '数据与实验', needsEvidence: true },
  { key: 'results', title: '结果', needsEvidence: true },
  // 局限与「与我的课题」含作者判断与我的判断，不强制引文。
  { key: 'limits', title: '局限', needsEvidence: false },
  { key: 'relevance', title: '与我的课题', needsEvidence: false },
]
const EVIDENCE_KEYS = SECTION_DEFS.filter((d) => d.needsEvidence).map((d) => d.key)

/** 喂给模型的正文预算：整篇不超过 48k 字符，按章节分配。 */
const TOTAL_BUDGET = 48000
const SECTION_BUDGET = {
  abstract: 2200,
  intro: 3500,
  related: 2500,
  method: 5500,
  experiment: 3500,
  results: 4000,
  discussion: 2500,
  conclusion: 2500,
  other: 2500,
  full: 14000,
}
const BODY_KEYS = new Set(Object.keys(SECTION_BUDGET))
const MODEL_TIMEOUT_MS = 240000
const MAX_OUTPUT_TOKENS = 8192
const COMPACT_RETRY_HINT = '\n\n【输出限制】只输出 JSON，不要任何解释；每段不超过 100 字；每段最多 1 条引文，引文不超过 50 字。'

export function loadPrompt() {
  return readFileSync(PROMPT_PATH, 'utf8')
}

/** 模型路由：环境变量优先，其次宿主默认模型。 */
export function resolveRoute(ctx) {
  const envProvider = process.env.LITKB_LLM_PROVIDER
  const envModel = process.env.LITKB_LLM_MODEL
  if (envProvider && envModel) return { provider: envProvider, model: envModel }
  try {
    const selection = ctx?.get?.('agentDefaultModel')?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch { /* 默认模型服务未就绪时按不可用处理 */ }
  return null
}

export function llmStatus(ctx) {
  const llm = ctx?.get?.('llm')
  const route = resolveRoute(ctx)
  let providers = []
  try {
    providers = (llm?.listProviders?.() || []).map((p) => p.id || p.name).filter(Boolean)
  } catch { /* 目录读取失败不影响可用性判断 */ }
  return { available: Boolean(llm?.stream), route, providers }
}

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

/** 章节正文 → 提示词里的「分页原文」块。 */
export function buildPaperInput(record, sections) {
  const chunks = []
  let used = 0
  for (const section of sections) {
    if (!BODY_KEYS.has(section.key)) continue
    const budget = SECTION_BUDGET[section.key] || 2500
    const parts = Array.isArray(section.parts) && section.parts.length
      ? section.parts
      : [{ page: section.startPage, text: section.text }]
    let body = ''
    for (const part of parts) {
      body += `【p.${part.page}】${part.text}\n`
      if (body.length > budget) break
    }
    let clipped = false
    if (body.length > budget) {
      body = body.slice(0, budget)
      clipped = true
    }
    if (used + body.length > TOTAL_BUDGET) break
    chunks.push(`### ${section.title}（p.${section.startPage}–p.${section.endPage}）${clipped ? '（节选）' : ''}\n${body}`)
    used += body.length
  }

  if (!chunks.length) {
    const fallback = sections[0]
    chunks.push(`### 全文\n${String(fallback?.text || '').slice(0, TOTAL_BUDGET)}`)
  }

  const head = [
    `【标题】${record.title || '(未命名)'}`,
    `【类型】${record.type || '—'}`,
    `【年份】${record.year || '—'}`,
    `【作者】${record.authors || '—'}`,
    `【期刊/会议】${record.venue || '—'}`,
    `【主题标签】${(record.topics || []).join('、') || '—'}`,
    '',
    '【分页原文】',
    '',
  ].join('\n')
  return { system: loadPrompt(), user: `${head}\n${chunks.join('\n\n')}` }
}

/** 流式调用宿主模型，返回拼好的文本与用量。 */
export async function callModel(ctx, route, system, user, externalSignal, options = {}) {
  const llm = ctx?.get?.('llm')
  if (!llm?.stream) throw fail('no_llm', '宿主未提供模型服务')
  if (!route) throw fail('no_model', '未找到可用的默认模型')

  const signals = [AbortSignal.timeout(MODEL_TIMEOUT_MS)]
  if (externalSignal) signals.push(externalSignal)
  const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]

  let text = ''
  let usage = null
  let failure = ''
  let finishKind = ''
  const request = {
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0.2,
    maxTokens: options.maxTokens || MAX_OUTPUT_TOKENS,
    signal,
  }
  // 结构化抽取不需要思考链；关掉 thinking，避免推理 token 吃掉输出预算
  if (options.reasoningEffort !== null) request.reasoningEffort = options.reasoningEffort || 'off'
  try {
    const stream = llm.stream(request)
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') {
        const kind = chunk.reason?.kind
        finishKind = kind || ''
        if (kind === 'error' || kind === 'aborted') {
          failure = chunk.reason?.failure?.message || (kind === 'aborted' ? '模型调用被中止' : '模型调用失败')
        }
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw fail('timeout', '模型调用超时（4 分钟），可重试')
    }
    if (/reasoning effort|UNSUPPORTED_REASONING_EFFORT|thinking/i.test(`${error?.code || ''} ${error?.message || ''}`)) {
      throw fail('unsupported_effort', String(error?.message || error))
    }
    throw fail('llm_error', `模型调用失败：${error?.message || error}`)
  }
  if (failure) {
    if (/reasoning effort|thinking/i.test(failure)) throw fail('unsupported_effort', failure)
    throw fail('llm_error', failure)
  }
  if (finishKind === 'max-tokens') throw fail('truncated', '模型输出被截断（max-tokens），请重试')
  if (!text.trim()) throw fail('empty_output', '模型没有返回内容')
  return { text, usage }
}

/** 从模型输出里抠出 JSON（容忍代码块、前后解释、尾逗号）。 */
export function parseModelJson(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw fail('bad_json', '模型输出不是 JSON')
  let body = text.slice(start, end + 1)
  body = body.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(body)
  } catch {
    throw fail('bad_json', '模型输出 JSON 解析失败')
  }
}

/** JSON → 卡片对象；引文逐条回贴原文，失败的丢弃并记 warning。 */
export function normalizeCard({ parsed, record, pages, route, usage }) {
  const pageIndex = buildPageIndex(pages)
  const byPage = new Map(pageIndex.map((p) => [p.page, p]))
  const evidence = new Map()
  const sections = []
  const warnings = []
  let missing = 0
  const note = (msg) => { if (!warnings.includes(msg)) warnings.push(msg) }

  for (const def of SECTION_DEFS) {
    const raw = parsed?.[def.key]
    let text = typeof raw === 'string' ? raw : String(raw?.text || '')
    text = text.trim()
    if (!text) {
      text = '（模型未给出这一段，需人工补充）'
      missing += 1
      note(`「${def.title}」缺失`)
    }

    const quotes = Array.isArray(raw?.quotes) ? raw.quotes.slice(0, 2) : []
    const ids = []
    for (const item of quotes) {
      const quoteText = typeof item === 'string' ? item : String(item?.quote || '')
      if (!quoteText.trim()) continue
      const hint = Number(item?.page) || 0
      const located = locateQuote(quoteText, pageIndex, hint)
      if (!located) {
        note(`「${def.title}」有引文未能在原文定位，已丢弃`)
        continue
      }
      const pageEntry = byPage.get(located.page)
      const recordEvidence = makeEvidence(pageEntry, located)
      if (!evidence.has(recordEvidence.id)) {
        evidence.set(recordEvidence.id, { ...recordEvidence, section: def.key })
      }
      ids.push(recordEvidence.id)
    }
    if (!ids.length && def.needsEvidence) note(`「${def.title}」没有可核验的原文引文`)
    sections.push({ key: def.key, title: def.title, text, evidence: ids })
  }

  const covered = sections.filter((s) => EVIDENCE_KEYS.includes(s.key) && s.evidence.length > 0).length
  return {
    paperId: record.id,
    title: record.title,
    promptVersion: PROMPT_VERSION,
    model: `${route.provider}/${route.model}`,
    generatedAt: new Date().toISOString(),
    status: covered === EVIDENCE_KEYS.length && missing === 0 ? 'ready' : 'partial',
    usage: usage || null,
    source: {
      pages: pages.length,
      chars: record.chars ?? pages.reduce((n, p) => n + p.text.length, 0),
      quality: record.quality ?? null,
    },
    sections,
    evidence: [...evidence.values()],
    warnings,
  }
}

/** 一步到位：分章节 → 调模型 → 校验 → 返回卡片。 */
export async function generateCard({ ctx, record, pages, signal }) {
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const split = splitSections(pages)
  const { system, user } = buildPaperInput(record, split.sections)

  async function call(options, extra) {
    return callModel(ctx, route, system, extra ? user + extra : user, signal, options)
  }

  let result
  try {
    result = await call({ reasoningEffort: 'off' })
  } catch (error) {
    if (error?.code === 'truncated') {
      try {
        result = await call({ reasoningEffort: 'off', maxTokens: MAX_OUTPUT_TOKENS }, COMPACT_RETRY_HINT)
      } catch (retryError) {
        if (retryError?.code === 'truncated') {
          throw fail('truncated', '模型输出仍超过 8192 token（已用紧凑模式重试），请稍后再试')
        }
        throw retryError
      }
    } else if (error?.code === 'unsupported_effort') {
      // 个别部署不支持关闭思考：退回适配器默认值，但把输出预算放宽
      result = await call({ reasoningEffort: null })
    } else {
      throw error
    }
  }

  let parsed
  try {
    parsed = parseModelJson(result.text)
  } catch (error) {
    if (error?.code !== 'bad_json') throw error
    // 输出被截断/写坏时，用更严格的紧凑提示重试一次
    result = await call({ reasoningEffort: 'off', maxTokens: MAX_OUTPUT_TOKENS }, COMPACT_RETRY_HINT)
    parsed = parseModelJson(result.text)
  }

  const card = normalizeCard({ parsed, record, pages, route, usage: result.usage })
  card.source.detectedSections = split.detected
  card.source.promptChars = user.length
  return card
}

/** 单段重生成：只让模型写七段中的一段，返回 {key,text,evidence[]}。 */
export async function generateCardSection({ ctx, record, pages, key, signal }) {
  const def = SECTION_DEFS.find((d) => d.key === key)
  if (!def) throw fail('invalid_key', `未知段落：${key}`)
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const split = splitSections(pages)
  const { system, user } = buildPaperInput(record, split.sections)
  const only = `${system}\n\n【本次只重写一段】只输出 JSON 对象：{"text":"…","quotes":[{"quote":"原文逐字片段","page":3}]}。只写「${def.title}」这一段，不要输出其他六段。`

  let result
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await callModel(ctx, route, only, user, signal, { maxTokens: 2048, reasoningEffort: 'off' })
      break
    } catch (error) {
      if (error?.code === 'truncated' && attempt === 0) continue
      throw error
    }
  }

  const parsed = parseModelJson(result.text)
  const raw = parsed?.[key] && typeof parsed[key] === 'object' ? parsed[key] : parsed
  const text = String(raw?.text || '').trim()
  if (!text) throw fail('empty_output', '模型没有返回该段内容')

  const pageIndex = buildPageIndex(pages)
  const byPage = new Map(pageIndex.map((p) => [p.page, p]))
  const evidence = []
  const quotes = Array.isArray(raw?.quotes) ? raw.quotes.slice(0, 2) : []
  for (const item of quotes) {
    const quoteText = typeof item === 'string' ? item : String(item?.quote || '')
    if (!quoteText.trim()) continue
    const located = locateQuote(quoteText, pageIndex, Number(item?.page) || 0)
    if (!located) continue
    const entry = makeEvidence(byPage.get(located.page), located)
    if (!evidence.some((e) => e.id === entry.id)) evidence.push(entry)
  }
  return { key, text, evidence, model: `${route.provider}/${route.model}`, usage: result.usage }
}

/** 把单段结果合并进整卡，并重算状态/警告。 */
export function applySection(card, patch, title) {
  const sections = card.sections || []
  const target = sections.find((s) => s.key === patch.key)
  if (!target) throw fail('invalid_key', '卡片里没有该段')
  const oldIds = new Set(target.evidence || [])

  for (const ev of patch.evidence || []) {
    if (!(card.evidence || []).some((e) => e.id === ev.id)) {
      card.evidence = [...(card.evidence || []), { ...ev, section: patch.key }]
    }
  }
  target.text = patch.text
  target.evidence = (patch.evidence || []).map((e) => e.id)

  // 只清理“原本只被这一段引用、现在不再被任何段引用”的旧证据
  const stillUsed = new Set(sections.flatMap((s) => s.evidence || []))
  card.evidence = (card.evidence || []).filter((e) => !oldIds.has(e.id) || stillUsed.has(e.id))

  // 重算警告
  const warnings = []
  for (const section of sections) {
    const def = SECTION_DEFS.find((d) => d.key === section.key)
    if (!section.text || section.text.includes('需人工补充')) warnings.push(`「${section.title}」缺失`)
    if (!section.evidence?.length && def?.needsEvidence) warnings.push(`「${section.title}」没有可核验的原文引文`)
  }
  card.warnings = [...new Set(warnings)]
  card.status = sections.every((s) => s.text && !s.text.includes('需人工补充'))
    && SECTION_DEFS.filter((d) => d.needsEvidence).every((d) => (sections.find((s) => s.key === d.key)?.evidence || []).length)
    ? 'ready' : 'partial'
  card.updatedAt = new Date().toISOString()
  card.lastSection = { key: patch.key, title, at: card.updatedAt, model: patch.model }
  return card
}
