function json(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  })
  res.end(data)
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function tagCounts(rows) {
  const counts = {}
  for (const row of rows) for (const t of row.topics || []) counts[t] = (counts[t] || 0) + 1
  return counts
}

function listTags() {
  const defs = readTags()
  const counts = tagCounts(readIndex())
  return defs.tags.map((t) => ({ name: t.name, keywords: t.keywords || [], count: counts[t.name] || 0 }))
}

async function importPdfBuffer(buffer, filename = 'untitled.pdf', source = 'upload', metaOverride = {}) {
  if (buffer.length < 1000 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw Object.assign(new Error('不是 PDF 文件'), { code: 'not_pdf' })
  }
  const hash = sha256(buffer)
  const existing = findByHash(hash)
  if (existing) return { duplicate: true, paper: existing }
  let extracted
  try {
    extracted = await extractPdf(buffer)
  } catch (err) {
    const msg = `${err?.name || ''} ${err?.message || ''}`
    if (/password|encrypt/i.test(msg)) {
      throw Object.assign(new Error('PDF 已加密，请先解除密码'), { code: 'encrypted' })
    }
    throw Object.assign(new Error('无法解析该 PDF（可能已损坏或是扫描件）'), { code: 'parse_failed' })
  }
  if (extracted.chars < 50) {
    throw Object.assign(new Error('几乎抽不到文字（可能是扫描件），请先 OCR'), { code: 'parse_failed' })
  }
  const base = classify({ text: extracted.text, filename, info: extracted.info }, readTags().tags)
  const meta = {
    title: String(metaOverride.title || '').trim() || base.title,
    authors: String(metaOverride.authors || '').trim() || base.authors,
    year: String(metaOverride.year || '').trim() || base.year,
    venue: String(metaOverride.venue || '').trim() || base.venue,
    doi: String(metaOverride.doi || '').trim() || base.doi,
  }
  const doi = String(meta.doi || '').trim()
  if (doi) {
    const sameDoi = findByDoi(doi)
    if (sameDoi) return { duplicate: true, paper: sameDoi, duplicateCode: 'doi' }
  }
  const id = `p-${hash.slice(0, 8)}`
  const pdfFile = `${id}.pdf`
  writeFileSync(join(PATHS.papers, pdfFile), buffer)
  writeFileSync(join(PATHS.text, `${id}.txt`), extracted.text, 'utf8')
  const record = {
    id,
    citekey: id,
    sha256: hash,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    doi: meta.doi,
    type: base.type,
    topics: base.topics,
    status: '待读',
    file: pdfFile,
    pages: extracted.numPages,
    chars: extracted.chars,
    quality: extracted.quality,
    source,
    originalName: filename,
    importedAt: new Date().toISOString(),
    importedFrom: String(metaOverride.url || ''),
  }
  writeFileSync(join(PATHS.cards, `${id}.md`), renderCardMarkdown(record, readCard(id), extracted.text.slice(0, 600)), 'utf8')
  upsert(record)
  return { duplicate: false, paper: record, quality: extracted.quality }
}

async function importPdf(req, res) {
  try {
    const buffer = await readBody(req)
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'untitled.pdf'))
    const result = await importPdfBuffer(buffer, filename, 'upload')
    if (result.duplicate) {
      json(res, 200, { ok: true, duplicate: true, code: result.duplicateCode || 'duplicate_sha', paper: result.paper })
      return
    }
    json(res, 200, {
      ok: true,
      paper: result.paper,
      ingest: publicIngestJob(maybeStartIngest(result.paper)),
      warning: result.quality < 0.4 ? 'low_quality' : undefined,
      warningText: result.quality < 0.4 ? '解析质量偏低，建议人工核对' : undefined,
    })
  } catch (error) {
    if (error?.code === 'TOO_LARGE') {
      json(res, 413, { ok: false, code: 'too_large', error: '文件超过 80MB' })
      return
    }
    const code = error?.code || 'server_error'
    const status = code === 'not_pdf' ? 400 : (code === 'encrypted' || code === 'parse_failed' ? 422 : 500)
    json(res, status, { ok: false, code, error: String(error?.message || '服务端处理失败，请重试') })
  }
}

async function updatePaper(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8'))
    const rows = readIndex()
    const record = rows.find((r) => r.id === body.id)
    if (!record) {
      json(res, 404, { ok: false, error: 'paper not found' })
      return
    }
    const patch = body.patch || {}
    const next = { ...record }
    for (const key of ['title', 'year', 'venue', 'doi', 'status', 'authors']) {
      if (key in patch) next[key] = patch[key]
    }
    if ('status' in patch) {
      if (!STATUSES.includes(patch.status)) {
        json(res, 422, { ok: false, error: '未知状态' })
        return
      }
      next.statusReason = String(patch.reason || '').trim()
    }
    if (typeof patch.type === 'string') {
      if (!TYPES.includes(patch.type)) {
        json(res, 422, { ok: false, error: 'invalid type' })
        return
      }
      next.type = patch.type
    }
    if (Array.isArray(patch.topics)) next.topics = patch.topics.filter((t) => typeof t === 'string')
    if (patch.edited) next.edited = true

    const text = readFileSync(join(PATHS.text, `${record.id}.txt`), 'utf8')
    const card = readCard(record.id)
    if (card && 'status' in patch && patch.status !== record.status) {
      card.statusHistory = Array.isArray(card.statusHistory) ? card.statusHistory : []
      card.statusHistory.push({
        from: record.status || '待读',
        to: patch.status,
        at: new Date().toISOString(),
        reason: String(patch.reason || '').trim(),
      })
    }
    writeFileSync(join(PATHS.cards, `${record.id}.md`), renderCardMarkdown(next, card, text.slice(0, 600)), 'utf8')
    upsert(next)
    json(res, 200, { ok: true, paper: next })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function createTag(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8'))
    const name = String(body.name || '').trim()
    if (!name) {
      json(res, 422, { ok: false, error: '标签名不能为空' })
      return
    }
    if (name.length > 24) {
      json(res, 422, { ok: false, error: '标签名过长（≤24 字）' })
      return
    }
    const defs = readTags()
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
      : []
    const existing = defs.tags.find((t) => t.name === name)
    if (existing) {
      existing.keywords = keywords
    } else {
      defs.tags.push({ name, keywords })
    }
    writeTags(defs)
    json(res, 200, { ok: true, tags: listTags() })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function deleteTag(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    const name = String(body.name || '').trim()
    if (!name) {
      json(res, 422, { ok: false, error: '缺少标签名' })
      return
    }
    const rows = readIndex()
    const affected = rows.filter((r) => (r.topics || []).includes(name)).length
    if (!body.confirmed) {
      json(res, 409, { ok: false, error: '需要确认', affected })
      return
    }
    const defs = readTags()
    defs.tags = defs.tags.filter((t) => t.name !== name)
    writeTags(defs)
    for (const row of rows) {
      if ((row.topics || []).includes(name)) {
        row.topics = row.topics.filter((t) => t !== name)
        const text = readFileSync(join(PATHS.text, `${row.id}.txt`), 'utf8')
        writeFileSync(join(PATHS.cards, `${row.id}.md`), renderCardMarkdown(row, readCard(row.id), text.slice(0, 600)), 'utf8')
      }
    }
    writeIndex(rows)
    json(res, 200, { ok: true, affected, tags: listTags() })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

async function reclassify(req, res) {
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    const rows = readIndex()
    const tags = readTags().tags
    const targets = body.id ? rows.filter((r) => r.id === body.id) : rows
    const replace = body.replace === true
    for (const row of targets) {
      const text = readFileSync(join(PATHS.text, `${row.id}.txt`), 'utf8')
      const matched = matchTags({ title: row.title, text }, tags)
      row.topics = replace ? matched : [...new Set([...(row.topics || []), ...matched])]
      writeFileSync(join(PATHS.cards, `${row.id}.md`), renderCardMarkdown(row, readCard(row.id), text.slice(0, 600)), 'utf8')
    }
    writeIndex(rows)
    json(res, 200, { ok: true, updated: targets.length })
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

