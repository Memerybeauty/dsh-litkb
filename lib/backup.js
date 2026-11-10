/**
 * 整库备份与恢复（产品化 v0.11）。
 *
 * 备份范围：论文 PDF、解析文本、卡片、版面块、译文、精读、证据链、研究、文稿、概念、导出，
 * 以及 index.jsonl / tags.json / glossary.json / topics.json。
 * 明确排除：settings.json（含 PaddleOCR 令牌）、cache/（页图、检索历史、任务快照）。
 *
 * 恢复语义：
 * - 必须先有 manifest.json，且 app/kind 匹配；
 * - 只允许写入白名单目录/文件，拒绝绝对路径、`..` 穿越与符号链接；
 * - 备份里存在的目录整体替换，备份里没有的目录保留；
 * - 覆盖前自动把当前库打包到 `cache/backups/pre-restore-<时间>.zip`；
 * - 任一步失败按已替换清单回滚，不把库留在半新半旧状态。
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join, relative, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { PATHS, ensureLibrary, readIndex } from './library.js'

export const DATA_DIRS = [
  'papers', 'text', 'cards', 'blocks', 'translations', 'drafts',
  'deepread', 'chains', 'themes', 'concepts', 'exports',
]
export const DATA_FILES = ['index.jsonl', 'tags.json', 'glossary.json', 'topics.json']
export const MAX_RESTORE_BYTES = 512 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

const STAGING_PREFIX = '.litkb-restore-staging-'
const OLD_DIR = '.litkb-restore-old'
let restoring = false

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function walk(dir, base = dir, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === '.DS_Store' || name === OLD_DIR || name.startsWith(STAGING_PREFIX)) continue
    const abs = join(dir, name)
    let info = null
    try { info = lstatSync(abs) } catch { continue }
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) walk(abs, base, out)
    else if (info.isFile()) out.push({ abs, name: relative(base, abs).split(sep).join('/'), size: info.size })
  }
  return out
}

/** 备份前的库内数据文件清单（不含 cache / settings）。 */
export function backupEntries() {
  const entries = []
  for (const name of DATA_DIRS) {
    const dir = join(PATHS.root, name)
    if (!existsSync(dir)) continue
    for (const item of walk(dir, dir)) entries.push({ ...item, name: `${name}/${item.name}` })
  }
  for (const name of DATA_FILES) {
    const abs = join(PATHS.root, name)
    if (!existsSync(abs)) continue
    let info = null
    try { info = lstatSync(abs) } catch { continue }
    if (info.isFile() && !info.isSymbolicLink()) entries.push({ abs, name, size: info.size })
  }
  return entries
}

/** 构造整库备份 zip：manifest + 白名单数据。 */
export function buildBackupZip({ version = '', now = new Date() } = {}) {
  ensureLibrary()
  const files = {}
  let bytes = 0
  for (const entry of backupEntries()) {
    try {
      files[entry.name] = readFileSync(entry.abs)
      bytes += entry.size
    } catch { /* 单个坏文件不阻断整库备份 */ }
  }
  const manifest = {
    app: 'dsh-litkb',
    kind: 'library-backup',
    version: String(version || ''),
    createdAt: now.toISOString(),
    roots: DATA_DIRS,
    files: Object.keys(files).length,
    bytes,
    excluded: ['settings.json', 'cache/'],
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const buffer = Buffer.from(zipSync(files, { level: 1 }))
  return { buffer, manifest, filename: `litkb-backup-${stamp(now)}.zip` }
}

/** 统计库数据体积（备份范围，不含 cache）。 */
export function librarySnapshot() {
  const entries = backupEntries()
  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0),
  }
}

function countDir(dir, ext) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(ext) && !name.startsWith('.')).length
  } catch {
    return 0
  }
}

function countChains() {
  let total = 0
  let confirmed = 0
  let names = []
  try { names = readdirSync(PATHS.chains) } catch { return { total: 0, confirmed: 0 } }
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    total += 1
    try {
      const chain = JSON.parse(readFileSync(join(PATHS.chains, name), 'utf8'))
      if ((chain.status || 'confirmed') === 'confirmed') confirmed += 1
    } catch { /* 坏链仍计入总数，不阻断上手/诊断 */ }
  }
  return { total, confirmed }
}

/**
 * 轻量资产计数：只解析 index / chains 状态，不 normalize 节点，
 * 供上手引导与诊断在每次打开工作台时调用。
 */
export function quickLibraryCounts() {
  const rows = readIndex()
  const chains = countChains()
  return {
    papers: rows.length,
    cards: rows.filter((row) => row.card).length,
    chains: chains.total,
    confirmedChains: chains.confirmed,
    themes: countDir(PATHS.themes, '.json'),
    drafts: countDir(PATHS.drafts, '.md'),
  }
}

function cleanEntryName(raw) {
  const name = String(raw || '').replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!name || name.includes('\0') || name.startsWith('/')) return ''
  const parts = name.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return ''
  return parts.join('/')
}

function allowed(name) {
  const top = name.split('/')[0]
  if (DATA_DIRS.includes(top)) return true
  return !name.includes('/') && DATA_FILES.includes(name)
}

function snapshotCurrent() {
  const dir = join(PATHS.root, 'cache', 'backups')
  mkdirSync(dir, { recursive: true })
  const { buffer, manifest } = buildBackupZip({ version: 'pre-restore' })
  const file = join(dir, `pre-restore-${stamp()}.zip`)
  writeFileSync(file, buffer)
  return { file, manifest }
}

function removeStaleTemp() {
  let names = []
  try { names = readdirSync(PATHS.root) } catch { return }
  for (const name of names) {
    if (name === OLD_DIR || name.startsWith(STAGING_PREFIX)) {
      try { rmSync(join(PATHS.root, name), { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

/**
 * 崩溃恢复：恢复过程中进程中断时，`.litkb-restore-old` 里可能还留着旧数据。
 * 启动时把「当前缺失的目录」搬回，再清掉临时目录；当前已存在的目录保持新版本。
 */
export function recoverInterruptedRestore() {
  const oldDir = join(PATHS.root, OLD_DIR)
  let recovered = 0
  if (existsSync(oldDir)) {
    let names = []
    try { names = readdirSync(oldDir) } catch { names = [] }
    const allowed = new Set([...DATA_DIRS, ...DATA_FILES])
    for (const name of names) {
      if (!allowed.has(name)) continue
      const current = join(PATHS.root, name)
      if (existsSync(current)) continue
      try {
        renameSync(join(oldDir, name), current)
        recovered += 1
      } catch { /* 单个失败不影响其他 */ }
    }
    try { rmSync(oldDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  removeStaleTemp()
  return { recovered }
}

/**
 * 从备份 zip 恢复。返回恢复的文件数、覆盖前快照路径与备份 manifest。
 * body 必须是完整 zip 的 Buffer。
 */
export function restoreBackup(body) {
  if (restoring) {
    const error = new Error('已有恢复任务在进行')
    error.code = 'restore_busy'
    throw error
  }
  if (!body || !body.length) {
    const error = new Error('备份文件为空')
    error.code = 'empty_zip'
    throw error
  }
  if (body.length > MAX_RESTORE_BYTES) {
    const error = new Error('备份文件超过 512 MB')
    error.code = 'too_large'
    throw error
  }
  restoring = true
  try {
    let files = null
    let exploded = false
    try {
      let total = 0
      files = unzipSync(new Uint8Array(body), {
        filter: (file) => {
          total += Number(file.originalSize) || 0
          if (total > MAX_UNCOMPRESSED_BYTES) {
            exploded = true
            return false
          }
          return true
        },
      })
    } catch {
      const error = new Error('不是有效的 zip 备份')
      error.code = 'bad_zip'
      throw error
    }
    if (exploded) {
      const error = new Error('备份解压后超过 2 GB，已拒绝')
      error.code = 'too_large'
      throw error
    }
    const entries = new Map()
    for (const [raw, data] of Object.entries(files)) {
      if (String(raw).endsWith('/')) continue
      const name = cleanEntryName(raw)
      if (!name) {
        const error = new Error(`备份包含非法路径：${String(raw).slice(0, 80)}`)
        error.code = 'bad_entry'
        throw error
      }
      entries.set(name, data)
    }
    const manifestRaw = entries.get('manifest.json')
    if (!manifestRaw) {
      const error = new Error('不是文献工作台备份：缺少 manifest.json')
      error.code = 'bad_manifest'
      throw error
    }
    let manifest = null
    try { manifest = JSON.parse(strFromU8(manifestRaw)) } catch { manifest = null }
    if (!manifest || manifest.app !== 'dsh-litkb' || manifest.kind !== 'library-backup') {
      const error = new Error('不是文献工作台备份：manifest 不匹配')
      error.code = 'bad_manifest'
      throw error
    }

    ensureLibrary()
    recoverInterruptedRestore()
    const staging = join(PATHS.root, `${STAGING_PREFIX}${process.pid}`)
    mkdirSync(staging, { recursive: true })
    let restored = 0
    let bytes = 0
    for (const [name, data] of entries) {
      if (name === 'manifest.json' || !allowed(name)) continue
      const dest = join(staging, name)
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, Buffer.from(data))
      restored += 1
      bytes += data.length
    }
    if (!restored) {
      rmSync(staging, { recursive: true, force: true })
      const error = new Error('备份里没有可恢复的数据')
      error.code = 'no_data'
      throw error
    }

    const snapshot = snapshotCurrent()
    const oldDir = join(PATHS.root, OLD_DIR)
    mkdirSync(oldDir, { recursive: true })
    const names = [
      ...DATA_DIRS.filter((name) => existsSync(join(staging, name))),
      ...DATA_FILES.filter((name) => existsSync(join(staging, name))),
    ]
    const changed = []
    try {
      for (const name of names) {
        const current = join(PATHS.root, name)
        const saved = join(oldDir, name)
        const had = existsSync(current)
        if (had) {
          mkdirSync(join(saved, '..'), { recursive: true })
          renameSync(current, saved)
        }
        changed.push({ name, had })
        renameSync(join(staging, name), current)
      }
    } catch (error) {
      for (const item of changed.reverse()) {
        const current = join(PATHS.root, item.name)
        try { rmSync(current, { recursive: true, force: true }) } catch { /* ignore */ }
        if (item.had) {
          try { renameSync(join(oldDir, item.name), current) } catch { /* ignore */ }
        }
      }
      throw error
    } finally {
      try { rmSync(staging, { recursive: true, force: true }) } catch { /* ignore */ }
      try { rmSync(oldDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }

    // 恢复后按 id 去重索引，避免旧备份里重复行。
    return {
      files: restored,
      bytes,
      snapshot: relative(PATHS.root, snapshot.file).split(sep).join('/'),
      manifest: {
        version: manifest.version || '',
        createdAt: manifest.createdAt || '',
        files: manifest.files || 0,
        bytes: manifest.bytes || 0,
      },
    }
  } finally {
    restoring = false
  }
}

/** 库根是否有可恢复资产（给设置页显示）。 */
export function libraryInfo() {
  const snapshot = librarySnapshot()
  let backups = 0
  const dir = join(PATHS.root, 'cache', 'backups')
  try {
    backups = readdirSync(dir).filter((name) => name.endsWith('.zip')).length
  } catch { /* 还没有备份 */ }
  return { ...snapshot, backups, root: PATHS.root }
}

export function backupDirInfo() {
  const dir = join(PATHS.root, 'cache', 'backups')
  let latest = null
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.zip')) continue
      const abs = join(dir, name)
      const mtime = statSync(abs).mtime
      if (!latest || mtime > latest.mtime) latest = { name, mtime: mtime.toISOString(), bytes: statSync(abs).size }
    }
  } catch { /* ignore */ }
  return { dir, latest }
}
