/**
 * dsh-litkb · 服务端插件（v0.3.0 / P2.1）
 * 大类（知网 12 类）+ 扁平标签 + 七段卡（章节切分 / 证据块 / 卡片页）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PATHS, TYPES, ensureLibrary, findByDoi, findByHash, readIndex, readTags, sha256, stats, upsert,
  writeIndex, writeTags,
} from './library.js'
import { addAnnotation, addQuoteEvidence, cardSummary, listVersions, readCard, readVersion, recomputeCardStatus, renderCardMarkdown, writeCard } from './cards.js'
import { blocksSummary, ensureBlocks, readBlocks, renderParsedMarkdown, repairEvidenceBlocks } from './blocks.js'
import { documentParagraphs, paragraphPages } from './paragraphs.js'
import { renderPagePng } from './render.js'
import { publicSettings, writeSettings } from './settings.js'
import { glossaryHash, readGlossary, writeGlossary } from './glossary.js'
import { readTranslation, translateDocument, translationSummary } from './translate.js'
import { evidenceCsv, evidenceRows, findBacklinks } from './evidence-scan.js'
import { applySection, callModel, generateCard, generateCardSection, llmStatus, parseModelJson, SECTION_DEFS } from './cardgen.js'
import { mergeConcepts, readConcepts, readEdges, rebuildEdges, updateConcept, writeConcepts } from './concepts.js'
import { buildAll, compareGroups, conceptOverview, readGraph } from './graph.js'
import { askPaper } from './ask.js'
import { exportBibtex, exportBilingual, exportCanvas, exportCardMarkdown, exportGbt, exportMermaid } from './export.js'
import { assistDraft, createDraft, deleteDraft, draftCitations, exportDraft, listDrafts, readDraft, saveDraft, searchEvidence } from './drafts.js'
import { draftToDocx } from './docx-export.js'
import { buildVaultZip } from './vault-export.js'
import { loadPaperPages } from './pdftext.js'
import { buildDeepRead, readDeepRead, writeDeepRead } from './deepread.js'
import { appendChainToDraft, autoChainDrafts, chainGraph, chainParagraph, claimCandidates, deleteChain, listChains, proposeChain, readChain, saveChain, suggestClaim, writeChainLayout } from './chains.js'
import { searchLibrary } from './search.js'
import { answerQuestion } from './answer.js'
import { AGENT_TOOL_NAMES, registerAgentTools } from './agent-tools.js'
import { autoCrossPaperDrafts } from './chain-cross.js'
import { listSearchHistory, recordSearch } from './search-history.js'
import { resolveLink } from './link-import.js'
import {
  aggregateThemePapers, bindThemeDraft, buildThemeOutline, buildThemeSummary, deleteTheme, listThemes, markThemeRun,
  matchTheme, readTheme, recordThemeMatch, saveTheme, setThemePaper, themeChainDrafts, themeChains,
  themePapers, themeStats, summaryState, updateThemeSummary,
} from './themes.js'
import {
  analysisPapers, analysisStats, createViewpointChain, extractPaperAnalysis,
  readAnalysis, saveAnalysis, synthesizeFacet,
} from './theme-analysis.js'
import { extractPdf } from './pdf.js'
import { classify, matchTags } from './classify.js'
import {
  backupDirInfo, buildBackupZip, libraryInfo, MAX_RESTORE_BYTES, quickLibraryCounts,
  recoverInterruptedRestore, restoreBackup,
} from './backup.js'
import { deletePaper, paperDeleteImpact } from './paper-delete.js'
import { applyAutoStatus, migrateAutoStatuses } from './paper-status.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
export const STARTED_AT = new Date().toISOString()

export const name = 'dsh-litkb'
export const inject = ['webServer']

