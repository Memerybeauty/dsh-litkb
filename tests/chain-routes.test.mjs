/**
 * P4.10 论证链 HTTP 路由：提议、保存、读取、插入、删除。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-chain-http-'))

const { ensureLibrary, upsert, PATHS } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')

ensureLibrary()
const record = {
  id: 'p-r1', citekey: 'p-r1', title: '极坐标视盘分割', authors: 'Wu B.', year: 2024,
  venue: 'Journal', doi: '', type: '学术期刊', topics: [], status: '精读',
  file: 'p-r1.pdf', pages: 5, chars: 1000, quality: 0.9, added: new Date().toISOString(),
}
upsert(record)
writeCard({
  paperId: record.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '提出极坐标方法。', evidence: [] }],
  evidence: [
    { id: 'q-e1e1e1e1', page: 5, block: 'b-1', quote: 'Polar transform improves the optic disc boundary dice.', kind: 'author_claim', before: '', after: '' },
    { id: 'q-e2e2e2e2', page: 3, block: 'b-2', quote: 'The evaluation is limited to a single public dataset.', kind: 'author_claim', before: '', after: '' },
  ],
  annotations: [], warnings: [], statusHistory: [],
}, record)
writeFileSync(join(PATHS.blocks, 'p-r1.json'), JSON.stringify({
  schema: 1, parser: 'fake', numPages: 5,
  pages: [{ page: 4, width: 1000, height: 1000, blocks: [{ id: 'b-200', role: 'paragraph', section: 'results', bbox: [0, 0, 1, 1], text: 'Polar transform reduces the cup-to-disc ratio error on REFUGE.' }] }],
}), 'utf8')
writeFileSync(join(PATHS.deepread, 'p-r1.json'), JSON.stringify({
  paperId: 'p-r1', markdown: '', numbers: [], evidence: [],
  sections: [{
    key: 'conclusion', title: '结论', index: 7,
    markdown: '极坐标变换改善视盘边界 [[p-r1#^q-e1e1e1e1|p.5]]。只在单一数据集上验证 [[p-r1#^q-e2e2e2e2|p.3]]。',
  }],
}), 'utf8')

const autoRecord = {
  id: 'p-r2', citekey: 'p-r2', title: '自动建链测试论文', authors: 'Li C.', year: 2025,
  venue: 'Journal', doi: '', type: '学术期刊', topics: ['分割'], status: '精读',
  file: 'p-r2.pdf', pages: 4, chars: 900, quality: 0.9, added: new Date().toISOString(),
}
upsert(autoRecord)
writeCard({
  paperId: autoRecord.id, status: 'ready', model: 'fake', generatedAt: new Date().toISOString(),
  sections: [{ key: 'oneLine', title: '一句话', text: '自动建链。', evidence: [] }],
  evidence: [
    { id: 'q-a1a1a1a1', page: 4, block: 'b-3', quote: 'The proposed polar method improves boundary Dice by 0.04.', kind: 'author_claim', before: '', after: '' },
  ],
  annotations: [], warnings: [], statusHistory: [],
}, autoRecord)
writeFileSync(join(PATHS.deepread, 'p-r2.json'), JSON.stringify({
  paperId: 'p-r2', markdown: '', numbers: [], evidence: [],
  sections: [{
    key: 'conclusion', title: '结论', index: 7,
    markdown: '极坐标方法把边界 Dice 提高了 0.04 [[p-r2#^q-a1a1a1a1|p.4]]。',
  }],
}), 'utf8')

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
    headers: null,
    body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(body) { this.body = String(body || '') },
  }
}

async function call(path, { method = 'GET', body = null, url = null } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `route ${path}`)
  const res = makeRes()
  await route.handler(makeReq({ method, url: url || path, body }), res)
  return { code: res.code, data: JSON.parse(res.body) }
}

let passed = 0
const pending = []
function test(name, fn) { pending.push({ name, fn }) }

test('路由已注册', () => {
  for (const path of ['/api/litkb/chains', '/api/litkb/chains/read', '/api/litkb/chains/claims',
    '/api/litkb/chains/propose', '/api/litkb/chains/save', '/api/litkb/chains/delete',
    '/api/litkb/chains/insert', '/api/litkb/chains/auto/run', '/api/litkb/chains/auto/jobs',
    '/api/litkb/chains/review']) {
    assert.ok(routes.some((route) => route.path === path), path)
  }
})

test('论点候选 + 提议 + 保存 + 读取', async () => {
  const claims = await call('/api/litkb/chains/claims', { url: '/api/litkb/chains/claims?paperId=p-r1' })
  assert.equal(claims.code, 200)
  assert.ok(claims.data.claims.length >= 1)
  const target = claims.data.claims.find((item) => item.text.includes('单一数据集')) || claims.data.claims[0]

  const proposal = await call('/api/litkb/chains/propose', {
    method: 'POST', body: { mode: 'claim', paperId: 'p-r1', claim: target.text },
  })
  assert.equal(proposal.code, 200)
  assert.ok(proposal.data.nodes.length >= 1)
  assert.ok([3, 5].includes(proposal.data.nodes[0].page))

  const saved = await call('/api/litkb/chains/save', {
    method: 'POST',
    body: {
      claim: { text: target.text, paperId: 'p-r1', sectionKey: 'conclusion', source: 'deepread' },
      origin: 'claim', question: '极坐标是否改善边界？', nodes: proposal.data.nodes,
    },
  })
  assert.equal(saved.code, 200)
  assert.match(saved.data.chain.id, /^c-[a-z0-9]{8}$/)
  assert.equal(saved.data.chain.nodes.length, proposal.data.nodes.length)

  const list = await call('/api/litkb/chains')
  assert.equal(list.data.chains.length, 1)
  const read = await call('/api/litkb/chains/read', { url: '/api/litkb/chains/read?id=' + saved.data.chain.id })
  assert.equal(read.data.chain.claim.text, target.text)
  assert.equal(read.data.chain.nodes[0].stale, false)
})

test('自动建链任务 + 审核通过/拒绝', async () => {
  const started = await call('/api/litkb/chains/auto/run', {
    method: 'POST', body: { paperIds: ['p-r2'], scope: 'paper' },
  })
  assert.equal(started.code, 200)
  assert.ok(started.data.job.id)
  let job = started.data.job
  for (let i = 0; i < 100 && job.status !== 'done'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const poll = await call('/api/litkb/chains/auto/jobs', { url: '/api/litkb/chains/auto/jobs?id=' + job.id })
    job = poll.data.job
  }
  assert.equal(job.status, 'done')
  assert.ok(job.created >= 1, '应至少生成 1 条 draft')

  const review = await call('/api/litkb/chains/review')
  assert.equal(review.code, 200)
  assert.ok(review.data.chains.some((chain) => chain.origin === 'auto' && chain.status === 'draft'))
  const draft = review.data.chains.find((chain) => chain.claim?.paperId === 'p-r2')
  assert.ok(draft)
  assert.equal(draft.confidence > 0, true)

  const accepted = await call('/api/litkb/chains/review', {
    method: 'POST', body: { action: 'accept', id: draft.id },
  })
  assert.equal(accepted.code, 200)
  assert.equal(accepted.data.chain.status, 'confirmed')
  const afterAccept = await call('/api/litkb/chains/review')
  assert.ok(!afterAccept.data.chains.some((chain) => chain.id === draft.id))

  const second = await call('/api/litkb/chains/auto/run', {
    method: 'POST', body: { paperIds: ['p-r2'], scope: 'paper' },
  })
  let job2 = second.data.job
  for (let i = 0; i < 100 && job2.status !== 'done'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const poll = await call('/api/litkb/chains/auto/jobs', { url: '/api/litkb/chains/auto/jobs?id=' + job2.id })
    job2 = poll.data.job
  }
  assert.equal(job2.created, 0, '重跑不覆盖/重复已确认链')
  const rejected = await call('/api/litkb/chains/review', {
    method: 'POST', body: { action: 'reject', id: accepted.data.chain.id },
  })
  assert.equal(rejected.code, 200)
  const gone = await call('/api/litkb/chains/read', { url: '/api/litkb/chains/read?id=' + accepted.data.chain.id })
  assert.equal(gone.code, 404)
})

test('跨论文自动链任务：mode=cross 可运行', async () => {
  const started = await call('/api/litkb/chains/auto/run', {
    method: 'POST', body: { mode: 'cross', scope: 'library', paperIds: ['p-r1', 'p-r2'] },
  })
  assert.equal(started.code, 200)
  assert.equal(started.data.job.mode, 'cross')
  let job = started.data.job
  for (let i = 0; i < 100 && job.status !== 'done'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const poll = await call('/api/litkb/chains/auto/jobs', { url: '/api/litkb/chains/auto/jobs?id=' + job.id })
    job = poll.data.job
  }
  assert.equal(job.status, 'done')
  assert.ok(job.created >= 0)
})

test('证据链图 + 布局 + 图引擎静态文件', async () => {
  const graph = await call('/api/litkb/chains/graph')
  assert.equal(graph.code, 200)
  assert.ok(graph.data.graph.nodes.some((node) => node.data.kind === 'claim'))
  assert.ok(graph.data.graph.edges.length >= 1)
  assert.ok(graph.data.graph.stats.chains >= 1)

  const layout = await call('/api/litkb/chains/layout', {
    method: 'POST', body: { positions: { 'claim:test': { x: 10, y: 20 }, 'bad id!': { x: 1, y: 2 } } },
  })
  assert.equal(layout.code, 200)
  assert.equal(layout.data.count, 1)

  const route = routes.find((item) => item.path === '/api/litkb/vendor/cytoscape.js')
  const res = makeRes()
  await route.handler(makeReq({ method: 'GET', url: '/api/litkb/vendor/cytoscape.js' }), res)
  assert.equal(res.code, 200)
  assert.ok(String(res.body).includes('cytoscape'))
  assert.ok(String(res.body).length > 100000)
})

test('原文段落建链：propose mode=block 自动补证据', async () => {
  const proposal = await call('/api/litkb/chains/propose', {
    method: 'POST', body: { mode: 'block', paperId: 'p-r1', blockId: 'b-200' },
  })
  assert.equal(proposal.code, 200)
  assert.equal(proposal.data.origin, 'block')
  assert.equal(proposal.data.nodes.length, 1)
  assert.equal(proposal.data.nodes[0].block, 'b-200')
  assert.equal(proposal.data.nodes[0].page, 4)
  assert.ok(proposal.data.claim.includes('Polar transform'))
  const saved = await call('/api/litkb/chains/save', {
    method: 'POST',
    body: { claim: { text: proposal.data.claim, paperId: 'p-r1', source: 'parse' }, origin: 'block', nodes: proposal.data.nodes },
  })
  assert.equal(saved.code, 200)
  const inserted = await call('/api/litkb/chains/insert', { method: 'POST', body: { id: saved.data.chain.id } })
  assert.equal(inserted.code, 200)
  assert.ok(inserted.data.text.includes('[[p-r1#^' + proposal.data.nodes[0].evidenceId))

  const appended = await call('/api/litkb/chains/insert', { method: 'POST', body: { id: saved.data.chain.id, append: true } })
  assert.equal(appended.code, 200)
  assert.ok(appended.data.draft?.id, 'append=true 自动新建文稿')
  const draftRead = await call('/api/litkb/drafts/read', { url: '/api/litkb/drafts/read?id=' + appended.data.draft.id })
  assert.ok(draftRead.data.draft.body.includes('[[p-r1#^' + proposal.data.nodes[0].evidenceId))
  const appendedAgain = await call('/api/litkb/chains/insert', {
    method: 'POST', body: { id: saved.data.chain.id, append: true, draftId: appended.data.draft.id },
  })
  assert.equal(appendedAgain.data.draft.id, appended.data.draft.id)
  await call('/api/litkb/chains/delete', { method: 'POST', body: { id: saved.data.chain.id } })
})

test('空论点 422；插入带引用；删除后 404', async () => {
  const bad = await call('/api/litkb/chains/save', { method: 'POST', body: { claim: { text: ' ' }, nodes: [] } })
  assert.equal(bad.code, 422)
  assert.equal(bad.data.code, 'empty_claim')

  const list = await call('/api/litkb/chains')
  const id = list.data.chains[0].id
  const inserted = await call('/api/litkb/chains/insert', { method: 'POST', body: { id } })
  assert.equal(inserted.code, 200)
  assert.ok(inserted.data.text.includes('[[p-r1#^q-e2e2e2e2|Wu B. 2024, p.3]]'))
  assert.ok(inserted.data.text.includes('需要限定的条件是'))

  const removed = await call('/api/litkb/chains/delete', { method: 'POST', body: { id } })
  assert.equal(removed.code, 200)
  const gone = await call('/api/litkb/chains/read', { url: '/api/litkb/chains/read?id=' + id })
  assert.equal(gone.code, 404)
})

for (const item of pending) {
  await item.fn()
  console.log('  ✓', item.name)
  passed += 1
}
console.log(`\n${passed} passed`)
