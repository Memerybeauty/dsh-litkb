/**
 * 归类（v1.2）：大类 = 知网 12 类（规则）；主题 = 扁平标签（关键词命中）。
 * 没有置信度，没有角色：命中即打，不命中不猜。
 */

const CONFERENCE = /(MICCAI|CVPR|ICCV|ECCV|ISBI|MIDL|AAAI|NeurIPS|ICLR|ICML|BMVC|Proceedings of)/i

export function extractDoi(text) {
  const head = text.slice(0, 3000)
  const labeled = head.match(/\bdoi\b[^\n]{0,40}?(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i)
  if (labeled) return labeled[1].replace(/[.,;]$/, '')
  const first = head.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)
  return first ? first[0].replace(/[.,;]$/, '') : ''
}

function sanitizeTitle(raw) {
  let title = String(raw || '').replace(/\s+/g, ' ').trim()
  title = title.replace(/\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*\d+(?:\s*,\s*\d+)*.*$/, '')
  if (title.length > 160) title = title.slice(0, 160).trim()
  return title
}

function cleanFilename(name) {
  return String(name || '').replace(/\.pdf$/i, '').replace(/_/g, ' ').trim()
}

function pickTitle(filename, info, text) {
  const base = String(filename || '').replace(/\.pdf$/i, '')
  const parts = base.split('_')
  if (parts.length >= 2 && parts[0].trim().length > 6) return sanitizeTitle(parts[0])
  const infoTitle = sanitizeTitle(info?.Title || '')
  if (infoTitle.length > 8 && !/^(untitled|microsoft word|document)/i.test(infoTitle)) return infoTitle
  const firstLine = sanitizeTitle(text.slice(0, 200).split(/[。.\n]/)[0].trim())
  return firstLine.length > 8 ? firstLine.slice(0, 160) : cleanFilename(filename)
}

function pickAuthor(filename, info) {
  const base = String(filename || '').replace(/\.pdf$/i, '')
  const parts = base.split('_')
  const fromName = parts.length >= 2 ? parts[1].trim() : ''
  if (/^[\u4e00-\u9fa5·]{2,6}$/.test(fromName)) return fromName
  const fromInfo = String(info?.Author || '').trim()
  return fromInfo && fromInfo.length <= 60 ? fromInfo : ''
}

function validYear(y) {
  const now = new Date().getFullYear()
  return y >= 1980 && y <= now + 1 ? y : null
}

function pickYear(filename, info, text) {
  const fromName = String(filename || '').match(/(19|20)\d{2}/)
  if (fromName && validYear(Number(fromName[0]))) return Number(fromName[0])
  const fromText = text.slice(0, 300).match(/(19|20)\d{2}/)
  if (fromText && validYear(Number(fromText[0]))) return Number(fromText[0])
  const created = String(info?.CreationDate || '').match(/(19|20)\d{2}/)
  return created ? validYear(Number(created[0])) : null
}

const VENUES = [
  'Scientific Reports', 'Medical Image Analysis', 'IEEE Transactions on Medical Imaging',
  'Ophthalmology Science', 'Frontiers in Ophthalmology', 'Nature Communications',
  'Nature Medicine', 'arXiv', '计算机工程与应用', '计算机应用研究', '中国图象图形学报',
  '软件学报', '自动化学报', '中华眼科杂志', '中华实验眼科杂志', '计算机时代', '计算机系统应用',
]

function pickVenue(text, filename) {
  const head = `${filename} ${text.slice(0, 400)}`.toLowerCase()
  for (const venue of VENUES) {
    if (head.includes(venue.toLowerCase())) return venue
  }
  return ''
}

export function pickType({ title, filename, text, venue }) {
  const head = `${title} ${filename}`
  const bodyHead = text.slice(0, 2000)
  const hay = `${head} ${venue} ${bodyHead}`
  if (/(硕士学位论文|博士学位论文|dissertation|thesis)/i.test(hay)) return '学位论文'
  if (/(专利号|patent\s*(no|number)|申请号)/i.test(hay)) return '专利'
  if (/(法律法规|条例|法条)/i.test(head)) return '法律法规'
  if (/(年鉴|yearbook)/i.test(head)) return '年鉴'
  if (/(报纸|newspaper)/i.test(head)) return '报纸'
  if (/(辑刊)/i.test(head)) return '学术辑刊'
  if (/(文库)/i.test(head)) return '文库'
  if (/(ISBN|出版社|book review)/i.test(hay)) return '图书'
  if (/(指南|共识|标准|GB\/T|guideline|standard)/i.test(head)) return '标准'
  if (CONFERENCE.test(hay) && !/(期刊|journal)/i.test(venue)) return '会议'
  if (/(成果|研究报告)/i.test(head)) return '成果'
  return '学术期刊'
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** ASCII 关键词按词边界匹配（避免 rag 命中 average），中文按子串。 */
function countHits(lowerText, lowerKw) {
  if (/^[\x20-\x7e]+$/.test(lowerKw)) {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(lowerKw)}(?![a-z0-9])`, 'g')
    return (lowerText.match(re) || []).length
  }
  return lowerText.split(lowerKw).length - 1
}

export function matchTags({ title, text }, tags, max = 3) {
  const body = text.toLowerCase()
  const head = title.toLowerCase()
  const scored = []
  for (const tag of tags) {
    let score = 0
    for (const kw of tag.keywords || []) {
      const k = String(kw).toLowerCase()
      if (!k) continue
      const hits = countHits(body, k)
      if (hits > 0) score += Math.min(3, hits) * 1
      if (countHits(head, k) > 0) score += 5
    }
    if (score >= 4) scored.push({ name: tag.name, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.name)
}

export function classify({ text, filename, info }, tags = []) {
  const title = pickTitle(filename, info, text)
  const authors = pickAuthor(filename, info)
  const year = pickYear(filename, info, text)
  let venue = pickVenue(text, filename)
  const doi = extractDoi(text)
  const type = pickType({ title, filename, text, venue })
  if (type === '会议') {
    const conf = `${title} ${filename} ${text.slice(0, 400)}`.match(CONFERENCE)
    if (conf) venue = conf[1].toUpperCase()
  }
  const topics = matchTags({ title, text }, tags)
  return { title, authors, year, venue, doi, type, topics }
}
