/** P5.1/P5.2 研究工作台 HTTP：研究 CRUD、匹配、建链任务、论文增删、审核筛选、结论/提纲。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-theme-http-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
ensureLibrary()

const papers = [
  {
    id: 'p-r1',
    citekey: 'p-r1',
    title: 'Polar transform for optic disc',
    authors: 'Wu B.',
    year: 2024,
    venue: 'Journal',
    doi: '',
    type: '学术期刊',
    topics: ['分割'],
    status: '精读',
    file: 'p-r1.pdf',
    pages: 5,
    chars: 900,
    quality: 0.9,
    added: new Date().toISOString(),
  },
  {
    id: 'p-r2',
    citekey: 'p-r2',
    title: 'Multicenter validation study',
    authors: 'Li C.',
    year: 2025,
    venue: 'Conference',
    doi: '',
    type: '会议',
    topics: ['临床验证'],
    status: '精读',
    file: 'p-r2.pdf',
    pages: 4,
    chars: 800,
    quality: 0.9,
    added: new Date().toISOString(),
  },
]
const decks = {
  'p-r1': [
    { id: 'q-11112222', page: 3, block: 'b-1', quote: 'Polar transform improves Dice to 0.95 on REFUGE.' },
    { id: 'q-33334444', page: 4, block: 'b-2', quote: 'The polar transform keeps boundaries continuous.' },
  ],
  'p-r2': [{ id: 'q-55556666', page: 2, block: 'b-3', quote: 'Multicenter validation improves boundary Dice.' }],
}
for (const record of papers) {
  upsert(record)
  writeCard(
    {
      paperId: record.id,
      status: 'ready',
      model: 'fake',
      generatedAt: new Date().toISOString(),
      sections: [{ key: 'oneLine', title: '一句话', text: '概述。', evidence: [] }],
      evidence: decks[record.id].map((ev) => ({ ...ev, kind: 'author_claim' })),
      annotations: [],
      warnings: [],
      statusHistory: [],
    },
    record,
  )
}

const server = await import('../lib/index.js')
const routes = []
server.apply({ webServer: { register: (route) => routes.push(route) }, logger: { info() {} } })

function makeReq({ method = 'GET', url = '/', body = null } = {}) {
  const handlers = { data: [], end: [] }
  return {
    method,
    url,
    headers: {},
    on(event, fn) {
      handlers[event]?.push(fn)
      if (event === 'end') {
        queueMicrotask(() => {
          if (body !== null) {
            const chunk = Buffer.from(JSON.stringify(body))
            for (const listener of handlers.data) listener(chunk)
          }
          for (const listener of handlers.end) listener()
        })
      }
    },
  }
}
function makeRes() {
  return {
    code: 0,
    body: '',
    writeHead(code) {
      this.code = code
    },
    end(body) {
      this.body = String(body || '')
    },
  }
}
async function call(path, { method = 'GET', body = null, url = null } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, path)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body }), res)
  return { code: res.code, data: JSON.parse(res.body) }
}
async function waitJob(id) {
  for (let i = 0; i < 100; i += 1) {
    const { data } = await call('/api/litkb/themes/jobs', { url: `/api/litkb/themes/jobs?id=${id}` })
    if (data.job && ['done', 'failed'].includes(data.job.status)) return data.job
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('任务未在预期时间内完成')
}

const saved = await call('/api/litkb/themes/save', {
  method: 'POST',
  body: {
    title: '视盘分割综述',
    description: '极坐标与多中心验证',
    tags: ['分割'],
    facets: [
      { title: '极坐标变换', description: 'polar transform', keywords: ['polar'] },
      { title: '临床验证', description: 'multicenter validation', keywords: ['multicenter'] },
    ],
  },
})
assert.equal(saved.code, 200)
const themeId = saved.data.theme.id
assert.match(themeId, /^t-[a-z0-9]{8}$/)

const badSave = await call('/api/litkb/themes/save', { method: 'POST', body: { title: ' ' } })
assert.equal(badSave.code, 422)
assert.equal(badSave.data.code, 'empty_title')

const list = await call('/api/litkb/themes')
assert.equal(list.data.themes.length, 1)
assert.equal(list.data.themes[0].stats.facets, 2)

const missing = await call('/api/litkb/themes/read', { url: '/api/litkb/themes/read?id=t-00000000' })
assert.equal(missing.code, 404)

const read = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.equal(read.code, 200)
assert.equal(read.data.facetChains.length, 2)
assert.equal(read.data.papers.length, 0)
assert.equal(read.data.draft, null)

const preview = await call('/api/litkb/themes/match', { method: 'POST', body: { id: themeId } })
assert.equal(preview.code, 200)
assert.equal(preview.data.results.length, 2)
assert.ok(preview.data.papers.length >= 1)
assert.ok(preview.data.results[0].hits.every((hit) => /^q-[0-9a-f]{8}$/.test(hit.evidenceId)))

const jobStart = await call('/api/litkb/themes/chain', { method: 'POST', body: { id: themeId } })
assert.equal(jobStart.code, 200)
const job = await waitJob(jobStart.data.job.id)
assert.equal(job.status, 'done')
assert.ok(job.created >= 2, '两条细分描述都应生成草稿')
assert.equal(job.failed, 0)

const afterChain = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.equal(afterChain.data.facetChains[0].chain.status, 'draft')
assert.ok(afterChain.data.papers.some((row) => row.paperId === 'p-r1'))
assert.ok(afterChain.data.stats.drafts >= 2)
assert.equal(afterChain.data.stats.gaps, 0)

const review = await call('/api/litkb/chains/review', { url: '/api/litkb/chains/review?origin=topic' })
assert.equal(review.code, 200)
assert.ok(review.data.chains.length >= 2)
assert.ok(review.data.chains.every((chain) => chain.origin === 'topic'))
assert.ok(review.data.chains[0].themeTitle === '视盘分割综述')
const otherReview = await call('/api/litkb/chains/review')
assert.ok(otherReview.data.chains.length >= review.data.chains.length)

const explore = await call('/api/litkb/themes/explore', { method: 'POST', body: { id: themeId } })
assert.equal(explore.code, 200)
assert.ok(explore.data.match.results.length >= 2)
const exploreJob = await waitJob(explore.data.job.id)
assert.equal(exploreJob.status, 'done')
assert.ok(exploreJob.created >= 2)
assert.match(exploreJob.items[0].chainId, /^c-/)

const excepted = await call('/api/litkb/themes/papers', {
  method: 'POST',
  body: { id: themeId, paperId: 'p-r1', action: 'exclude' },
})
assert.equal(excepted.code, 200)
assert.ok(!excepted.data.papers.some((row) => row.paperId === 'p-r1'))
const restored = await call('/api/litkb/themes/papers', {
  method: 'POST',
  body: { id: themeId, paperId: 'p-r1', action: 'restore' },
})
assert.ok(restored.data.papers.some((row) => row.paperId === 'p-r1'))

const emptySummary = await call('/api/litkb/themes/summary', { method: 'POST', body: { id: themeId } })
assert.equal(emptySummary.code, 200)
assert.equal(emptySummary.data.summary.text, '')

const accept = await call('/api/litkb/chains/review', {
  method: 'POST',
  body: { id: afterChain.data.facetChains[0].chain.id, action: 'accept' },
})
assert.equal(accept.code, 200)

const summary = await call('/api/litkb/themes/summary', { method: 'POST', body: { id: themeId } })
assert.ok(summary.data.summary.text.includes('极坐标变换'))
const manual = await call('/api/litkb/themes/summary', { method: 'POST', body: { id: themeId, text: '手写结论' } })
assert.equal(manual.data.summary.text, '手写结论')
const manualRead = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.equal(manualRead.data.theme.summary.text, '手写结论')

const outlineDry = await call('/api/litkb/themes/outline', { method: 'POST', body: { id: themeId } })
assert.equal(outlineDry.code, 200)
assert.ok(outlineDry.data.markdown.startsWith('# 视盘分割综述'))
assert.equal(outlineDry.data.draft, null)
assert.ok(outlineDry.data.missing.length >= 1)
assert.ok(outlineDry.data.warnings.length >= 1)

const outlineNew = await call('/api/litkb/themes/outline', { method: 'POST', body: { id: themeId, mode: 'new' } })
assert.ok(outlineNew.data.draft && outlineNew.data.draft.id)
assert.ok(outlineNew.data.draft.chars > 0)
assert.ok(outlineNew.data.markdown.includes('[[p-r1#^q-11112222|'))
const draftId = outlineNew.data.draft.id

const outlineAppend = await call('/api/litkb/themes/outline', { method: 'POST', body: { id: themeId, mode: 'append' } })
assert.equal(outlineAppend.data.draft.id, draftId)
assert.ok(outlineAppend.data.draft.chars > outlineNew.data.draft.chars)

const outlineReplace = await call('/api/litkb/themes/outline', {
  method: 'POST',
  body: { id: themeId, mode: 'replace' },
})
assert.equal(outlineReplace.data.draft.id, draftId)
assert.equal(outlineReplace.data.draft.chars, outlineNew.data.draft.chars)

const afterOutline = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.equal(afterOutline.data.theme.draftId, draftId)
assert.ok(afterOutline.data.draft.citations >= 1)

const suggest = await call('/api/litkb/themes/suggest', { method: 'POST', body: { title: '多模态医学影像' } })
assert.equal(suggest.data.source, 'template')
assert.equal(suggest.data.facets.length, 5)
const suggestEmpty = await call('/api/litkb/themes/suggest', { method: 'POST', body: {} })
assert.equal(suggestEmpty.code, 422)

const secondExplore = await call('/api/litkb/themes/explore', { method: 'POST', body: { id: themeId } })
assert.equal(secondExplore.code, 200)
await waitJob(secondExplore.data.job.id)
const beforeBatch = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
const draftIds = beforeBatch.data.chains.filter((chain) => chain.status === 'draft').map((chain) => chain.id)
assert.ok(draftIds.length >= 2)
const batch = await call('/api/litkb/chains/review/batch', {
  method: 'POST',
  body: { ids: draftIds, action: 'accept' },
})
assert.equal(batch.code, 200)
assert.equal(batch.data.succeeded, draftIds.length)

const afterBatch = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.ok(afterBatch.data.summaryState)
assert.equal(afterBatch.data.summaryState.stale, true, '新增确认链后结论应过期')

const thirdExplore = await call('/api/litkb/themes/explore', { method: 'POST', body: { id: themeId } })
await waitJob(thirdExplore.data.job.id)
const beforeReject = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
const rejectIds = beforeReject.data.chains.filter((chain) => chain.status === 'draft').map((chain) => chain.id)
assert.ok(rejectIds.length >= 1)
const rejectBatch = await call('/api/litkb/chains/review/batch', {
  method: 'POST',
  body: { ids: rejectIds, action: 'reject' },
})
assert.equal(rejectBatch.code, 200)
assert.equal(rejectBatch.data.failed, 0)
const emptyBatch = await call('/api/litkb/chains/review/batch', { method: 'POST', body: { ids: [], action: 'accept' } })
assert.equal(emptyBatch.code, 400)

const confirmedBase = (
  await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
).data.chains.find((chain) => chain.status === 'confirmed')
const duplicated = await call('/api/litkb/chains/save', {
  method: 'POST',
  body: {
    ...confirmedBase,
    id: undefined,
    title: '重复链',
    createdAt: undefined,
    updatedAt: undefined,
    review: undefined,
  },
})
assert.equal(duplicated.code, 200)
const dedupe = await call('/api/litkb/chains/dedupe', { method: 'POST', body: { themeId } })
assert.equal(dedupe.code, 200)
assert.ok(dedupe.data.groups >= 1)
assert.ok(dedupe.data.removed >= 1)

const primary = (
  await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
).data.chains.find((chain) => chain.status === 'confirmed')
const supplement = await call('/api/litkb/chains/save', {
  method: 'POST',
  body: {
    ...primary,
    id: undefined,
    status: 'draft',
    title: '补充草稿',
    provenance: { ...primary.provenance, previousChainId: primary.id },
    createdAt: undefined,
    updatedAt: undefined,
    review: undefined,
  },
})
assert.equal(supplement.code, 200)
const mergedAccept = await call('/api/litkb/chains/review', {
  method: 'POST',
  body: { id: supplement.data.chain.id, action: 'accept' },
})
assert.equal(mergedAccept.code, 200)
assert.equal(mergedAccept.data.merged, true)
const afterMerge = await call('/api/litkb/themes/read', { url: `/api/litkb/themes/read?id=${themeId}` })
assert.ok(!afterMerge.data.chains.some((chain) => chain.id === supplement.data.chain.id))

/* ---------- 方向分析：无模型时任务失败、链生成 422 ---------- */
const included = await call('/api/litkb/themes/papers', {
  method: 'POST',
  body: { id: themeId, paperId: 'p-r1', action: 'include' },
})
assert.equal(included.code, 200)
const analysisStart = await call('/api/litkb/themes/analyze', { method: 'POST', body: { id: themeId } })
assert.equal(analysisStart.code, 202)
assert.ok(analysisStart.data.job.total >= 1)
await new Promise((resolve) => setTimeout(resolve, 40))
const analysisGet = await call('/api/litkb/themes/analysis', { url: `/api/litkb/themes/analysis?id=${themeId}` })
assert.equal(analysisGet.code, 200)
assert.equal(analysisGet.data.analysis, null)
assert.equal(analysisGet.data.job.status, 'failed')
const noAnalysisChain = await call('/api/litkb/themes/analysis/chain', {
  method: 'POST',
  body: { id: themeId, facetKey: 'f1', viewpointId: 'v1' },
})
assert.equal(noAnalysisChain.code, 422)
assert.equal(noAnalysisChain.data.code, 'no_analysis')

const retryWithoutAnalysis = await call('/api/litkb/themes/analyze', {
  method: 'POST',
  body: { id: themeId, retryFailed: true },
})
assert.equal(retryWithoutAnalysis.code, 422)
assert.equal(retryWithoutAnalysis.data.code, 'no_analysis')

const deleted = await call('/api/litkb/themes/delete', { method: 'POST', body: { id: themeId } })
assert.equal(deleted.code, 200)
assert.ok(deleted.data.chainsKept >= 1)
const afterDelete = await call('/api/litkb/themes')
assert.equal(afterDelete.data.themes.length, 0)

console.log('  ✓ 研究 CRUD / 校验 / 404')
console.log('  ✓ 匹配预览 / 生成任务 / 论文增删')
console.log('  ✓ 审核按 origin=topic 过滤')
console.log('  ✓ 结论 / 提纲三种写入模式 / 删除保留链')
console.log('\n4 passed')
