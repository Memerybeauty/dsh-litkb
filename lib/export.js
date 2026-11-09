/**
 * 导出（P4.6）：BibTeX / GB/T 7714-2015 / 卡片 Markdown / Mermaid / Canvas。
 * 只读索引、卡片与图数据；不写库、不编造缺失字段。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, readIndex } from './library.js'
import { readCard, renderCardMarkdown } from './cards.js'
import { readGraph } from './graph.js'
import { readBlocks } from './blocks.js'
import { readTranslation } from './translate.js'

const BIB_TYPE = {
  学术期刊: 'article',
  会议: 'inproceedings',
  学位论文: 'phdthesis',
  图书: 'book',
  标准: 'misc',
  专利: 'misc',
  报纸: 'article',
  年鉴: 'book',
  成果: 'misc',
  学术辑刊: 'article',
  文库: 'book',
  法律法规: 'misc',
}

const GBT_TYPE = {
  学术期刊: 'J',
  会议: 'C',
  学位论文: 'D',
  图书: 'M',
  标准: 'S',
  专利: 'P',
  报纸: 'N',
  年鉴: 'Y',
  成果: 'G',
  学术辑刊: 'J',
  文库: 'Z',
  法律法规: 'S',
}

function bibEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}]/g, (ch) => (ch === '{' ? '\\{' : '\\}'))
    .replace(/\s+/g, ' ')
    .trim()
}

function bibField(name, value) {
  const text = bibEscape(value)
  return text ? `  ${name} = {${text}},` : ''
}

export function bibtexEntry(record) {
  const type = BIB_TYPE[record.type] || 'misc'
  const key = record.id || 'paper'
  const lines = [`@${type}{${key},`]
  lines.push(bibField('title', record.title))
  lines.push(bibField('author', record.authors))
  lines.push(bibField('year', record.year))
  if (type === 'inproceedings') lines.push(bibField('booktitle', record.venue))
  else if (type === 'phdthesis') lines.push(bibField('school', record.venue))
  else lines.push(bibField('journal', record.venue))
  lines.push(bibField('doi', record.doi))
  lines.push(bibField('keywords', (record.topics || []).join(', ')))
  lines.push('}')
  return lines.filter((line) => line.trim() !== '').join('\n')
}

export function exportBibtex({ id } = {}) {
  const records = readIndex().filter((r) => !id || r.id === id)
  if (id && !records.length) return null
  return `${records.map(bibtexEntry).join('\n\n')}\n`
}

export function gbtEntry(record) {
  const authors = String(record.authors || '').trim() || '佚名'
  const title = String(record.title || '').trim() || '（无题名）'
  const code = GBT_TYPE[record.type] || 'Z'
  const venue = String(record.venue || '').trim()
  const year = record.year || ''
  const head = `${authors}. ${title}[${code}]`
  if (code === 'J' || code === 'C' || code === 'N') {
    return `${head}.${venue ? ` ${venue},` : ''} ${year}.`
  }
  if (code === 'D') return `${head}.${venue ? ` ${venue},` : ''} ${year}.`
  if (code === 'M' || code === 'Z' || code === 'Y') return `${head}.${venue ? ` ${venue},` : ''} ${year}.`
  return `${head}. ${year}.`
}

export function exportGbt(id) {
  const record = readIndex().find((r) => r.id === id)
  return record ? `${gbtEntry(record)}\n` : null
}

export function exportCardMarkdown(id) {
  const record = readIndex().find((r) => r.id === id)
  if (!record) return null
  const card = readCard(id)
  if (!card) return null
  const file = join(PATHS.cards, `${id}.md`)
  if (existsSync(file)) return readFileSync(file, 'utf8')
  let excerpt = ''
  try { excerpt = readFileSync(join(PATHS.text, `${id}.txt`), 'utf8').slice(0, 600) } catch { /* 原文可选 */ }
  return renderCardMarkdown(record, card, excerpt)
}

function nodeId(id, used) {
  let base = `n_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}`
  let next = base
  let index = 2
  while (used.has(next)) next = `${base}_${index++}`
  used.add(next)
  return next
}

function mermaidLabel(value) {
  return String(value || '').replace(/["\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function exportMermaid() {
  const graph = readGraph()
  const used = new Set()
  const ids = new Map()
  for (const node of graph.nodes) ids.set(node.id, nodeId(node.id, used))
  const lines = ['flowchart LR']
  for (const node of graph.nodes) {
    const label = mermaidLabel(node.name)
    const id = ids.get(node.id)
    if (node.type === 'paper') lines.push(`  ${id}["${label}"]`)
    else if (node.kind === 'dataset') lines.push(`  ${id}[("${label}")]`)
    else if (node.kind === 'metric') lines.push(`  ${id}(["${label}"])`)
    else lines.push(`  ${id}("${label}")`)
  }
  for (const edge of graph.edges) {
    const from = ids.get(edge.source)
    const to = ids.get(edge.target)
    if (!from || !to) continue
    lines.push(`  ${from} -->|${edge.type}| ${to}`)
  }
  return `${lines.join('\n')}\n`
}

export function exportCanvas() {
  const graph = readGraph()
  const nodes = []
  const edges = []
  const byId = new Map()
  const used = new Set()
  const columns = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length || 1)))
  graph.nodes.forEach((node, index) => {
    const id = nodeId(node.id, used)
    byId.set(node.id, id)
    nodes.push({
      id,
      type: 'text',
      text: `**${node.name}**\n${node.type === 'paper' ? (node.year || '') : (node.kind || '')}`,
      x: (index % columns) * 300,
      y: Math.floor(index / columns) * 160,
      width: 240,
      height: 100,
      color: node.type === 'paper' ? '1' : (node.kind === 'method' ? '4' : node.kind === 'dataset' ? '2' : '6'),
    })
  })
  graph.edges.forEach((edge, index) => {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to) return
    edges.push({
      id: `e_${index + 1}`,
      fromNode: from,
      fromSide: 'right',
      toNode: to,
      toSide: 'left',
      label: edge.type,
    })
  })
  return JSON.stringify({ nodes, edges }, null, 2)
}


/** 双语 Markdown：按原文块顺序输出“原文 / 译文”，没有译文的块只出原文。 */
export function exportBilingual(id) {
  const record = readIndex().find((item) => item.id === id)
  const doc = readBlocks(id)
  const translation = readTranslation(id)
  if (!record || !doc) return null
  const lines = [`# ${record.title || record.id}`, '', '> 双语对照：原文 / 译文（无译文的块只保留原文）', '']
  for (const page of doc.pages || []) {
    lines.push(`## p.${page.page}`, '')
    for (const block of page.blocks || []) {
      if (block.role === 'header' || block.role === 'footer') continue
      const translated = translation?.blocks?.[block.id]
      lines.push(`**原文** ${block.text}`)
      if (translated?.text) lines.push('', `**译文** ${translated.text}`)
      lines.push('')
    }
  }
  return `${lines.join('\n').trim()}\n`
}
