/**
 * 从论文库删除一篇论文：索引、原件、派生文件、卡片、精读、译文、概念缓存、
 * 以及引用它的证据链 / 研究引用。文稿不改写，只统计会留下缺失引用的篇数。
 *
 * 删除是不可恢复操作；路由要求 confirm=true，前端再做二次确认。
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, readIndex, writeIndex } from './library.js'
import { readCard } from './cards.js'
import { rebuildEdges } from './concepts.js'

const ID_RE = /^p-[a-zA-Z0-9_-]+$/

function safeDir(name) {
  return join(PATHS.root, name)
}

function listNames(dir, suffix) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(suffix) && !name.startsWith('.'))
  } catch {
    return []
  }
}

function chainFiles() {
  return listNames(safeDir('chains'), '.json')
}

function analyzeChains(paperId) {
  const rows = []
  for (const name of chainFiles()) {
    const file = join(PATHS.chains, name)
    let chain = null
    try { chain = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    const nodes = Array.isArray(chain.nodes) ? chain.nodes : []
    const hitNodes = nodes.filter((node) => String(node?.paperId || '') === paperId)
    const claimHit = String(chain.claim?.paperId || '') === paperId
    if (!hitNodes.length && !claimHit) continue
    const remaining = nodes.filter((node) => String(node?.paperId || '') !== paperId)
    rows.push({
      file,
      id: chain.id || name.slice(0, -5),
      hitNodes: hitNodes.length,
      claimHit,
      remove: claimHit || remaining.length === 0,
      remaining,
      chain,
    })
  }
  return rows
}

function analyzeThemes(paperId) {
  const rows = []
  for (const name of listNames(PATHS.themes, '.json')) {
    const file = join(PATHS.themes, name)
    let theme = null
    try { theme = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    const papers = theme.papers || {}
    const before = JSON.stringify({
      include: papers.include || [],
      exclude: papers.exclude || [],
      lastMatch: papers.lastMatch?.papers || [],
    })
    papers.include = (papers.include || []).filter((id) => id !== paperId)
    papers.exclude = (papers.exclude || []).filter((id) => id !== paperId)
    if (Array.isArray(papers.lastMatch?.papers)) {
      papers.lastMatch.papers = papers.lastMatch.papers.filter((row) => String(row?.paperId || row) !== paperId)
    }
    theme.papers = papers
    const after = JSON.stringify({
      include: papers.include,
      exclude: papers.exclude,
      lastMatch: papers.lastMatch?.papers || [],
    })
    if (before !== after) rows.push({ file, theme })
  }
  return rows
}

function cardQids(paperId) {
  try {
    const card = readCard(paperId)
    return new Set((card?.evidence || []).map((ev) => String(ev?.id || ev?.evidenceId || '')).filter(Boolean))
  } catch {
    return new Set()
  }
}

function citedDrafts(qids) {
  if (!qids.size) return 0
  let count = 0
  for (const name of listNames(PATHS.drafts, '.md')) {
    try {
      const text = readFileSync(join(PATHS.drafts, name), 'utf8')
      if ([...qids].some((id) => text.includes(id))) count += 1
    } catch { /* 跳过坏文稿 */ }
  }
  return count
}

function filePlan(record) {
  const id = record.id
  const plan = {
    files: [],
    dirs: [],
  }
  const add = (dir, name) => {
    const file = join(dir, name)
    if (existsSync(file)) plan.files.push(file)
  }
  add(PATHS.papers, record.file || `${id}.pdf`)
  add(PATHS.text, `${id}.txt`)
  add(PATHS.text, `${id}.pages.json`)
  add(PATHS.blocks, `${id}.json`)
  add(PATHS.cards, `${id}.card.json`)
  add(PATHS.cards, `${id}.md`)
  add(PATHS.deepread, `${id}.json`)
  add(join(PATHS.concepts, 'papers'), `${id}.json`)
  try {
    for (const name of readdirSync(PATHS.translations)) {
      if (name.startsWith(`${id}.`)) plan.files.push(join(PATHS.translations, name))
    }
  } catch { /* 无译文 */ }
  try {
    for (const name of readdirSync(join(PATHS.cards, '.versions'))) {
      if (name.startsWith(`${id}.`)) plan.files.push(join(PATHS.cards, '.versions', name))
    }
  } catch { /* 无历史版本 */ }
  const pageDir = join(PATHS.cache, id)
  if (existsSync(pageDir)) plan.dirs.push(pageDir)
  return plan
}

/** 删除前的影响面：给确认弹窗用。 */
export function paperDeleteImpact(paperId) {
  const id = String(paperId || '')
  if (!ID_RE.test(id)) return null
  const record = readIndex().find((row) => row.id === id)
  if (!record) return null
  const chains = analyzeChains(id)
  const themes = analyzeThemes(id)
  const qids = cardQids(id)
  const plan = filePlan(record)
  return {
    paper: { id: record.id, title: record.title || record.id },
    counts: {
      cards: existsSync(join(PATHS.cards, `${id}.card.json`)) ? 1 : 0,
      blocks: existsSync(join(PATHS.blocks, `${id}.json`)) ? 1 : 0,
      deepread: existsSync(join(PATHS.deepread, `${id}.json`)) ? 1 : 0,
      translations: plan.files.filter((file) => file.startsWith(PATHS.translations)).length,
      files: plan.files.length + plan.dirs.length,
      chains: chains.length,
      chainsRemoved: chains.filter((row) => row.remove).length,
      chainsUpdated: chains.filter((row) => !row.remove).length,
      themes: themes.length,
      drafts: citedDrafts(qids),
    },
  }
}

/** 执行删除。返回实际移除/更新的数量。 */
export function deletePaper(paperId) {
  const id = String(paperId || '')
  if (!ID_RE.test(id)) return null
  const rows = readIndex()
  const record = rows.find((row) => row.id === id)
  if (!record) return null

  const chains = analyzeChains(id)
  const themes = analyzeThemes(id)
  const plan = filePlan(record)
  const qids = cardQids(id)
  const drafts = citedDrafts(qids)

  let chainsRemoved = 0
  let chainsUpdated = 0
  for (const row of chains) {
    try {
      if (row.remove) {
        rmSync(row.file, { force: true })
        chainsRemoved += 1
      } else {
        row.chain.nodes = row.remaining
        row.chain.updatedAt = new Date().toISOString()
        writeFileSync(row.file, JSON.stringify(row.chain, null, 2), 'utf8')
        chainsUpdated += 1
      }
    } catch { /* 单条失败不阻断整篇删除 */ }
  }
  let themesUpdated = 0
  for (const row of themes) {
    try {
      row.theme.updatedAt = new Date().toISOString()
      writeFileSync(row.file, JSON.stringify(row.theme, null, 2), 'utf8')
      themesUpdated += 1
    } catch { /* ignore */ }
  }
  let filesRemoved = 0
  for (const file of plan.files) {
    try { rmSync(file, { force: true }); filesRemoved += 1 } catch { /* ignore */ }
  }
  for (const dir of plan.dirs) {
    try { rmSync(dir, { recursive: true, force: true }); filesRemoved += 1 } catch { /* ignore */ }
  }
  // 概念边从剩余单篇分析重建，避免被删论文的边残留在概念图谱里。
  try { rebuildEdges() } catch { /* 概念图谱是派生数据，失败不阻断删除 */ }
  // 索引最后写：即使前面有单文件失败，也不会留下“索引已删、文件还在”的不可见残留。
  writeIndex(rows.filter((row) => row.id !== id))
  return {
    paper: { id, title: record.title || id },
    removed: {
      files: filesRemoved,
      chains: chainsRemoved,
      chainsUpdated,
      themes: themesUpdated,
      draftsCited: drafts,
    },
  }
}
