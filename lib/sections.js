/**
 * 章节切分（P2）。
 *
 * 输入是 pdftext.js 的分页文本（页 → 行），输出有序章节：
 * 摘要 / 引言 / 相关工作 / 方法 / 实验 / 结果 / 讨论 / 结论 / 参考文献。
 *
 * 识别三类标题：
 * 1. 整行标题：`摘要`、`Abstract`、`3.2 方法`、`第 3 章 方法`；
 * 2. 行首内联标题：中文期刊常见「摘要针对……」「关键词医疗服务；……」；
 * 3. 编号标题：`2 系统总体设计`、`4.3.1 对比试验`，按词表归类，归不进的记为 other。
 * 目录页（点线）与图题/表题会被排除。识别不到章节时退化为「全文」，绝不丢正文。
 */

const HEADINGS = [
  { key: 'abstract', title: '摘要', re: /^(摘要|abstract)$/ },
  { key: 'keywords', title: '关键词', re: /^(关键词|关键字|keywords?)$/ },
  { key: 'intro', title: '引言', re: /^(引言|前言|绪论|导论|introduction|background)$/ },
  { key: 'related', title: '相关工作', re: /^(相关工作|文献综述|研究现状|国内外研究现状|related works?|literature review)$/ },
  { key: 'method', title: '方法', re: /^(研究方法|方法|模型|算法|方法设计|模型与方法|method|methods|methodology|proposed method|approach|materials and methods|system design)$/ },
  { key: 'experiment', title: '实验', re: /^(实验|实验设置|实验设计|experiments?|experimental setup|evaluation setup)$/ },
  { key: 'results', title: '结果', re: /^(结果|结果与分析|实验结果|results?|evaluation)$/ },
  { key: 'discussion', title: '讨论', re: /^(讨论|分析与讨论|discussion)$/ },
  { key: 'conclusion', title: '结论', re: /^(结论|总结|结语|结论与展望|总结与展望|conclusions?|summary|concluding remarks)$/ },
  { key: 'references', title: '参考文献', re: /^(参考文献|引用文献|references?|bibliography)$/ },
]

/** 标题词 → 章节类型。顺序从具体到宽泛，先命中先返回。 */
const TYPE_HINTS = [
  ['references', /参考文献|引用文献|references?|bibliography/i],
  ['abstract', /摘\s*要|abstract/i],
  ['keywords', /关\s*键\s*词|keywords?/i],
  ['conclusion', /结\s*论|结\s*语|总\s*结|conclusions?|summary|concluding/i],
  ['discussion', /讨\s*论|discussion/i],
  ['results', /结\s*果|results?|评\s*估|对比试验|实验分析|性能分析|消融/i],
  ['experiment', /实\s*验|experiments?|数据集|数据与|evaluation/i],
  ['related', /相关工作|研究现状|文献综述|related works?|literature review/i],
  ['intro', /引\s*言|前\s*言|绪\s*论|导\s*论|研究背景|背景|introduction|background/i],
  ['method', /方\s*法|模\s*型|算\s*法|设\s*计|框\s*架|机\s*制|method|model|approach|framework|design|architecture/i],
]

const MAX_HEADING_CHARS = 40
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2})*)\s*[、.．]?\s+(\S.*)$/
const TOC_LINE = /(?:\.\s*){4,}|…\s*…/

/** 去掉章节编号与首尾标点，得到用于匹配的标题本体。 */
export function headingBody(raw) {
  return String(raw || '')
    .replace(/^(?:chapter|section)\s+\d+\s*[:.]?\s*/i, '')
    .replace(/^第[一二三四五六七八九十百零\d]+[章节篇部分]\s*/, '')
    .replace(/^\d+(?:\.\d+)*\s*[.、．)）]?\s*/, '')
    .replace(/^[（(][一二三四五六七八九十\d]+[)）]\s*/, '')
    .replace(/[:：.。、]\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function classifyTitle(title) {
  for (const [key, re] of TYPE_HINTS) {
    if (re.test(title)) return key
  }
  return null
}

/** 一行是不是整行章节标题；是则返回词表条目。 */
export function matchHeading(raw) {
  const line = String(raw || '').trim()
  if (!line || line.length > MAX_HEADING_CHARS) return null
  const body = headingBody(line)
  if (!body) return null
  for (const heading of HEADINGS) {
    if (heading.re.test(body)) return heading
  }
  return null
}

/**
 * 行首内联标题：中文期刊常见「摘要针对……」「关键词医疗服务；……」。
 * 只在标题词后面确实跟了正文时才算。
 */
const INLINE = [
  { key: 'abstract', title: '摘要', re: /^(摘要|abstract)\s*[:：]?\s*/i },
  { key: 'keywords', title: '关键词', re: /^(关键词|关键字|keywords?)\s*[:：]?\s*/i },
  { key: 'intro', title: '引言', re: /^(引言|前言|绪论|introduction)\s*[:：]?\s*/i },
  { key: 'method', title: '方法', re: /^(研究方法|方法|method|methods)\s*[:：]\s*/i },
  { key: 'experiment', title: '实验', re: /^(实验|experiments?)\s*[:：]\s*/i },
  { key: 'results', title: '结果', re: /^(结果|results?)\s*[:：]\s*/i },
  { key: 'discussion', title: '讨论', re: /^(讨论|discussion)\s*[:：]\s*/i },
  { key: 'conclusion', title: '结论', re: /^(结论|结语|conclusions?)\s*[:：]?\s*/i },
  { key: 'references', title: '参考文献', re: /^(参考文献|references?)\s*[:：]?\s*/i },
]

/**
 * 标题识别的完整结果：整行标题 / 行首内联标题 / 编号标题。
 * @returns {{key:string,title:string,inline:boolean,rest:string}|null}
 */
export function detectBoundary(raw) {
  const line = String(raw || '').trim()
  if (!line || line.length > 80) return null
  if (TOC_LINE.test(line)) return null

  // 1) 整行标题
  const whole = matchHeading(line)
  if (whole) return { key: whole.key, title: whole.title, inline: false, rest: '' }

  // 2) 行首内联标题
  for (const heading of INLINE) {
    const m = line.match(heading.re)
    if (!m) continue
    const rest = line.slice(m[0].length).trim()
    if (rest.length >= 15) return { key: heading.key, title: heading.title, inline: true, rest }
  }

  // 3) 编号标题：2 系统总体设计 / 4.3.1 对比试验（限 1–2 位数，避开年份与页码）
  const numbered = line.match(NUMBERED)
  if (numbered) {
    const title = numbered[2].trim()
    if (plausibleNumberedTitle(title)) {
      const key = classifyTitle(title) || 'other'
      return { key, title, inline: false, rest: '' }
    }
  }
  return null
}

/** 编号标题的正文长得像标题而不是表格行/页脚/参考文献条目。 */
function plausibleNumberedTitle(title) {
  if (title.length < 3 || title.length > 24) return false
  if (/[\[\]<>{}，。；：:（）()、]/.test(title)) return false
  if (/^\d/.test(title) && !/^\d[A-Za-z]/.test(title)) return false
  if (/\d{2,}/.test(title)) return false
  const cjk = (title.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (title.match(/[A-Za-z]/g) || []).length
  if (cjk === 0 && latin < 4) return false
  if (cjk === 0 && /^[a-z\s]+$/.test(title)) return false
  return true
}

/** 目录页的正文特征：大量点线、数字、空白，几乎没有句子。 */
function looksLikeToc(text) {
  const body = String(text || '')
  if (/(?:\.\s*){4,}|…\s*…/.test(body)) return true
  if (body.length > 1200) return false
  const filler = (body.match(/[.\s\d…·]/g) || []).length
  return filler / Math.max(1, body.length) > 0.6
}

/**
 * @param {Array<{page:number,text:string}>} pages
 * @returns {{sections: Array<{key:string,title:string,startPage:number,endPage:number,parts:Array<{page:number,text:string}>,text:string}>, detected: number}}
 */
export function splitSections(pages) {
  const lines = []
  for (const page of pages) {
    for (const line of String(page.text || '').split('\n')) {
      if (!line.trim()) continue
      lines.push({ page: page.page, line })
    }
  }
  if (!lines.length) return { sections: [], detected: 0 }

  const marks = []
  for (let i = 0; i < lines.length; i += 1) {
    const heading = detectBoundary(lines[i].line)
    if (!heading) continue
    // 标题后面至少要跟 2 行，避免把最后一个孤立词当成章节。
    if (i + 2 > lines.length) continue
    marks.push({ ...heading, index: i, page: lines[i].page })
  }

  const blocks = []
  for (let k = 0; k < marks.length; k += 1) {
    const mark = marks[k]
    const end = k + 1 < marks.length ? marks[k + 1].index : lines.length
    const bodyLines = lines.slice(mark.index + 1, end)
    if (mark.inline && mark.rest) bodyLines.unshift({ page: mark.page, line: mark.rest })

    const parts = []
    let current = null
    for (const item of bodyLines) {
      if (!current || current.page !== item.page) {
        current = { page: item.page, lines: [] }
        parts.push(current)
      }
      current.lines.push(item.line)
    }
    const pageParts = parts.map((p) => ({ page: p.page, text: p.lines.join('\n') }))
    const text = pageParts.map((p) => p.text).join('\n').trim()
    if (text.length < 20) continue
    if (looksLikeToc(text)) continue
    blocks.push({
      key: mark.key,
      title: mark.title,
      startPage: mark.page,
      endPage: lines[Math.min(end, lines.length - 1)].page,
      parts: pageParts,
      text,
    })
  }

  // 归不进词表的子标题并入上一章：章节保持连贯，正文不丢。
  const merged = []
  for (const block of blocks) {
    const last = merged[merged.length - 1]
    if (last && (last.key === block.key || block.key === 'other')) {
      last.parts.push(...block.parts)
      last.text += `\n${block.text}`
      last.endPage = block.endPage
      continue
    }
    merged.push({ ...block, parts: [...block.parts] })
  }

  if (merged.length < 2) {
    return {
      sections: [{
        key: 'full',
        title: '全文',
        startPage: pages[0]?.page || 1,
        endPage: pages[pages.length - 1]?.page || 1,
        parts: pages.map((p) => ({ page: p.page, text: p.text })),
        text: lines.map((x) => x.line).join('\n'),
      }],
      detected: 0,
    }
  }
  return { sections: merged, detected: merged.length }
}

/** 可喂给模型的正文章节（参考文献、关键词不参与七段生成）。 */
export const BODY_KEYS = new Set([
  'abstract', 'intro', 'related', 'method', 'experiment', 'results', 'discussion', 'conclusion', 'other',
])
