#!/usr/bin/env node
/**
 * 质量评估脚手架：从当前库导出人工评分表 + 自动指标。
 * 用法：npm run eval  → eval/quality-<时间>/
 * 只读库，不改数据；人工列留空，评分后可用 Excel/脚本汇总。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readIndex, PATHS } from '../lib/library.js'
import { readCard } from '../lib/cards.js'
import { listThemes, readTheme, themeChains } from '../lib/themes.js'

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(process.cwd(), 'eval', `quality-${stamp}`)
mkdirSync(outDir, { recursive: true })

const papers = readIndex()
const themes = listThemes()
const rows = []
const summary = {
  papers: papers.length,
  cards: 0,
  themes: themes.length,
  confirmed: 0,
  drafts: 0,
  nodes: 0,
  locatable: 0,
  facets: 0,
  coveredFacets: 0,
  duplicateGroups: 0,
}
const evidenceCache = new Map()
const evidenceIdsOf = (paperId) => {
  if (!evidenceCache.has(paperId)) {
    evidenceCache.set(paperId, new Set((readCard(paperId)?.evidence || []).map((ev) => ev.id)))
  }
  return evidenceCache.get(paperId)
}

for (const paper of papers) {
  if (readCard(paper.id)) summary.cards += 1
}

const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
const lines = [
  '# 文献工作台质量评估',
  '',
  `- 生成时间：${new Date().toISOString()}`,
  `- 库路径：${PATHS.root}`,
  `- 论文 ${summary.papers} 篇 · 卡片 ${summary.cards} 张 · 研究 ${summary.themes} 个`,
  '',
]

for (const summaryItem of themes) {
  const theme = readTheme(summaryItem.id)
  if (!theme) continue
  const chains = themeChains(theme.id).list
  const confirmed = chains.filter((chain) => chain.status === 'confirmed')
  const drafts = chains.filter((chain) => chain.status === 'draft')
  summary.confirmed += confirmed.length
  summary.drafts += drafts.length
  summary.facets += theme.facets.length
  const facetCovered = new Set(confirmed.map((chain) => chain.provenance?.facetKey).filter(Boolean))
  summary.coveredFacets += theme.facets.filter((facet) => facetCovered.has(facet.key)).length
  const byFacet = new Map()
  for (const chain of confirmed) {
    const key = chain.provenance?.facetKey || ''
    if (!byFacet.has(key)) byFacet.set(key, 0)
    byFacet.set(key, byFacet.get(key) + 1)
  }
  summary.duplicateGroups += [...byFacet.values()].filter((count) => count > 1).length

  lines.push(
    `## ${theme.title}`,
    '',
    `- 细分 ${theme.facets.length} · 已确认 ${confirmed.length} · 草稿 ${drafts.length}`,
    '',
  )
  lines.push('| 细分 | 链 | 节点 | 证据可定位 | 论点 | 人工：切题(1-5) | 人工：支撑(1-5) | 备注 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const chain of confirmed) {
    const nodes = chain.nodes || []
    const locatable = nodes.filter((node) => evidenceIdsOf(node.paperId).has(node.evidenceId)).length
    summary.nodes += nodes.length
    summary.locatable += locatable
    const facetKey = chain.provenance?.facetKey || ''
    const facet = theme.facets.find((item) => item.key === facetKey)
    lines.push(
      `| ${facet?.title || facetKey || '—'} | ${chain.id} | ${nodes.length} | ${locatable}/${nodes.length} | ${String(
        chain.claim?.text || '',
      )
        .replace(/\|/g, '\\|')
        .slice(0, 80)} |  |  |  |`,
    )
    rows.push({
      theme_id: theme.id,
      theme_title: theme.title,
      facet_key: facetKey,
      facet_title: facet?.title || '',
      chain_id: chain.id,
      status: chain.status,
      claim: chain.claim?.text || '',
      nodes: nodes.length,
      locatable,
      human_relevance: '',
      human_support: '',
      human_grounded: '',
      notes: '',
    })
  }
  lines.push('')
}

summary.locatablePct = summary.nodes ? Math.round((summary.locatable / summary.nodes) * 100) : 0
summary.coveragePct = summary.facets ? Math.round((summary.coveredFacets / summary.facets) * 100) : 0
lines.splice(
  4,
  0,
  `- 已确认链 ${summary.confirmed} · 草稿 ${summary.drafts} · 证据可定位 ${summary.locatablePct}% · 细分覆盖 ${summary.coveragePct}% · 重复组 ${summary.duplicateGroups}`,
)

const header = [
  'theme_id',
  'theme_title',
  'facet_key',
  'facet_title',
  'chain_id',
  'status',
  'claim',
  'nodes',
  'locatable',
  'human_relevance',
  'human_support',
  'human_grounded',
  'notes',
]
const csv =
  '\uFEFF' + [header.join(','), ...rows.map((row) => header.map((key) => cell(row[key])).join(','))].join('\n') + '\n'

writeFileSync(join(outDir, 'report.md'), lines.join('\n'), 'utf8')
writeFileSync(join(outDir, 'scores.csv'), csv, 'utf8')
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
console.log(`评估表已生成：${outDir}`)
console.log(
  `论文 ${summary.papers} · 已确认链 ${summary.confirmed} · 证据可定位 ${summary.locatablePct}% · 细分覆盖 ${summary.coveragePct}% · 重复组 ${summary.duplicateGroups}`,
)
