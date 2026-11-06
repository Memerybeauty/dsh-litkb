/**
 * PaddleOCR 官方 API 适配器（P2.2 主解析器）。
 *
 * 接口（AI Studio 官方托管）：
 *   POST https://paddleocr.aistudio-app.com/api/v2/ocr/jobs   multipart: model / optionalPayload / file
 *   GET  /api/v2/ocr/jobs/<jobId>                             state: pending|running|done|failed
 *   done → resultUrl.jsonUrl 指向 JSONL；每行 result.layoutParsingResults[] 就是逐页结果
 *   prunedResult.parsing_res_list[]：block_label / block_content / block_bbox / block_order
 *
 * 输出统一成 blocks schema；下游（解析稿、页图、证据回链）完全不感知解析器。
 */
import { tidyLine } from './pdftext.js'
import { makeBlockId } from './layout.js'
import { detectBoundary } from './sections.js'
import { paddleCredentials } from './settings.js'

const DEFAULT_BASE = 'https://paddleocr.aistudio-app.com'
const JOBS_PATH = '/api/v2/ocr/jobs'
const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 15 * 60 * 1000
const REQUEST_TIMEOUT_MS = 120000

const ROLE_MAP = {
  doc_title: 'title',
  paragraph_title: 'heading1',
  abstract: 'abstract',
  text: 'paragraph',
  content: 'paragraph',
  vertical_text: 'paragraph',
  header: 'header',
  footer: 'footer',
  footnote: 'footer',
  figure: 'figure',
  figure_title: 'caption',
  image: 'figure',
  chart: 'figure',
  table: 'table',
  table_title: 'caption',
  formula: 'formula',
  reference: 'reference',
}

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function baseUrl() {
  return (process.env.PADDLEOCR_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new Error('aborted')); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('aborted'))
    }, { once: true })
  })
}

async function request(url, { method = 'GET', headers = {}, body, signal } = {}) {
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]
  if (signal) signals.push(signal)
  const composed = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]
  let response
  try {
    response = await fetch(url, { method, headers, body, signal: composed })
  } catch (error) {
    if (signal?.aborted) throw fail('aborted', '解析已取消')
    throw fail('paddle_network', `连接 PaddleOCR 失败：${error?.message || error}`)
  }
  return response
}

async function readJson(response) {
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw fail('paddle_auth', 'PaddleOCR 令牌无效或已过期')
    if (response.status === 429) throw fail('paddle_rate', 'PaddleOCR 触发限流，请稍后再试')
    throw fail('paddle_http', `PaddleOCR HTTP ${response.status}：${body?.msg || text.slice(0, 200)}`)
  }
  if (!body || body.code !== 0) {
    throw fail('paddle_http', `PaddleOCR 返回错误：${body?.msg || text.slice(0, 200)}`)
  }
  return body.data
}

/** 提交解析任务，返回 jobId。 */
export async function submitJob(buffer, { token, model, signal, filename = 'paper.pdf' }) {
  if (!token) throw fail('paddle_no_token', '未配置 PaddleOCR 访问令牌')
  const form = new FormData()
  form.append('model', model)
  form.append('optionalPayload', JSON.stringify({}))
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename)
  const response = await request(`${baseUrl()}${JOBS_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal,
  })
  const data = await readJson(response)
  if (!data?.jobId) throw fail('paddle_http', 'PaddleOCR 未返回 jobId')
  return data.jobId
}

/** 轮询到完成，返回 JSONL 文本。 */
export async function waitJob(jobId, { token, signal, onProgress }) {
  const deadline = Date.now() + MAX_WAIT_MS
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    await sleep(POLL_INTERVAL_MS, signal)
    const response = await request(`${baseUrl()}${JOBS_PATH}/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    const data = await readJson(response)
    const state = data?.state
    if (state === 'done') {
      const url = data?.resultUrl?.jsonUrl
      if (!url) throw fail('paddle_http', 'PaddleOCR 任务完成但没有结果地址')
      const result = await request(url, { signal })
      if (!result.ok) throw fail('paddle_http', `下载解析结果失败：HTTP ${result.status}`)
      return result.text()
    }
    if (state === 'failed') {
      throw fail('paddle_job_failed', `PaddleOCR 解析失败：${data?.errorMsg || '未知原因'}`)
    }
    onProgress?.({
      state,
      extractedPages: data?.extractProgress?.extractedPages ?? 0,
      totalPages: data?.extractProgress?.totalPages ?? 0,
    })
  }
  throw fail('paddle_timeout', 'PaddleOCR 解析超时（15 分钟），可重试')
}

function cleanContent(content) {
  return String(content || '')
    .split('\n')
    .map((line) => tidyLine(line))
    .filter((line) => line.trim())
    .join('\n')
    .trim()
}

function roleOf(label, text) {
  const role = ROLE_MAP[String(label || '').toLowerCase()] || 'paragraph'
  if (/^(关\s*键\s*词|keywords?)/i.test(text)) return 'keywords'
  if (/^(摘\s*要|abstract)/i.test(text)) return 'abstract'
  return role
}

/**
 * JSONL → blocks schema。
 * @param {string} jsonl
 * @param {string} model
 */
export function normalizePaddleResult(jsonl, model = 'PaddleOCR-VL-1.6') {
  const lines = String(jsonl || '').trim().split('\n').filter((line) => line.trim())
  if (!lines.length) throw fail('paddle_empty', 'PaddleOCR 结果为空')
  const pages = []
  let pageNo = 0
  for (const line of lines) {
    let parsed
    try { parsed = JSON.parse(line) } catch { continue }
    const results = parsed?.result?.layoutParsingResults
    if (!Array.isArray(results)) continue
    for (const item of results) {
      pageNo += 1
      const pruned = item?.prunedResult || {}
      const width = Number(pruned.width) || 1
      const height = Number(pruned.height) || 1
      const list = Array.isArray(pruned.parsing_res_list) ? pruned.parsing_res_list : []
      let section = null
      const blocks = []
      for (const raw of list) {
        const text = cleanContent(raw?.block_content)
        if (!text) continue
        const role = roleOf(raw?.block_label, text)
        if (role === 'heading1') {
          const boundary = detectBoundary(text)
          if (boundary && boundary.key !== 'other') section = boundary.key
        }
        if (role === 'abstract') section = 'abstract'
        if (role === 'keywords') section = 'keywords'
        if (role === 'reference' || /^(参考文献|references)\b/i.test(text)) section = 'references'
        const bboxPx = Array.isArray(raw?.block_bbox) ? raw.block_bbox : [0, 0, width, height]
        blocks.push({
          id: makeBlockId(pageNo, bboxPx, text),
          role,
          section: section || (role === 'abstract' ? 'abstract' : 'other'),
          text,
          bbox: [
            bboxPx[0] / width, bboxPx[1] / height,
            bboxPx[2] / width, bboxPx[3] / height,
          ].map((v) => Number(Math.max(0, Math.min(1, v)).toFixed(4))),
          font: 0,
          lines: text.split('\n').length,
          order: blocks.length,
        })
      }
      pages.push({
        page: pageNo,
        width: Number(width.toFixed(1)),
        height: Number(height.toFixed(1)),
        rotation: 0,
        columns: 1,
        quality: blocks.length ? 0.95 : 0,
        blocks,
      })
    }
  }
  if (!pages.length) throw fail('paddle_empty', 'PaddleOCR 没有返回任何页面')
  const blockCount = pages.reduce((n, p) => n + p.blocks.length, 0)
  return {
    schema: 1,
    parser: `paddleocr/${model}`,
    numPages: pages.length,
    truncated: false,
    quality: {
      layout: Number((pages.reduce((n, p) => n + p.quality, 0) / pages.length).toFixed(2)),
      columns: 0,
      emptyPages: pages.filter((p) => !p.blocks.length).map((p) => p.page),
    },
    builtAt: new Date().toISOString(),
    pages,
    stats: { pages: pages.length, blocks: blockCount, engine: 'paddleocr' },
  }
}

/** 一步到位：提交 → 轮询 → 规范化。失败抛错，由调用方决定是否兜底。 */
export async function parsePdfWithPaddle(buffer, { signal, onProgress, filename } = {}) {
  const { token, model, enabled } = paddleCredentials()
  if (!enabled) throw fail('paddle_disabled', 'PaddleOCR 已被关闭')
  if (!token) throw fail('paddle_no_token', '未配置 PaddleOCR 访问令牌')
  const jobId = await submitJob(buffer, { token, model, signal, filename })
  onProgress?.({ state: 'pending', step: '已提交 PaddleOCR，等待解析' })
  const jsonl = await waitJob(jobId, { token, signal, onProgress })
  return normalizePaddleResult(jsonl, model)
}
