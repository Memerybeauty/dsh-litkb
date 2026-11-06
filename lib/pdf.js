/**
 * PDF → 分页文本 + 文档信息。
 * pdfjs-dist 在 Node 下不需要 canvas，只做文本抽取。
 */
let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

export async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(buffer)
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise

  const pages = []
  const maxPages = Math.min(doc.numPages, 60)
  for (let p = 1; p <= maxPages; p += 1) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pages.push(text)
    page.cleanup()
  }

  let info = {}
  try {
    const meta = await doc.getMetadata()
    info = meta?.info || {}
  } catch { /* metadata is optional */ }

  await doc.destroy()

  const chars = pages.reduce((n, t) => n + t.length, 0)
  return {
    numPages: doc.numPages,
    pages,
    text: pages.join('\n\n'),
    chars,
    info,
    quality: qualityScore(pages, chars, doc.numPages),
  }
}

function qualityScore(pages, chars, numPages) {
  if (!numPages) return 0
  const nonEmpty = pages.filter((t) => t.length > 40).length
  const perPage = chars / Math.max(1, pages.length)
  let score = 0
  if (perPage >= 800) score += 0.5
  else if (perPage >= 300) score += 0.35
  else if (perPage >= 100) score += 0.2
  score += Math.min(0.4, (nonEmpty / pages.length) * 0.4)
  const bad = (pages.join('').match(/\uFFFD/g) || []).length
  if (bad > chars * 0.01) score -= 0.2
  return Math.max(0, Math.min(1, Number(score.toFixed(2))))
}
