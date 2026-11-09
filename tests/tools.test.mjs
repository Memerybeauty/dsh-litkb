/** P4.11 Agent 工具：检索/回答/提案/确认保存/引用。 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.LITKB_LIBRARY = mkdtempSync(join(tmpdir(), 'dsh-litkb-tools-'))
const { ensureLibrary, upsert } = await import('../lib/library.js')
const { writeCard } = await import('../lib/cards.js')
const { saveChain, readChain } = await import('../lib/chains.js')
const { saveTheme } = await import('../lib/themes.js')
ensureLibrary()
const record = {
  id: 'p-t1',
  citekey: 'p-t1',
  title: '极坐标视盘分割',
  authors: 'Wu B.',
  year: 2024,
  venue: 'Journal',
  doi: '',
  type: '学术期刊',
  topics: ['分割'],
  status: '精读',
  file: 'p-t1.pdf',
  pages: 5,
  chars: 900,
  quality: 0.9,
  added: new Date().toISOString(),
}
upsert(record)
writeCard(
  {
    paperId: record.id,
    status: 'ready',
    model: 'fake',
    generatedAt: new Date().toISOString(),
    sections: [{ key: 'oneLine', title: '一句话', text: '方法。', evidence: [] }],
    evidence: [
      {
        id: 'q-a1a1a1a1',
        page: 5,
        block: 'b-1',
        quote: 'Polar transform improves optic disc boundary.',
        kind: 'author_claim',
      },
    ],
    annotations: [],
    warnings: [],
    statusHistory: [],
  },
  record,
)
const existing = saveChain({
  title: '极坐标改善边界',
  claim: { text: '极坐标改善视盘边界。', paperId: record.id, source: 'manual' },
  origin: 'claim',
  status: 'confirmed',
  nodes: [
    {
      paperId: record.id,
      evidenceId: 'q-a1a1a1a1',
      page: 5,
      block: 'b-1',
      quote: 'Polar transform improves optic disc boundary.',
      relation: 'supports',
    },
  ],
})

const tools = []
const registry = {
  register(definition) {
    tools.push(definition)
    return () => {}
  },
}
const server = await import('../lib/index.js')
server.apply({
  webServer: { register() {} },
  logger: { info() {}, warn() {} },
  get(name) {
    return name === 'tools' ? registry : undefined
  },
})

assert.equal(tools.length, 12)
const names = tools.map((tool) => tool.name)
for (const name of [
  'lit_search',
  'lit_answer',
  'lit_chain_get',
  'lit_chain_propose',
  'lit_chain_save',
  'lit_card',
  'lit_cite',
  'lit_graph',
  'lit_blocks',
  'lit_theme_list',
  'lit_theme_match',
  'lit_theme_chain',
]) {
  assert.ok(names.includes(name), name)
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool.description)
  assert.ok(tool.parameters)
  assert.ok(tool.output?.schema)
  assert.equal(typeof tool.execute, 'function')
}

const search = await tools.find((t) => t.name === 'lit_search').execute({ query: '极坐标 边界' }, {})
assert.equal(search.ok, true)
assert.ok(search.chains.length >= 1)
assert.ok(search.evidence.some((item) => item.evidenceId === 'q-a1a1a1a1'))

const answer = await tools.find((t) => t.name === 'lit_answer').execute({ question: '极坐标 边界' }, {})
assert.equal(answer.ok, true)
assert.ok(answer.answer.includes('[[p-t1#^q-a1a1a1a1|'))
assert.ok(answer.citations.some((item) => item.evidenceId === 'q-a1a1a1a1'))
const answerBlock = tools.find((t) => t.name === 'lit_answer').output.render({}, answer)
assert.ok(answerBlock[0].text.includes('引用：'))

const getChain = await tools.find((t) => t.name === 'lit_chain_get').execute({ id: existing.id }, {})
assert.equal(getChain.ok, true)
assert.equal(getChain.chain.id, existing.id)

const cite = await tools
  .find((t) => t.name === 'lit_cite')
  .execute({ paperId: record.id, evidenceId: 'q-a1a1a1a1' }, {})
assert.equal(cite.ok, true)
assert.match(cite.citation.markdown, /\[\[p-t1#\^q-a1a1a1a1\|/)

const card = await tools.find((t) => t.name === 'lit_card').execute({ paperId: record.id }, {})
assert.equal(card.ok, true)
assert.equal(card.evidence[0].id, 'q-a1a1a1a1')

const graphTool = await tools.find((t) => t.name === 'lit_graph').execute({ paperId: record.id }, {})
assert.equal(graphTool.ok, true)
assert.equal(graphTool.paper.id, record.id)

const blocksTool = await tools.find((t) => t.name === 'lit_blocks').execute({ paperId: record.id }, {})
assert.equal(blocksTool.ok, false)
assert.equal(blocksTool.code, 'not_found')

const proposed = await tools
  .find((t) => t.name === 'lit_chain_propose')
  .execute({ mode: 'evidence', evidenceIds: ['q-a1a1a1a1'], claim: 'Polar transform improves the boundary.' }, {})
assert.equal(proposed.ok, true)
assert.ok(proposed.chain.nodes.length >= 1)

const saveTool = tools.find((t) => t.name === 'lit_chain_save')
const needsConfirm = await saveTool.execute(
  {
    confirm: false,
    chain: {
      claim: { text: 'Agent 新建链。', paperId: record.id },
      nodes: [{ paperId: record.id, evidenceId: 'q-a1a1a1a1', page: 5 }],
    },
  },
  {},
)
assert.equal(needsConfirm.ok, false)
assert.equal(needsConfirm.requiresConfirmation, true)

const saved = await saveTool.execute(
  {
    confirm: true,
    chain: {
      claim: { text: 'Agent 新建链。', paperId: record.id },
      nodes: [{ paperId: record.id, evidenceId: 'q-a1a1a1a1', page: 5 }],
    },
  },
  {},
)
assert.equal(saved.ok, true)
assert.equal(saved.chain.status, 'confirmed')
assert.ok(readChain(saved.chain.id))

const theme = saveTheme({
  title: '极坐标研究',
  facets: [{ title: '极坐标边界', description: 'polar transform', keywords: ['polar'] }],
})
const themeList = await tools.find((t) => t.name === 'lit_theme_list').execute({}, {})
assert.equal(themeList.ok, true)
assert.ok(themeList.themes.some((item) => item.id === theme.id))

const themeMatch = await tools.find((t) => t.name === 'lit_theme_match').execute({ themeId: theme.id }, {})
assert.equal(themeMatch.ok, true)
assert.ok(themeMatch.results[0].hits.some((hit) => hit.evidenceId === 'q-a1a1a1a1'))

const themeChainTool = tools.find((t) => t.name === 'lit_theme_chain')
const themePreview = await themeChainTool.execute({ themeId: theme.id }, {})
assert.equal(themePreview.ok, true)
assert.equal(themePreview.requiresConfirm, true)
assert.equal(themePreview.preview.drafts.length, 1)
const themeCreated = await themeChainTool.execute({ themeId: theme.id, confirm: true }, {})
assert.equal(themeCreated.ok, true)
assert.ok(themeCreated.created.length >= 1)
assert.ok(readChain(themeCreated.created[0].chainId))
assert.equal(readChain(themeCreated.created[0].chainId).origin, 'topic')

console.log('  ✓ 12 个 lit_* 工具注册与 schema')
console.log('  ✓ 检索/回答/取链/引用/卡片')
console.log('  ✓ 保存必须 confirm=true')
console.log('\n3 passed')
