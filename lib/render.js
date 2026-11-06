/**
 * 页图渲染（P2.2）：pdfjs + @napi-rs/canvas → PNG，磁盘缓存。
 *
 * 字体参数是踩过的坑（已实测）：
 *   disableFontFace: true + useSystemFonts: false + standardFontDataUrl
 * 用 useSystemFonts: true 会丢数字与拉丁字母。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { PATHS } from './library.js'

const require = createRequire(import.meta.url)
let pdfjsPromise = null
let canvasPromise = null
let standardFontDataUrl = null
const inflight = new Map()

function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

function loadCanvas() {
  if (!canvasPromise) canvasPromise = import('@napi-rs/canvas')
  return canvasPromise
}

function fontsUrl() {
  if (!standardFontDataUrl) {
    standardFontDataUrl = `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`
  }
  return standardFontDataUrl
}

export function pageImagePath(id, page, dpi) {
  return join(PATHS.cache, id, `${page}@${dpi}.png`)
}

/** 渲染一页为 PNG；同一页并发请求共享一次渲染。 */
export async function renderPagePng(record, pageNo, dpi = 120) {
  const page = Math.max(1, Number(pageNo) || 1)
  const scaleDpi = Math.min(216, Math.max(72, Number(dpi) || 120))
  const file = pageImagePath(record.id, page, scaleDpi)
  if (existsSync(file)) return readFileSync(file)
  if (inflight.has(file)) return inflight.get(file)

  const task = (async () => {
    const pdfPath = join(PATHS.papers, record.file)
    if (!existsSync(pdfPath)) {
      const error = new Error('PDF 文件缺失，无法渲染')
      error.code = 'pdf_missing'
      throw error
    }
    let pdfjs
    let createCanvas
    try {
      pdfjs = await loadPdfjs()
      ;({ createCanvas } = await loadCanvas())
    } catch {
      const error = new Error('页图组件不可用（缺少 @napi-rs/canvas）')
      error.code = 'no_canvas'
      throw error
    }
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(pdfPath)),
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
      standardFontDataUrl: fontsUrl(),
    }).promise
    try {
      const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
      const viewport = pdfPage.getViewport({ scale: scaleDpi / 72 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const buffer = canvas.toBuffer('image/png')
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, buffer)
      return buffer
    } finally {
      await doc.destroy()
    }
  })().finally(() => inflight.delete(file))

  inflight.set(file, task)
  return task
}
