/**
 * 卡片存储（P2）：`cards/<id>.card.json` 是机读真源，`cards/<id>.md` 是给人看的镜像。
 * 重生成时旧 JSON 备份到 `cards/.versions/`，可回滚（FR-606）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, upsert } from './library.js'

export function cardJsonPath(id) {
  return join(PATHS.cards, `${id}.card.json`)
}

export function readCard(id) {
  const path = cardJsonPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** 卡片元信息（放在列表行、索引里的小对象）。 */
export function cardSummary(card) {
  if (!card) return null
  return {
    status: card.status,
    model: card.model,
    generatedAt: card.generatedAt,
    evidence: (card.evidence || []).length,
    sections: (card.sections || []).length,
    promptVersion: card.promptVersion,
  }
}

function readExcerpt(record, limit = 600) {
  const txt = join(PATHS.text, `${record.id}.txt`)
  if (existsSync(txt)) return readFileSync(txt, 'utf8').slice(0, limit)
  const pages = join(PATHS.text, `${record.id}.pages.json`)
  if (existsSync(pages)) {
    try {
      const data = JSON.parse(readFileSync(pages, 'utf8'))
      return (data.pages || []).map((p) => p.text).join('\n\n').slice(0, limit)
    } catch { /* 忽略 */ }
  }
  return ''
}

function yamlString(value) {
  return JSON.stringify(value ?? '')
}

function yamlArray(values) {
  return `[${(values || []).map((v) => JSON.stringify(v)).join(', ')}]`
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** 七段卡 → Markdown（含 frontmatter、块引用、我的批注）。 */
export function renderCardMarkdown(record, card, excerpt) {
  const lines = [
    '---',
    `paper_id: ${yamlString(record.id)}`,
    `citekey: ${yamlString(record.citekey || record.id)}`,
    `title: ${yamlString(record.title)}`,
    `authors: ${yamlString(record.authors)}`,
    `year: ${record.year ?? 'null'}`,
    `venue: ${yamlString(record.venue)}`,
    `doi: ${yamlString(record.doi)}`,
    `type: ${yamlString(record.type)}`,
    `topics: ${yamlArray(record.topics)}`,
    `status: ${yamlString(record.status || '待读')}`,
    `pages: ${record.pages}`,
    `chars: ${record.chars}`,
    `evidence_count: ${(card?.evidence || []).length}`,
  ]
  if (card) {
    lines.push(`card_model: ${yamlString(card.model)}`)
    lines.push(`card_status: ${yamlString(card.status)}`)
    lines.push(`card_generated: ${yamlString(card.generatedAt)}`)
    lines.push(`card_prompt: ${yamlString(card.promptVersion)}`)
  }
  lines.push(`added: ${yamlString(record.added || new Date().toISOString())}`)
  lines.push('---', '', `# ${record.title || '(未命名)'}`, '')

  if (!card) {
    lines.push('> 七段卡尚未生成。P1 已就绪：大类与标签；P2 生成七段解读与证据块。', '')
  } else {
    const evidence = new Map((card.evidence || []).map((e) => [e.id, e]))
    const when = String(card.generatedAt || '').slice(0, 16).replace('T', ' ')
    lines.push(`> 七段卡由 ${card.model} 生成 · ${when} · 证据 ${evidence.size} 条 · 状态 ${card.status === 'ready' ? '完整' : '部分'}。生成内容需人工核对。`, '')
    if ((card.warnings || []).length) {
      lines.push(`> 生成警告：${card.warnings.join('；')}`, '')
    }
    card.sections.forEach((section, index) => {
      lines.push(`## ${index + 1}. ${section.title}`, '')
      lines.push(String(section.text || '').trim().replace(/\n/g, '\n\n'), '')
      for (const id of section.evidence || []) {
        const ev = evidence.get(id)
        if (!ev) continue
        lines.push(`> ${oneLine(ev.quote)} ^${ev.id}`, `> — p.${ev.page}`, '')
      }
    })
  }

  lines.push('## 我的批注', '')
  const annotations = card?.annotations || []
  if (annotations.length) {
    for (const note of annotations) {
      const day = String(note.at || '').slice(0, 10)
      lines.push(`- ${day} ${oneLine(note.text)}`)
    }
  } else {
    lines.push('（暂无）')
  }
  lines.push('')
  if (excerpt) lines.push('## 摘要（原文前 600 字）', '', excerpt, '')
  lines.push('## 原文', '', `- [${record.file}](../papers/${record.file})`, '')
  return lines.join('\n')
}

/** 卡片状态：五个主张段都有证据且七段不缺，才算 ready。 */
export function recomputeCardStatus(card) {
  const NEED = ['oneLine', 'problem', 'method', 'data', 'results']
  const sections = card?.sections || []
  const covered = NEED.every((key) => {
    const section = sections.find((s) => s.key === key)
    return section && (section.evidence || []).length > 0
  })
  const missing = sections.some((s) => String(s.text || '').includes('需人工补充'))
  card.status = covered && !missing ? 'ready' : 'partial'
  return card
}

function pruneVersions(id, keep = 20) {
  const dir = join(PATHS.cards, '.versions')
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(`${id}.`) && name.endsWith('.json'))
    .sort()
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try { unlinkSync(join(dir, name)) } catch { /* 忽略 */ }
  }
}

/** 落盘：卡片 JSON + Markdown 镜像 + 索引摘要。 */
export function writeCard(card, record) {
  card.annotations = Array.isArray(card.annotations) ? card.annotations : []
  card.statusHistory = Array.isArray(card.statusHistory) ? card.statusHistory : []
  const jsonPath = cardJsonPath(record.id)
  if (existsSync(jsonPath)) {
    const versions = join(PATHS.cards, '.versions')
    if (!existsSync(versions)) mkdirSync(versions, { recursive: true })
    copyFileSync(jsonPath, join(versions, `${record.id}.${Date.now()}.json`))
    pruneVersions(record.id, 20)
  }
  writeFileSync(jsonPath, JSON.stringify(card, null, 2), 'utf8')
  writeFileSync(
    join(PATHS.cards, `${record.id}.md`),
    renderCardMarkdown(record, card, readExcerpt(record)),
    'utf8',
  )
  return upsert({
    ...record,
    evidence_count: (card.evidence || []).length,
    card: cardSummary(card),
  })
}

/** 版本列表（新→旧）。 */
export function listVersions(id) {
  const dir = join(PATHS.cards, '.versions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${id}.`) && name.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => {
      const file = join(dir, name)
      const info = statSync(file)
      return {
        name,
        at: new Date(info.mtimeMs).toISOString(),
        bytes: info.size,
        // 文件名里的时间戳
        version: name.slice(id.length + 1, -5),
      }
    })
}

function safeVersionName(id, name) {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('/') || name.includes('\\') || !name.startsWith(`${id}.`) || !name.endsWith('.json')) return null
  return name
}

/** 读某个版本；不传 name 取最新。 */
export function readVersion(id, name) {
  const safe = safeVersionName(id, name) || listVersions(id)[0]?.name
  if (!safe) return null
  const file = join(PATHS.cards, '.versions', safe)
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** 追加批注。 */
export function addAnnotation(card, text) {
  const note = String(text || '').trim()
  if (!note) return card
  const at = new Date().toISOString()
  const digest = createHash('sha1').update(`${at}|${note}`).digest('hex').slice(0, 8)
  card.annotations = Array.isArray(card.annotations) ? card.annotations : []
  card.annotations.push({ id: `a-${digest}`, at, text: note })
  card.updatedAt = at
  return card
}
