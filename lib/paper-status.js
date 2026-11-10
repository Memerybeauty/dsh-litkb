/**
 * 阅读状态的自动标记：
 * - 七段卡生成成功 → 略读（若当前是待读/更早）
 * - 精读生成成功 → 精读（若当前是待读/略读）
 * - 用户手动切换状态 → statusSource=manual，后续自动标记不再覆盖
 *
 * 不建立强关联：自动标记只是默认动作，手动选择永远优先。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, readIndex, upsert } from './library.js'

const AUTO_RANK = { 待读: 0, 略读: 1, 精读: 2 }

function deepreadExists(id) {
  return existsSync(join(PATHS.deepread, `${id}.json`))
}

/** 自动把状态提升到 target；不降级、不覆盖手动状态。 */
export function applyAutoStatus(paperId, target) {
  const id = String(paperId || '')
  if (!(target in AUTO_RANK)) return null
  const record = readIndex().find((row) => row.id === id)
  if (!record) return null
  if (record.statusSource === 'manual') return record
  const current = record.status || '待读'
  if (!(current in AUTO_RANK)) return record
  if (AUTO_RANK[target] <= AUTO_RANK[current]) {
    if (!record.statusSource) {
      const next = { ...record, statusSource: 'auto' }
      upsert(next)
      return next
    }
    return record
  }
  const next = { ...record, status: target, statusSource: 'auto' }
  upsert(next)
  return next
}

/**
 * 一次性迁移旧库：没有 statusSource 的记录按现有产物补一个来源。
 * - 待读 + 有精读 → 精读
 * - 待读 + 有七段卡 → 略读
 * - 已引用 / 弃读 → manual
 * - 其他状态 → auto
 */
export function migrateAutoStatuses() {
  const rows = readIndex()
  let changed = 0
  for (const record of rows) {
    if (!record?.id || record.statusSource) continue
    const status = record.status || '待读'
    let nextStatus = status
    if (status === '待读') {
      if (deepreadExists(record.id)) nextStatus = '精读'
      else if (record.card || existsSync(join(PATHS.cards, `${record.id}.card.json`))) nextStatus = '略读'
    }
    const source = ['待读', '略读', '精读'].includes(nextStatus) ? 'auto' : 'manual'
    if (nextStatus !== status || source !== record.statusSource) {
      try {
        upsert({ ...record, status: nextStatus, statusSource: source })
        changed += 1
      } catch { /* 单条失败不阻断启动 */ }
    }
  }
  return changed
}

/** 供设置/诊断：按现有产物推断的目标状态。 */
export function inferredStatus(paperId) {
  const id = String(paperId || '')
  if (deepreadExists(id)) return '精读'
  const record = readIndex().find((row) => row.id === id)
  if (record?.card || existsSync(join(PATHS.cards, `${id}.card.json`))) return '略读'
  return '待读'
}

/** 仅供测试/诊断：读取原始状态来源。 */
export function readStatusSource(paperId) {
  const record = readIndex().find((row) => row.id === String(paperId || ''))
  return record?.statusSource || ''
}
