/**
 * P4.9 论文精读：11 个板块的结构化 Markdown 说明。
 * 只做“读懂后的转述”，不抄原文；落 deepread/<paperId>.json。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATHS } from './library.js'
import { readCard, writeCard } from './cards.js'
import { buildPaperInput, callModel, resolveRoute } from './cardgen.js'
import { splitSections } from './sections.js'
import { loadPaperPages } from './pdftext.js'
import { buildPageIndex, locateQuote, makeEvidence } from './evidence.js'
import { findBlockForQuote, readBlocks } from './blocks.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROMPT_VERSION = 'deep-read.v1'

export const DEEP_SECTIONS = [
  { key: 'profile', title: '文献基本资料' },
  { key: 'content', title: '研究内容' },
  { key: 'method', title: '方法' },
  { key: 'sample', title: '样本量' },
  { key: 'timeline', title: '研究时间' },
  { key: 'figures', title: '图表解析' },
  { key: 'conclusion', title: '结论' },
  { key: 'innovation', title: '创新点' },
  { key: 'limitations', title: '局限性' },
  { key: 'reproducibility', title: '可复刻性' },
  { key: 'takeaways', title: '核心要点' },
]

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function deepPath(id) {
  return join(PATHS.deepread, `${id}.json`)
}

export function readDeepRead(id) {
  if (!/^p-[a-zA-Z0-9_-]+$/.test(String(id || '')) || !existsSync(deepPath(id))) return null
  try { return JSON.parse(readFileSync(deepPath(id), 'utf8')) } catch { return null }
}

export function writeDeepRead(data) {
  if (!existsSync(PATHS.deepread)) mkdirSync(PATHS.deepread, { recursive: true })
  writeFileSync(deepPath(data.paperId), JSON.stringify(data, null, 2), 'utf8')
  return data
}

function displayType(record, pages) {
  const head = (pages || []).slice(0, 3).map((page) => page.text || '').join(' ').slice(0, 4000)
  if (/学位论文|硕士|博士|专业学位/.test(head)) return '学位论文'
  if (/会议|Proceedings|Conference/i.test(head)) return '会议'
  return record.type || '原文未说明'
}

function profileMarkdown(record, pages) {
  const rows = [
    ['标题', record.title || '原文未说明'],
    ['作者', record.authors || '原文未说明'],
    ['期刊/会议', record.venue || '原文未说明'],
    ['年份', record.year || '原文未说明'],
    ['DOI', record.doi || '原文未说明'],
    ['类型', displayType(record, pages)],
  ]
  return rows.map(([key, value]) => `- ${key}：${String(value).replace(/\s+/g, ' ').trim()}`).join('\n')
}

function cleanBody(text) {
  return String(text || '')
    .replace(/^\s*```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 把模型输出按 11 个标题切块；缺的板块补「原文未说明」。 */
export function parseDeepSections(raw) {
  const text = cleanBody(raw)
  const found = new Map()
  const lines = text.split('\n')
  let current = null
  let buffer = []
  const flush = () => {
    if (!current) return
    const body = cleanBody(buffer.join('\n'))
    if (body && !found.has(current)) found.set(current, body)
    buffer = []
  }
  for (const line of lines) {
    let matched = null
    for (const def of DEEP_SECTIONS) {
      const re = new RegExp(`^#{2,3}\\s*(?:(?:\\d+|[一二三四五六七八九十]+)\\s*[.、．]\\s*)?\\**${def.title}\\**\\s*$`)
      if (re.test(line.trim())) { matched = def; break }
    }
    if (matched) {
      flush()
      current = matched.key
      buffer = []
    } else if (current) {
      buffer.push(line)
    }
  }
  flush()
  return DEEP_SECTIONS.map((def, index) => ({
    key: def.key,
    title: def.title,
    markdown: found.get(def.key) || '原文未说明。',
    index: index + 1,
  }))
}

/** 对精读里的数值做原文核对：能找到的生成 q-id，找不到的标 unverified。 */
export function auditNumbers({ pages = [], sections = [], card, blocks = null }) {
  if (!pages.length || !card) return { numbers: [], changed: false }
  const pageIndex = buildPageIndex(pages)
  const byId = new Map((card.evidence || []).map((ev) => [ev.id, ev]))
  let changed = false
  const numbers = []
  const seen = new Set()
  for (const section of sections) {
    if (section.key === 'profile') continue
    const rawText = String(section.markdown || '').replace(/^\s*\d+\.\s+/gm, '')
    const citations = []
    const citationRe = /\[p\.(\d+)(?:\s*[–-]\s*p?\.?(\d+))?\]/g
    let citation = citationRe.exec(rawText)
    while (citation) {
      const pagesHint = [Number(citation[1])]
      if (citation[2]) {
        const end = Number(citation[2])
        for (let page = pagesHint[0] + 1; page <= end; page += 1) pagesHint.push(page)
      }
      citations.push({ start: citation.index, end: citation.index + citation[0].length, pages: pagesHint })
      citation = citationRe.exec(rawText)
    }
    const text = rawText.replace(/\[p\.\d+(?:\s*[–-]\s*p?\.?\d+)?\]/g, (hit) => ' '.repeat(hit.length))
    const regex = /(?<![\w.])(\d+(?:\.\d+)?%?)(?![\w.])/g
    let match = regex.exec(text)
    while (match) {
      const value = match[1]
      const before = text.slice(Math.max(0, match.index - 8), match.index)
      const after = text.slice(match.index + value.length, match.index + value.length + 10)
      if (/(?:第|见|如|参见|Section|section)\s*$/.test(before)
        || /^\s*(?:节|章|小节|部分|实验|方法|结果|讨论|结论|本章)/.test(after)) {
        match = regex.exec(text)
        continue
      }
      const key = `${section.key}:${value}`
      if (seen.has(key)) { match = regex.exec(text); continue }
      seen.add(key)
      let pageEntry = null
      let entry = null
      const nearest = citations
        .map((item) => ({ item, distance: Math.min(Math.abs(match.index - item.start), Math.abs(match.index - item.end)) }))
        .sort((a, b) => a.distance - b.distance)[0]
      const hintPages = nearest && nearest.distance <= 360 ? nearest.item.pages : []
      const ordered = [
        ...hintPages.map((number) => pages.find((page) => page.page === number)).filter(Boolean),
        ...pages.filter((page) => !hintPages.includes(page.page)),
      ]
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const looseSource = value.split('').map((ch) => (ch === '.' ? '\\.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\s*')
      const loose = new RegExp(`(?<![\\d.])${looseSource}(?![\\d.])`)
      for (const page of ordered) {
        const rawPage = String(page.text || '')
        const found = loose.exec(rawPage)
        if (!found) continue
        const at = found.index
        pageEntry = page
        const quote = rawPage.slice(Math.max(0, at - 90), Math.min(rawPage.length, at + found[0].length + 90)).replace(/\s+/g, ' ').trim()
        const located = locateQuote(quote, pageIndex, page.page)
        if (located) {
          const made = makeEvidence(pageIndex.find((item) => item.page === located.page) || pageIndex[0], located)
          let block = blocks ? findBlockForQuote(blocks, made.page, made.quote) : null
          if (!block && blocks) {
            const pageDoc = (blocks.pages || []).find((item) => item.page === made.page)
            block = (pageDoc?.blocks || []).find((item) => String(item.text || '').includes(value)) || null
          }
          if (block) made.block = block.id
          entry = made
          if (!byId.has(made.id)) { card.evidence.push(made); byId.set(made.id, made); changed = true }
        }
        break
      }
      numbers.push({
        value,
        sectionKey: section.key,
        sectionTitle: section.title,
        page: pageEntry?.page || null,
        block: entry?.block || null,
        evidenceId: entry?.id || null,
        quote: entry?.quote ? String(entry.quote).slice(0, 220) : '',
        verified: Boolean(entry),
      })
      if (numbers.length >= 40) break
      match = regex.exec(text)
    }
    if (numbers.length >= 40) break
  }
  return { numbers, changed }
}

/** 把 11 板块里的 [p.N] 换成带 q-id 的引用，点击才能定位到块。 */
export function linkCitations({ paperId, sections = [], numbers = [], evidence = [] }) {
  const bySection = new Map()
  for (const item of numbers) {
    if (!item.evidenceId) continue
    if (!bySection.has(item.sectionKey)) bySection.set(item.sectionKey, [])
    bySection.get(item.sectionKey).push(item)
  }
  const byPage = new Map()
  for (const ev of evidence) {
    if (!ev.block) continue
    if (!byPage.has(ev.page)) byPage.set(ev.page, ev)
  }
  for (const section of sections) {
    const local = bySection.get(section.key) || []
    section.markdown = String(section.markdown || '').replace(/\[p\.(\d+)(?:\s*[–-]\s*p?\.?(\d+))?\]/g, (match, pageRaw) => {
      const page = Number(pageRaw)
      const hit = local.find((item) => item.page === page)
        || numbers.find((item) => item.page === page && item.evidenceId)
        || (byPage.has(page) ? { evidenceId: byPage.get(page).id } : null)
      if (!hit) return match
      const label = match.slice(1, -1)
      return `[[${paperId}#^${hit.evidenceId}|${label}]]`
    })
  }
  return sections
}

export function sectionsToMarkdown(sections) {
  return sections.map((section) => `## ${section.index}. ${section.title}\n\n${section.markdown.trim()}`).join('\n\n')
}

export async function buildDeepRead({ ctx, record }) {
  const route = resolveRoute(ctx)
  if (!route) throw fail('no_model', '未找到可用的默认模型')
  const card = readCard(record.id)
  if (!card) throw fail('no_card', '先生成七段卡，再做精读')
  const doc = await loadPaperPages(record)
  const pages = doc.pages || []
  if (!pages.length) throw fail('no_text', '这篇论文还没有可读原文')
  const split = splitSections(pages)
  const input = buildPaperInput(record, split.sections)
  const user = [
    input.user,
    '',
    '【已有七段卡（只作参考）】',
    ...(card.sections || []).map((section) => `${section.title}：${String(section.text || '').slice(0, 500)}`),
    '',
    '请按 system 的 11 个板块输出纯 Markdown；不要抄原文；信息缺失写「原文未说明」；引用页码写 [p.N]。',
  ].join('\n')
  const system = readFileSync(join(HERE, '..', 'prompts', `${PROMPT_VERSION}.md`), 'utf8')
  let result
  try {
    result = await callModel(ctx, route, system, user, null, { maxTokens: 8192, reasoningEffort: 'off' })
  } catch (error) {
    if (error?.code === 'truncated') {
      result = await callModel(ctx, route, system, user, null, { maxTokens: 8192, reasoningEffort: null })
    } else throw error
  }
  const sections = parseDeepSections(result.text)
  const profile = sections.find((section) => section.key === 'profile')
  if (profile) {
    profile.markdown = profileMarkdown(record, pages)
    profile.locked = true
  }
  const filled = sections.filter((section) => section.markdown !== '原文未说明。').length
  if (!filled) throw fail('empty_sections', '模型没有产出 11 板块内容，请重试')
  const audit = auditNumbers({ pages, sections, card, blocks: readBlocks(record.id) })
  if (audit.changed) writeCard(card, record)
  linkCitations({ paperId: record.id, sections, numbers: audit.numbers, evidence: card.evidence })
  const markdown = sectionsToMarkdown(sections)
  return writeDeepRead({
    paperId: record.id,
    model: `${route.provider}/${route.model}`,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    markdown,
    sections,
    numbers: audit.numbers,
    evidence: (card.evidence || []).map((ev) => ({ id: ev.id, page: ev.page, block: ev.block || null })),
  })
}
