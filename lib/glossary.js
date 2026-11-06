/**
 * 术语表（P2.3）：`<库>/glossary.json`。
 * 翻译时强制 source→target；术语表变化会让译文缓存懒失效。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PATHS } from './library.js'

export const DEFAULT_TERMS = [
  { source: 'vCDR', target: '垂直杯盘比（vCDR）', aliases: ['vertical cup-to-disc ratio'] },
  { source: 'CDR', target: '杯盘比（CDR）' },
  { source: 'optic disc', target: '视盘', aliases: ['optic nerve head'] },
  { source: 'optic cup', target: '视杯' },
  { source: 'REFUGE', target: 'REFUGE 数据集' },
  { source: 'ORIGA', target: 'ORIGA 数据集' },
  { source: 'EyePACS', target: 'EyePACS 数据集' },
  { source: 'U-Net', target: 'U-Net' },
  { source: 'Transformer', target: 'Transformer' },
  { source: 'BERT', target: 'BERT' },
  { source: 'WavLM', target: 'WavLM' },
  { source: 'RAG', target: '检索增强生成（RAG）' },
  { source: 'LLM', target: '大语言模型（LLM）' },
  { source: 'ASTE', target: '方面情感三元组抽取（ASTE）' },
  { source: 'Dice', target: 'Dice 系数' },
  { source: 'F1', target: 'F1 分数' },
]

function cleanTerm(term) {
  return {
    source: String(term?.source || '').trim(),
    target: String(term?.target || '').trim(),
    aliases: Array.isArray(term?.aliases) ? term.aliases.map((x) => String(x).trim()).filter(Boolean) : [],
  }
}

function dedupe(terms) {
  const map = new Map()
  for (const term of terms.map(cleanTerm)) {
    if (!term.source || !term.target) continue
    map.set(term.source.toLowerCase(), term)
  }
  return [...map.values()]
}

export function readGlossary() {
  const file = PATHS.glossary
  if (!existsSync(file)) {
    const data = { version: 1, terms: DEFAULT_TERMS }
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    return data
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const terms = Array.isArray(data?.terms) ? dedupe(data.terms) : DEFAULT_TERMS
    return { version: 1, terms }
  } catch {
    return { version: 1, terms: DEFAULT_TERMS }
  }
}

export function writeGlossary(terms) {
  const data = { version: 1, terms: dedupe(Array.isArray(terms) ? terms : []) }
  writeFileSync(PATHS.glossary, JSON.stringify(data, null, 2), 'utf8')
  return data
}

export function glossaryHash(terms) {
  return createHash('sha1').update(JSON.stringify(terms)).digest('hex').slice(0, 8)
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 在原文里找命中的术语（ASCII 用词边界，中文用子串）。 */
export function matchTerms(text, terms) {
  const source = String(text || '')
  const lower = source.toLowerCase()
  const hits = []
  for (const term of terms) {
    const needles = [term.source, ...(term.aliases || [])]
    for (const needle of needles) {
      if (!needle) continue
      const nl = needle.toLowerCase()
      let hit = false
      if (/^[\x20-\x7e]+$/.test(nl)) {
        hit = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(nl)}(?![a-z0-9])`).test(lower)
      } else {
        hit = lower.includes(nl)
      }
      if (hit) { hits.push(term); break }
    }
  }
  return hits
}

/** 译文是否包含术语表要求的译名（允许 target 括号前的主干）。 */
export function checkTermTargets(text, translation, terms) {
  const missing = []
  for (const term of matchTerms(text, terms)) {
    const candidates = [term.target, term.target.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim()]
      .filter(Boolean)
    if (!candidates.some((c) => translation.includes(c))) missing.push(term)
  }
  return missing
}
