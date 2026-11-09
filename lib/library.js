/**
 * 库：一个本地文件夹（Markdown + PDF + JSONL 索引）。
 * v1.2：大类（知网 12 类）+ 扁平标签，无置信度、无角色。
 */
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LIB_ROOT = process.env.LITKB_LIBRARY || join(homedir(), 'Documents', '文献库')
export const PATHS = {
  root: LIB_ROOT,
  papers: join(LIB_ROOT, 'papers'),
  text: join(LIB_ROOT, 'text'),
  cards: join(LIB_ROOT, 'cards'),
  blocks: join(LIB_ROOT, 'blocks'),
  translations: join(LIB_ROOT, 'translations'),
  drafts: join(LIB_ROOT, 'drafts'),
  deepread: join(LIB_ROOT, 'deepread'),
  chains: join(LIB_ROOT, 'chains'),
  themes: join(LIB_ROOT, 'themes'),
  cache: join(LIB_ROOT, 'cache', 'pages'),
  glossary: join(LIB_ROOT, 'glossary.json'),
  concepts: join(LIB_ROOT, 'concepts'),
  exports: join(LIB_ROOT, 'exports'),
  index: join(LIB_ROOT, 'index.jsonl'),
  tags: join(LIB_ROOT, 'tags.json'),
}

export const TYPES = [
  '学术期刊', '学位论文', '图书', '会议', '报纸', '年鉴',
  '专利', '标准', '成果', '学术辑刊', '文库', '法律法规',
]

const OLD_TYPE_MAP = {
  'journal-article': '学术期刊',
  conference: '会议',
  thesis: '学位论文',
  review: '学术期刊',
  guideline: '标准',
  preprint: '学术期刊',
  book: '图书',
  dataset: '成果',
}

const DEFAULT_TAGS = {
  version: 2,
  tags: [
    { name: '视盘视杯分割', keywords: ['视盘', '视杯', '杯盘比', 'cup-to-disc', 'cdr', 'optic disc', 'optic cup', 'glaucoma', '青光眼'] },
    { name: '极坐标与几何变换', keywords: ['极坐标', 'polar', '几何变换', '几何约束'] },
    { name: '拓扑约束', keywords: ['拓扑', 'topolog', '越界', '包含关系', 'containment'] },
    { name: '轻量化与部署', keywords: ['轻量', 'lightweight', '参数量', 'onnx', '部署', '推理速度', 'flops'] },
    { name: '注意力机制', keywords: ['注意力', 'attention', 'cbam', 'coordinate attention', '通道注意力'] },
    { name: '数据集与基准', keywords: ['refuge', 'origa', 'eyepacs', '数据集', 'benchmark', '挑战赛', 'challenge'] },
    { name: '临床验证', keywords: ['临床', '敏感度', '特异度', '医生', 'sensitivity', 'specificity', 'clinician'] },
    { name: '检索增强生成', keywords: ['rag', '检索增强', 'retrieval-augmented', '知识库', '知识图谱', '问答系统'] },
    { name: '分割骨干', keywords: ['u-net', 'unet', 'resnet', 'transformer', '语义分割', 'segmentation', 'encoder', 'decoder'] },
    { name: '医学影像大模型', keywords: ['大语言模型', 'large language model', 'llm', '多模态', 'multimodal', 'vqa'] },
  ],
}

export function ensureLibrary() {
  for (const dir of [PATHS.root, PATHS.papers, PATHS.text, PATHS.cards, PATHS.blocks, PATHS.translations, PATHS.cache, PATHS.concepts, PATHS.exports, PATHS.drafts, PATHS.deepread, PATHS.chains, PATHS.themes]) {
    // 只读库（或新目录暂不可写）不应让读路径整体失败；写操作会显式报错。
    try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* 读路径继续 */ }
  }
  if (!existsSync(PATHS.index)) writeFileSync(PATHS.index, '', 'utf8')
  if (!existsSync(PATHS.tags)) {
    writeFileSync(PATHS.tags, JSON.stringify(migrateTags(), null, 2), 'utf8')
  }
  return LIB_ROOT
}

/** 从旧的 topics.json 迁移（取最后一级作为扁平标签名）。 */
function migrateTags() {
  const legacy = join(LIB_ROOT, 'topics.json')
  if (!existsSync(legacy)) return DEFAULT_TAGS
  try {
    const old = JSON.parse(readFileSync(legacy, 'utf8'))
    const tags = (old.topics || []).map((t) => ({
      name: String(t.id || '').split('/').pop(),
      keywords: t.keywords || [],
    })).filter((t) => t.name)
    return tags.length ? { version: 2, tags } : DEFAULT_TAGS
  } catch {
    return DEFAULT_TAGS
  }
}

export function readTags() {
  ensureLibrary()
  try {
    const data = JSON.parse(readFileSync(PATHS.tags, 'utf8'))
    return Array.isArray(data.tags) ? data : DEFAULT_TAGS
  } catch {
    return DEFAULT_TAGS
  }
}

export function writeTags(data) {
  ensureLibrary()
  writeFileSync(PATHS.tags, JSON.stringify(data, null, 2), 'utf8')
}

export function readIndex() {
  ensureLibrary()
  const raw = readFileSync(PATHS.index, 'utf8')
  const rows = []
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text) continue
    try { rows.push(normalize(JSON.parse(text))) } catch { /* skip */ }
  }
  return rows
}

/** 兼容旧记录：类型改中文、去掉 roles/confidence。 */
function normalize(row) {
  const next = { ...row }
  if (!TYPES.includes(next.type)) next.type = OLD_TYPE_MAP[next.type] || '学术期刊'
  delete next.roles
  delete next.confidence
  next.topics = Array.isArray(next.topics)
    ? next.topics.map((t) => String(t).split('/').pop()).filter(Boolean)
    : []
  if (!next.status) next.status = '待读'
  return next
}

export function writeIndex(rows) {
  ensureLibrary()
  const tmp = PATHS.index + '.tmp'
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  renameSync(tmp, PATHS.index)
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function findByHash(hash) {
  return readIndex().find((row) => row.sha256 === hash) || null
}

export function findByDoi(doi) {
  const needle = String(doi || '').trim().toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  if (!needle) return null
  return readIndex().find((row) => String(row.doi || '').trim().toLowerCase() === needle) || null
}

export function upsert(record) {
  const rows = readIndex()
  const i = rows.findIndex((r) => r.id === record.id)
  if (i >= 0) rows[i] = { ...rows[i], ...record, updated: new Date().toISOString() }
  else rows.push({ ...record, added: new Date().toISOString(), updated: new Date().toISOString() })
  writeIndex(rows)
  return record
}

export function stats(rows) {
  const total = rows.length
  const untagged = rows.filter((r) => !(r.topics || []).length).length
  const cards = rows.filter((r) => r.card).length
  const byType = {}
  const byTag = {}
  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + 1
    for (const t of r.topics || []) byTag[t] = (byTag[t] || 0) + 1
  }
  return { total, untagged, cards, byType, byTag }
}
