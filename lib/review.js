/**
 * 研究结论润色 + 研究综述成文（v0.17 写作层）。
 *
 * 两条产物的分工：
 *   - 研究结论：≤500 字，只做概括，模型可以润色；
 *   - 研究综述：完整文稿，按研究内容分节，确定性骨架 + 模型段落。
 *
 * 铁律：模型只能引用「已确认证据链」里出现过的 (paperId, evidenceId)，
 * 引用白名单校验不通过就退回确定性文本，绝不放过无出处的事实句。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callModel, resolveRoute } from './cardgen.js'
import { readIndex } from './library.js'
import { buildThemeSummary, themeChains } from './themes.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export const SUMMARY_PROMPT_VERSION = 'theme-summary.v1'
export const REVIEW_PROMPT_VERSION = 'theme-review.v1'
export const SUMMARY_MAX_CHARS = 500
/** 允许为了「句子完整」略微超出目标字数，但不超过这里。 */
export const SUMMARY_HARD_CHARS = 750

const CITATION_RE = /\[\[([a-zA-Z0-9_-]+)#\^([a-zA-Z0-9_-]+)\|([^\]]*)\]\]/g

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function loadPrompt(version) {
  return readFileSync(join(HERE, '..', 'prompts', `${version}.md`), 'utf8')
}

const SENTENCE_MARKS = '。！？!?'
const CLAUSE_MARKS = '；;，,、'

/**
 * 按「整句」收尾，不硬截断。
 * 略微超过目标字数没关系，宁可多几十个字，也不要在半句话中间断掉。
 */
export function fitProse(text, ideal = SUMMARY_MAX_CHARS, hard = SUMMARY_HARD_CHARS) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  if (value.length <= hard) return value
  const floor = Math.floor(ideal * 0.6)
  const head = value.slice(0, hard)
  for (let i = hard - 1; i >= floor; i -= 1) {
    if (SENTENCE_MARKS.includes(head[i])) return head.slice(0, i + 1)
  }
  for (let i = hard - 1; i >= floor; i -= 1) {
    if (CLAUSE_MARKS.includes(head[i])) return `${head.slice(0, i)}。`
  }
  return `${head}。`
}

function shortAuthor(authors) {
  const value = String(authors || '').split(/[,，;；、]/)[0].trim()
  return value && value !== '-' && !/^anon$/i.test(value) ? value : ''
}

/** 一条证据的规范引用；节点没存作者时回到文献库记录里补。 */
function citationOf(node, records) {
  const record = records?.get(node?.paperId) || null
  const author = shortAuthor(node?.authors) || shortAuthor(record?.authors)
    || (() => {
      const title = String(record?.title || '').replace(/^[\s\d\-–—:|.]+/, '').trim()
      return title ? title.slice(0, 12) : 'Anon'
    })()
  const year = node?.year || record?.year || ''
  return `[[${node.paperId}#^${node.evidenceId}|${author} ${year}, p.${node.page ?? '?'}]]`
}

function confirmedChains(theme, chains) {
  const list = (chains || themeChains(theme.id).list).filter((chain) => chain.status === 'confirmed')
  return list
}

/** 抽出文本里的引用，返回非法引用清单。 */
export function auditCitations(text, allowed) {
  const found = []
  const invalid = []
  const rest = String(text || '')
  CITATION_RE.lastIndex = 0
  let match = CITATION_RE.exec(rest)
  while (match) {
    const key = `${match[1]}#${match[2]}`
    found.push(key)
    if (allowed && !allowed.has(key)) invalid.push(key)
    match = CITATION_RE.exec(rest)
  }
  return { found, invalid }
}

/**
 * 确定性摘要：模型不可用或润色失败时的兜底，控制在 500 字内。
 */
export function buildSummaryBrief(theme, chains = themeChains(theme.id).list) {
  const confirmed = confirmedChains(theme, chains)
  const facets = (theme.facets || []).filter((facet) => facet.enabled)
  if (!confirmed.length) return { text: '', citations: 0, mode: 'empty' }

  const byFacet = new Map()
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey
    if (!key) continue
    if (!byFacet.has(key)) byFacet.set(key, [])
    byFacet.get(key).push(chain)
  }
  const papers = new Set()
  for (const chain of confirmed) {
    for (const node of chain.nodes || []) if (node?.paperId) papers.add(node.paperId)
  }

  const parts = [
    `本方向已确认 ${confirmed.length} 条证据链，覆盖 ${byFacet.size}/${facets.length} 条研究内容，涉及 ${papers.size} 篇论文。`,
  ]
  for (const facet of facets) {
    const group = byFacet.get(facet.key) || []
    if (!group.length) continue
    const claims = group.map((chain) => String(chain.claim?.text || '').trim()).filter(Boolean)
    if (claims.length) parts.push(`${facet.title}方面，${claims.join('；')}`)
  }
  const missing = facets.filter((facet) => !(byFacet.get(facet.key) || []).length)
  if (missing.length) parts.push(`尚未覆盖：${missing.map((facet) => facet.title).join('、')}。`)

  const text = fitProse(parts.join(''), SUMMARY_MAX_CHARS)
  return { text, citations: confirmed.length, mode: 'brief' }
}

/**
 * 研究结论：模型把证据链清单压成 ≤500 字的连贯段落。
 * 模型只允许「用」白名单里的证据，不允许新造引用。
 */
export async function polishSummary({ ctx, theme, chains = themeChains(theme.id).list } = {}) {
  const confirmed = confirmedChains(theme, chains)
  if (!confirmed.length) return { text: '', citations: 0, mode: 'empty', model: null }

  const digest = buildThemeSummary(theme, chains).text
  const fallback = () => ({ ...buildSummaryBrief(theme, chains), model: null })

  let route = null
  try { route = resolveRoute(ctx) } catch { route = null }
  if (!route) return fallback()

  const user = [
    `【研究主题】${theme.title}`,
    theme.description ? `【研究说明】${theme.description}` : '',
    '',
    '【已确认证据链】（这是你唯一可用的材料）',
    digest,
    '',
    '【任务】',
    `写一段不超过 ${SUMMARY_MAX_CHARS} 字的中文研究结论，概括这些证据链说明了什么。`,
    '要求：',
    '- 直接输出结论正文，不要 JSON、不要标题、不要分点；',
    '- 只做概括，不引入上面材料之外的任何事实、数据或文献；',
    '- 不要写引用标记，也不要写「q-」开头的编号；',
    '- 材料里出现立场冲突时点明「存在分歧」。',
  ].filter(Boolean).join('\n')

  try {
    const result = await callModel(ctx, route, loadPrompt(SUMMARY_PROMPT_VERSION), user, null, {
      maxTokens: 2000,
      reasoningEffort: 'off',
    })
    const text = cleanProse(result.text, SUMMARY_MAX_CHARS)
    if (!text) return fallback()
    return {
      text,
      citations: confirmed.length,
      mode: 'model',
      model: `${route.provider}/${route.model}`,
    }
  } catch (error) {
    return { ...fallback(), warnings: [`润色失败（${error?.code || 'error'}），已退回确定性摘要`] }
  }
}

/** 模型返回的散文：去代码围栏、去引用标记、压到 max 字。 */
function cleanProse(raw, max) {
  let text = String(raw || '').trim()
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim()
  text = text.replace(/\[\[[^\]]*\]\]/g, '')
  text = text.replace(/^["'“]|["'”]$/g, '').trim()
  return fitProse(text, max)
}

/* ---------------- 研究综述 ---------------- */

function facetSection(facet, group, records) {
  const claims = group.map((chain) => String(chain.claim?.text || '').trim()).filter(Boolean)
  const cites = group
    .map((chain) => (chain.nodes || []).find((node) => node?.evidenceId))
    .filter(Boolean)
    .map((node) => citationOf(node, records))
  return { claims, cites }
}

/**
 * 确定性综述骨架：完整分节，每节都有论点和引用。
 * 模型不可用时这就是最终稿；模型可用时作为各节的结构与素材。
 */
export function buildThemeReview(theme, chains = themeChains(theme.id).list) {
  const confirmed = confirmedChains(theme, chains)
  const facets = (theme.facets || []).filter((facet) => facet.enabled)
  const byFacet = new Map()
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey
    if (!key) continue
    if (!byFacet.has(key)) byFacet.set(key, [])
    byFacet.get(key).push(chain)
  }
  const papers = new Set()
  for (const chain of confirmed) {
    for (const node of chain.nodes || []) if (node?.paperId) papers.add(node.paperId)
  }
  const covered = facets.filter((facet) => (byFacet.get(facet.key) || []).length)
  const missing = facets.filter((facet) => !(byFacet.get(facet.key) || []).length)

  const records = new Map(readIndex().map((record) => [record.id, record]))
  const lines = [`# ${theme.title}`, '']
  lines.push(`> 由 ${confirmed.length} 条已确认证据链自动生成 · ${new Date().toISOString().slice(0, 10)}`)
  lines.push(`> 覆盖 ${covered.length}/${facets.length} 条研究内容 · 涉及 ${papers.size} 篇论文`)

  lines.push('', '## 1、研究背景与目标', '')
  if (theme.description) lines.push(String(theme.description).trim(), '')
  lines.push(`本文围绕「${theme.title}」，按 ${facets.length} 条研究内容梳理库内已有工作：`)
  lines.push('')
  for (const facet of facets) {
    const group = byFacet.get(facet.key) || []
    lines.push(`- ${facet.title}：${group.length ? `${group.length} 条已确认证据链` : '暂缺（尚无已确认链）'}`)
  }

  let index = 0
  for (const facet of facets) {
    const group = byFacet.get(facet.key) || []
    if (!group.length) continue
    index += 1
    const { claims } = facetSection(facet, group, records)
    lines.push('', `## ${index + 1}、${facet.title}`, '')
    if (facet.description) lines.push(`> ${facet.description}`, '')
    group.forEach((chain) => {
      const text = String(chain.claim?.text || '').trim()
      const nodes = (chain.nodes || []).filter((node) => node?.evidenceId)
      const against = nodes.filter((node) => node.relation === 'contradicts')
      if (!text) return
      const cite = nodes[0] ? citationOf(nodes[0], records) : ''
      lines.push(`- ${text}${cite ? ` ${cite}` : ''}`)
      for (const node of nodes.filter((item) => item.quote).slice(0, 2)) {
        lines.push(`  > p.${node.page ?? '?'}「${String(node.quote).replace(/\s+/g, ' ').slice(0, 120)}」`)
      }
      if (against.length) {
        lines.push(`  - 反面证据：${against.map((node) => citationOf(node, records)).join(' ')}`)
      }
    })
    if (claims.length > 1) {
      lines.push('', `**小结**：${claims.join('；')}`)
    }
  }

  lines.push('', '## 研究缺口', '')
  if (missing.length) {
    for (const facet of missing) lines.push(`- ${facet.title}：尚无已确认的证据链，暂不作为结论依据。`)
  } else {
    lines.push(`- ${facets.length} 条研究内容均已有确认证据链；仍需检查每条链的样本量与指标可比性。`)
  }

  lines.push('', '## 小结', '')
  const brief = buildSummaryBrief(theme, chains).text
  lines.push(brief || '（暂无已确认证据链）')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('*本文档只使用已确认的证据链；引用格式为双中括号包裹的「论文ID#^证据ID|作者 年, p.N」，未经审核的草稿链未纳入。*')

  return {
    markdown: lines.join('\n').trimEnd() + '\n',
    citations: confirmed.reduce((sum, chain) => sum + (chain.nodes || []).filter((node) => node?.evidenceId).length, 0),
    chains: confirmed.length,
    covered: covered.length,
    total: facets.length,
    missing: missing.map((facet) => facet.title),
  }
}

/**
 * 单节成文：模型把这一节的证据链写成连贯段落，引用必须落在本节白名单内。
 * 校验不过就退回「论点 + 引用」的确定性写法。
 */
export async function polishReviewSection({ ctx, route, theme, facet, group } = {}) {
  const records = new Map(readIndex().map((record) => [record.id, record]))
  const { claims, cites } = facetSection(facet, group, records)
  const deterministic = [
    claims.join('；'),
    cites.slice(0, 2).join(' '),
  ].filter(Boolean).join(' ').trim()
  if (!deterministic) return { text: '', mode: 'empty' }

  const nodes = []
  for (const chain of group) {
    for (const node of chain.nodes || []) {
      if (!node?.evidenceId || !node?.paperId) continue
      nodes.push({
        key: `${node.paperId}#${node.evidenceId}`,
        line: `- [[${node.paperId}#^${node.evidenceId}|${shortAuthor(node.authors) || 'Anon'} ${node.year || ''}, p.${node.page ?? '?'}]] p.${node.page ?? '?'}「${String(node.quote || '').replace(/\s+/g, ' ').slice(0, 160)}」`,
      })
    }
  }
  const allowed = new Set(nodes.map((node) => node.key))

  const user = [
    `【研究主题】${theme.title}`,
    `【本节研究内容】${facet.title}`,
    facet.description ? `【本节要说明】${facet.description}` : '',
    '',
    '【可用的已确认证据】',
    claims.map((text, index) => `${index + 1}. 论点：${text}`).join('\n'),
    '',
    nodes.map((node) => node.line).join('\n'),
    '',
    '【任务】',
    '写一段 200–320 字的中文综述段落，说明这些证据共同说明了什么、彼此有什么差异或分歧。',
    '要求：',
    '- 成文，不要分点，不要"第一/第二"式罗列；',
    '- 每个事实句后面必须带引用，引用必须逐字复制上面列出的 [[...]] 标记，不得改动、不得新造；',
    '- 只使用上面的证据，不引入新文献、不新增结论；',
    '- 只输出段落正文，不要标题、不要解释、不要 Markdown 代码块。',
  ].filter(Boolean).join('\n')

  try {
    const result = await callModel(ctx, route, loadPrompt(REVIEW_PROMPT_VERSION), user, null, {
      maxTokens: 1600,
      reasoningEffort: 'off',
    })
    let body = String(result.text || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim()
    body = body.replace(/^["'“]|["'”]$/g, '').trim()
    if (!body) return { text: deterministic, mode: 'fallback', warnings: ['本节模型没有返回内容'] }

    const warnings = []
    // 越界引用：只删这些标记，句子保留；不整节丢弃
    const first = auditCitations(body, allowed)
    for (const key of new Set(first.invalid)) {
      const [paperId, evidenceId] = key.split('#')
      body = body.replace(
        new RegExp(`\\[\\[${escRe(paperId)}#\\^${escRe(evidenceId)}\\|[^\\]]*\\]\\]`, 'g'),
        '',
      )
    }
    if (first.invalid.length) warnings.push(`删除了 ${first.invalid.length} 处不在证据链内的引用`)

    // 仍然没有可用引用：把本节证据补在段末，保证每段可追溯
    const after = auditCitations(body, allowed)
    if (!after.found.length) {
      if (cites.length) {
        body = `${body.replace(/[。；;\s]+$/, '')}（${cites.join(' ')}）。`
        warnings.push('模型段落缺引用，已在段末补上本节证据')
      } else {
        return { text: deterministic, mode: 'fallback', warnings: ['本节没有可引用的证据'] }
      }
    }

    body = body.replace(/[ \t]{2,}/g, ' ').trim()
    return { text: body, mode: 'model', warnings: warnings.length ? warnings : undefined }
  } catch (error) {
    return { text: deterministic, mode: 'fallback', warnings: [`本节成文失败（${error?.code || 'error'}）`] }
  }
}

/** 正则转义，用于按 ID 删除越界引用。 */
function escRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 组装完整综述：确定性骨架 + （可选）逐节模型成文。
 * 模型失败不影响整体成稿，只会让该节退回确定性写法。
 */
export async function composeReview({ ctx, theme, chains = themeChains(theme.id).list, polish = true } = {}) {
  const base = buildThemeReview(theme, chains)
  const confirmed = confirmedChains(theme, chains)
  if (!confirmed.length) return { ...base, polished: 0, warnings: ['还没有已确认的证据链'] }

  let route = null
  if (polish) {
    try { route = resolveRoute(ctx) } catch { route = null }
  }
  if (!route) {
    return { ...base, polished: 0, warnings: polish ? ['未配置模型，已按确定性骨架成文'] : [] }
  }

  const facets = (theme.facets || []).filter((facet) => facet.enabled)
  const byFacet = new Map()
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey
    if (!key) continue
    if (!byFacet.has(key)) byFacet.set(key, [])
    byFacet.get(key).push(chain)
  }

  const warnings = []
  const covered = facets
    .map((facet) => ({ facet, group: byFacet.get(facet.key) || [] }))
    .filter((item) => item.group.length)
  const results = await mapLimit(covered, 3, (item) => polishReviewSection({ ctx, route, theme, facet: item.facet, group: item.group }))
  let polished = 0
  const sections = []
  covered.forEach((item, index) => {
    const result = results[index]
    if (result.mode === 'model') polished += 1
    if (result.warnings) warnings.push(...result.warnings.map((message) => `${item.facet.title}：${message}`))
    sections.push({ facet: item.facet, text: result.text, mode: result.mode })
  })

  // 用成文段落替换骨架里对应小节的条目列表
  let markdown = base.markdown
  for (const section of sections) {
    if (section.mode !== 'model') continue
    const heading = `## ${facets.filter((facet) => (byFacet.get(facet.key) || []).length).findIndex((facet) => facet.key === section.facet.key) + 2}、${section.facet.title}`
    const start = markdown.indexOf(heading)
    if (start < 0) continue
    const next = markdown.indexOf('\n## ', start + heading.length)
    const end = next < 0 ? markdown.length : next
    const body = markdown.slice(start + heading.length, end)
    const summaryAt = body.indexOf('**小结**')
    const tail = summaryAt >= 0 ? body.slice(summaryAt) : ''
    const bodyText = tail ? `${section.text}\n\n${tail}` : section.text
    markdown = `${markdown.slice(0, start + heading.length)}\n\n${bodyText}\n${markdown.slice(end)}`
  }

  return { ...base, markdown, polished, warnings }
}

/** 并发上限控制：模型调用是 IO 等待，并行能显著压缩综述生成时间。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

export { fail as reviewFail }
