/**
 * 场景补口：DOI / arXiv / 普通网页链接 → PDF buffer + 元数据。
 * 只下载开放可访问的 PDF；拿不到 PDF 时明确返回 no_pdf，不抓 HTML 冒充。
 */
const MAX_BYTES = 80 * 1024 * 1024
const TIMEOUT_MS = 45000

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

export function extractDoi(value) {
  const text = String(value || '').trim()
  const match = text.match(/10\.\d{4,9}\/[^\s"'<>]+/i)
  return match ? match[0].replace(/[.,;)]+$/, '') : ''
}

export function extractArxivId(value) {
  const text = String(value || '').trim()
  const match = text.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i)
  return match ? match[1] : ''
}

export function parseCitationMeta(html, baseUrl = '') {
  const meta = {}
  const pick = (name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
    const match = String(html || '').match(re)
    return match ? decodeEntities(match[1]) : ''
  }
  meta.title = pick('citation_title') || pick('og:title')
  meta.pdfUrl = pick('citation_pdf_url')
  const authors = []
  const authorRe = /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["']/gi
  let authorMatch = authorRe.exec(String(html || ''))
  while (authorMatch) {
    authors.push(decodeEntities(authorMatch[1]))
    authorMatch = authorRe.exec(String(html || ''))
  }
  meta.authors = authors.join('; ')
  const date = pick('citation_publication_date') || pick('citation_date')
  meta.year = (date.match(/\d{4}/) || [''])[0]
  meta.venue = pick('citation_journal_title') || pick('citation_conference_title')
  meta.doi = pick('citation_doi')
  const link = String(html || '').match(/<link[^>]+type=["']application\/pdf["'][^>]+href=["']([^"']+)["']/i)
  if (!meta.pdfUrl && link) meta.pdfUrl = decodeEntities(link[1])
  if (meta.pdfUrl && baseUrl) {
    try { meta.pdfUrl = new URL(meta.pdfUrl, baseUrl).toString() } catch { /* keep */ }
  }
  return meta
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'dsh-litkb/0.1 (literature import; contact: local)',
        accept: 'application/pdf,text/html;q=0.9,*/*;q=0.5',
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw fail('timeout', '下载超时（45 秒）')
    throw fail('fetch_failed', `下载失败：${String(error?.message || error)}`)
  } finally {
    clearTimeout(timer)
  }
}

async function readPdf(response, url) {
  const type = String(response.headers.get('content-type') || '').toLowerCase()
  if (!response.ok) throw fail('http_error', `下载失败：HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_BYTES) throw fail('too_large', '文件超过 80MB')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_BYTES) throw fail('too_large', '文件超过 80MB')
  if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    throw fail('no_pdf', `这个地址不是 PDF（${type || 'unknown'}）：${url}`)
  }
  return buffer
}

async function fetchHtml(url) {
  const response = await fetchWithTimeout(url, { headers: { accept: 'text/html,application/xhtml+xml' } })
  if (!response.ok) throw fail('http_error', `页面打开失败：HTTP ${response.status}`)
  return { html: await response.text(), url: response.url || url }
}

async function resolveDoi(doi) {
  const clean = extractDoi(doi)
  if (!clean) throw fail('bad_doi', 'DOI 格式不正确')
  let meta = { doi: clean }
  try {
    const response = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, {
      headers: { accept: 'application/json' },
    })
    if (response.ok) {
      const data = await response.json()
      const item = data?.message || {}
      const authors = (item.author || []).map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean)
      const year = item['published-print']?.['date-parts']?.[0]?.[0]
        || item['published-online']?.['date-parts']?.[0]?.[0]
        || item.issued?.['date-parts']?.[0]?.[0] || ''
      meta = {
        title: (item.title || [])[0] || '',
        authors: authors.join('; '),
        year: String(year || ''),
        venue: (item['container-title'] || [])[0] || '',
        doi: item.DOI || clean,
      }
      const links = Array.isArray(item.link) ? item.link : []
      const pdfLink = links.find((link) => /pdf/i.test(String(link['content-type'] || '')) && link.URL)
        || links.find((link) => /pdf/i.test(String(link.URL || '')))
      if (pdfLink?.URL) {
        const responsePdf = await fetchWithTimeout(pdfLink.URL)
        return { buffer: await readPdf(responsePdf, pdfLink.URL), filename: `${clean.replace(/[^\w.-]+/g, '_')}.pdf`, meta, url: pdfLink.URL }
      }
    }
  } catch (error) {
    if (['no_pdf', 'too_large', 'fetch_failed', 'timeout'].includes(error?.code)) throw error
  }
  // 兜底：DOI 解析地址，只有返回 PDF 才接受
  try {
    const response = await fetchWithTimeout(`https://doi.org/${encodeURIComponent(clean)}`)
    if (response.ok) {
      const buffer = await readPdf(response, response.url || `https://doi.org/${clean}`)
      return { buffer, filename: `${clean.replace(/[^\w.-]+/g, '_')}.pdf`, meta, url: response.url || `https://doi.org/${clean}` }
    }
  } catch (error) {
    if (error?.code === 'no_pdf') throw error
  }
  throw fail('no_pdf', 'DOI 已解析到元数据，但没有开放 PDF；请下载 PDF 后本地导入，或直接贴 PDF 链接。')
}

async function resolveArxiv(value) {
  const id = extractArxivId(value)
  if (!id) throw fail('bad_arxiv', 'arXiv ID 格式不正确')
  let meta = {}
  try {
    const response = await fetchWithTimeout(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
      headers: { accept: 'application/atom+xml' },
    })
    if (response.ok) {
      const xml = await response.text()
      const title = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
      const authors = [...xml.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/gi)].map((match) => decodeEntities(match[1].trim()))
      const published = xml.match(/<published>(\d{4})-/i)?.[1]
      meta = { title: decodeEntities(title || ''), authors: authors.join('; '), year: published || '', venue: 'arXiv', doi: '' }
    }
  } catch { /* metadata optional */ }
  const pdfUrl = `https://arxiv.org/pdf/${id}.pdf`
  const response = await fetchWithTimeout(pdfUrl)
  return { buffer: await readPdf(response, pdfUrl), filename: `arxiv-${id.replace(/\//g, '-')}.pdf`, meta, url: `https://arxiv.org/abs/${id}` }
}

async function resolveUrl(value) {
  const url = String(value || '').trim()
  if (!/^https?:\/\//i.test(url)) throw fail('bad_url', '请输入 http(s) 链接')
  if (/arxiv\.org\/(?:abs|pdf)\//i.test(url)) return resolveArxiv(url)
  if (/doi\.org\//i.test(url)) return resolveDoi(url)
  let response = await fetchWithTimeout(url)
  if (!response.ok) throw fail('http_error', `下载失败：HTTP ${response.status}`)
  const type = String(response.headers.get('content-type') || '').toLowerCase()
  if (type.includes('pdf')) {
    return { buffer: await readPdf(response, response.url || url), filename: 'link-import.pdf', meta: {}, url: response.url || url }
  }
  const html = await response.text()
  const meta = parseCitationMeta(html, response.url || url)
  if (!meta.pdfUrl) throw fail('no_pdf', '这个页面没有找到 citation_pdf_url；请直接贴 PDF 链接或下载后本地导入。')
  response = await fetchWithTimeout(meta.pdfUrl)
  const buffer = await readPdf(response, meta.pdfUrl)
  return { buffer, filename: 'link-import.pdf', meta, url: meta.pdfUrl }
}

/** 统一入口：kind=auto/url/doi/arxiv。 */
export async function resolveLink(value, kind = 'auto') {
  const text = String(value || '').trim()
  if (!text) throw fail('empty', '请输入链接、DOI 或 arXiv ID')
  if (kind === 'doi' || (kind === 'auto' && extractDoi(text) && !/^https?:\/\//i.test(text))) return resolveDoi(text)
  if (kind === 'arxiv' || (kind === 'auto' && extractArxivId(text) && !/doi\.org/i.test(text))) return resolveArxiv(text)
  return resolveUrl(text)
}
