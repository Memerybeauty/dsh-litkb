/**
 * 整库 Obsidian vault：文稿 + 卡片 + BibTeX，打成 zip。
 * 目录结构固定，文件名做安全化，不改原库。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { PATHS, readIndex } from './library.js'
import { listDrafts, exportDraft } from './drafts.js'
import { exportBibtex } from './export.js'

function safeName(value, fallback) {
  const name = String(value || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return name || fallback
}

export function buildVaultZip() {
  const files = {}
  const drafts = listDrafts()
  for (const draft of drafts) {
    const body = exportDraft(draft.id)
    if (body) files[`文稿/${safeName(draft.title, draft.id)}.md`] = strToU8(body)
  }
  for (const record of readIndex()) {
    const card = join(PATHS.cards, `${record.id}.md`)
    if (!existsSync(card)) continue
    files[`论文/${safeName(record.title, record.id)}.md`] = strToU8(readFileSync(card, 'utf8'))
  }
  files['参考文献/all.bib'] = strToU8(exportBibtex())
  files['README.md'] = strToU8([
    '# 文献工作台导出',
    '',
    `- 文稿：${drafts.length} 篇`,
    '- 论文卡片：见「论文/」',
    '- 参考文献：`参考文献/all.bib`',
    '',
  ].join('\n'))
  return Buffer.from(zipSync(files, { level: 6 }))
}
