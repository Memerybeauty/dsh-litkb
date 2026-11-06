/**
 * P4.11 Agent 工具：读优先，写工具必须显式 confirm。
 * 所有结果返回结构化 JSON；引用永远来自库内 q-id。
 */
import { readCard } from './cards.js'
import { findEvidence } from './drafts.js'
import { proposeChain, readChain, saveChain } from './chains.js'
import { searchLibrary } from './search.js'
import { answerQuestion } from './answer.js'
import { recordSearch } from './search-history.js'
import { readGraph } from './graph.js'
import { readBlocks } from './blocks.js'

const OUTPUT = {
  type: 'object',
  additionalProperties: true,
}

const text = (value) => [{
  type: 'text',
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
}]

function result(value) {
  return value && typeof value === 'object' ? value : { ok: true, value }
}

function fail(message, code = 'error') {
  return { ok: false, code, error: String(message || 'error') }
}

function citationOf(hit) {
  if (!hit) return null
  const record = hit.record || {}
  const evidence = hit.evidence || {}
  const author = String(record.authors || '').split(/[,，;；、]/)[0].trim() || 'Anon'
  const year = record.year || ''
  return {
    paperId: record.id || hit.paperId,
    title: record.title || hit.title || '',
    authors: record.authors || '',
    year,
    page: evidence.page || hit.page,
    block: evidence.block || hit.block || '',
    evidenceId: evidence.id || hit.evidenceId,
    quote: evidence.quote || hit.quote || '',
    markdown: `[[${record.id || hit.paperId}#^${evidence.id || hit.evidenceId}|${author} ${year}, p.${evidence.page || hit.page}]]`,
  }
}

function definitions(ctx) {
  return [
    {
      name: 'lit_search',
      description: '按关键词/问题检索本地文献库，返回按链分组的命中证据（含 q-id、论文、页码、引文）。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          query: { type: 'string', description: '检索词或问题' },
          limit: { type: 'number', description: '返回上限，默认 10' },
          paperId: { type: 'string', description: '只搜某篇论文' },
          tag: { type: 'string', description: '只搜某个标签' },
          yearFrom: { type: 'number', description: '起始年份' },
          yearTo: { type: 'number', description: '结束年份' },
        },
        required: ['query'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        const q = String(args?.query || '').trim()
        if (!q) return fail('query 不能为空', 'empty_query')
        try {
          const filters = {
            paperId: String(args?.paperId || ''),
            tag: String(args?.tag || ''),
            yearFrom: args?.yearFrom || '',
            yearTo: args?.yearTo || '',
          }
          const data = searchLibrary(q, { ...filters, limit: Number(args?.limit) || 10 })
          recordSearch({
            q, mode: 'evidence', filters, took: data.took,
            chains: data.chains.map((chain) => chain.id),
            evidence: data.evidence.map((item) => item.evidenceId),
          })
          return result({ ok: true, ...data })
        } catch (error) {
          return fail(error?.message || error)
        }
      },
    },
    {
      name: 'lit_answer',
      description: '先检索证据链，再生成带 q-id 引用的答案；返回 citations + chains + trace，供对话直接引用。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          question: { type: 'string', description: '要回答的问题' },
          limit: { type: 'number', description: '检索上限，默认 10' },
          paperId: { type: 'string', description: '只搜某篇论文' },
          tag: { type: 'string', description: '只搜某个标签' },
          yearFrom: { type: 'number', description: '起始年份' },
          yearTo: { type: 'number', description: '结束年份' },
        },
        required: ['question'],
      },
      output: {
        schema: OUTPUT,
        render: (_args, value) => {
          if (value?.answer) {
            const cites = (value.citations || []).slice(0, 10)
              .map((item) => `- p.${item.page} ${item.title || item.paperId} (${item.evidenceId})`).join('\n')
            return text(`${value.answer}${cites ? `\n\n引用：\n${cites}` : ''}`)
          }
          return text(value)
        },
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => true,
      async execute(args) {
        const question = String(args?.question || '').trim()
        if (!question) return fail('question 不能为空', 'empty_question')
        try {
          const filters = {
            paperId: String(args?.paperId || ''),
            tag: String(args?.tag || ''),
            yearFrom: args?.yearFrom || '',
            yearTo: args?.yearTo || '',
          }
          const data = await answerQuestion({
            ctx,
            question,
            limit: Number(args?.limit) || 10,
            filters,
          })
          recordSearch({
            q: question, mode: data.mode || 'chain-answer', filters, took: data.took,
            chains: (data.chains || []).map((chain) => chain.id),
            evidence: (data.citations || []).map((item) => item.evidenceId),
            citations: (data.citations || []).length,
          })
          return result({ ok: true, ...data })
        } catch (error) {
          return fail(error?.message || error, error?.code || 'error')
        }
      },
    },
    {
      name: 'lit_chain_get',
      description: '读取一条证据链（含 claim、节点、q-id、页码）。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { id: { type: 'string', description: '链 id，例如 c-1a2b3c4d' } },
        required: ['id'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        const chain = readChain(String(args?.id || ''))
        if (!chain) return fail('链不存在', 'not_found')
        return result({ ok: true, chain })
      },
    },
    {
      name: 'lit_chain_propose',
      description: '生成一条证据链草稿，不保存。mode=claim/evidence/question/block；节点只从库内 q-id 取。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['claim', 'evidence', 'question', 'block'] },
          paperId: { type: 'string' },
          blockId: { type: 'string' },
          claim: { type: 'string' },
          question: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          pages: { type: 'array', items: { type: 'number' } },
        },
        required: ['mode'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        try {
          const data = proposeChain({
            mode: ['claim', 'evidence', 'question', 'block'].includes(args?.mode) ? args.mode : 'claim',
            paperId: String(args?.paperId || ''),
            blockId: String(args?.blockId || ''),
            claim: String(args?.claim || ''),
            question: String(args?.question || ''),
            evidenceIds: Array.isArray(args?.evidenceIds) ? args.evidenceIds : [],
            pages: Array.isArray(args?.pages) ? args.pages : [],
          })
          return result({ ok: true, chain: data })
        } catch (error) {
          return fail(error?.message || error, error?.code || 'error')
        }
      },
    },
    {
      name: 'lit_chain_save',
      description: '保存一条已确认的证据链。必须传 confirm=true；未确认时只返回确认提示，不写入。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          confirm: { type: 'boolean', description: '用户已确认才传 true' },
          chain: {
            type: 'object',
            description: '链对象：claim.text、nodes[]（至少一个 q-id）、title 可选',
            additionalProperties: true,
          },
        },
        required: ['confirm', 'chain'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => false,
      async execute(args) {
        if (args?.confirm !== true) {
          return { ok: false, requiresConfirmation: true, error: '需要用户确认后才能保存证据链' }
        }
        try {
          const saved = saveChain({
            ...(args?.chain || {}),
            origin: (args?.chain?.origin === 'auto' ? 'auto' : 'manual'),
            status: 'confirmed',
            review: { action: 'agent-saved', at: new Date().toISOString() },
          })
          return result({ ok: true, chain: saved })
        } catch (error) {
          return fail(error?.message || error, error?.code || 'error')
        }
      },
    },
    {
      name: 'lit_graph',
      description: '读取概念图谱：论文/概念/边；可按论文过滤，返回邻居概念与边。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          paperId: { type: 'string', description: '只取这篇论文及其概念邻居' },
          limit: { type: 'number', description: '最多返回概念/边数量，默认 40' },
        },
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        try {
          const graph = readGraph()
          const limit = Math.max(1, Math.min(120, Number(args?.limit) || 40))
          const paperId = String(args?.paperId || '')
          if (!paperId) {
            return result({
              ok: true,
              meta: graph.meta,
              topics: graph.topics,
              concepts: graph.nodes.filter((node) => node.type === 'concept').slice(0, limit),
            })
          }
          const paper = graph.nodes.find((node) => node.id === paperId)
          if (!paper) return fail('论文不在图谱中（可能没有卡片/概念）', 'not_found')
          const edges = graph.edges.filter((edge) => edge.paper === paperId || edge.source === paperId || edge.target === paperId).slice(0, limit)
          const neighbors = graph.nodes.filter((node) => edges.some((edge) => edge.source === node.id || edge.target === node.id)).slice(0, limit)
          return result({ ok: true, paper, neighbors, edges })
        } catch (error) {
          return fail(error?.message || error)
        }
      },
    },
    {
      name: 'lit_blocks',
      description: '读取一篇论文的解析稿块（页码/角色/章节/bbox/文本），可按页或章节过滤。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          paperId: { type: 'string' },
          page: { type: 'number', description: '只看某页' },
          section: { type: 'string', description: '只看某章节' },
          limit: { type: 'number', description: '最多返回块数，默认 80' },
        },
        required: ['paperId'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        try {
          const doc = readBlocks(String(args?.paperId || ''))
          if (!doc) return fail('解析稿不存在', 'not_found')
          const pageFilter = Number(args?.page) || 0
          const sectionFilter = String(args?.section || '')
          const limit = Math.max(1, Math.min(200, Number(args?.limit) || 80))
          const blocks = []
          for (const page of doc.pages || []) {
            if (pageFilter && Number(page.page) !== pageFilter) continue
            for (const block of page.blocks || []) {
              if (sectionFilter && block.section !== sectionFilter) continue
              blocks.push({
                id: block.id, page: page.page, role: block.role, section: block.section || '',
                bbox: block.bbox, text: block.text || '',
              })
              if (blocks.length >= limit) break
            }
            if (blocks.length >= limit) break
          }
          return result({ ok: true, paperId: args.paperId, parser: doc.parser || '', numPages: doc.numPages || (doc.pages || []).length, blocks })
        } catch (error) {
          return fail(error?.message || error)
        }
      },
    },
    {
      name: 'lit_card',
      description: '读取一篇论文的七段卡与证据（q-id/页码/引文）。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: { paperId: { type: 'string' } },
        required: ['paperId'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        const card = readCard(String(args?.paperId || ''))
        if (!card) return fail('卡片不存在', 'not_found')
        return result({
          ok: true,
          paperId: card.paperId,
          status: card.status,
          sections: (card.sections || []).map((section) => ({ key: section.key, title: section.title, text: section.text })),
          evidence: (card.evidence || []).slice(0, 80).map((ev) => ({
            id: ev.id, page: ev.page, block: ev.block || '', quote: ev.quote || '', kind: ev.kind || '',
          })),
        })
      },
    },
    {
      name: 'lit_cite',
      description: '按 paperId + evidenceId 取一个带页码的引用块。只读。',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          paperId: { type: 'string' },
          evidenceId: { type: 'string' },
        },
        required: ['paperId', 'evidenceId'],
      },
      output: { schema: OUTPUT, render: (_args, value) => text(value) },
      isConcurrencySafe: () => true,
      async execute(args) {
        const hit = findEvidence(String(args?.paperId || ''), String(args?.evidenceId || ''))
        if (!hit) return fail('证据不存在', 'not_found')
        return result({ ok: true, citation: citationOf(hit) })
      },
    },
  ]
}

/** 注册到 DSH tools 服务；返回 disposer 列表。 */
export function registerAgentTools(ctx, tools) {
  const defs = definitions(ctx)
  return defs.map((definition) => tools.register(definition))
}

export const AGENT_TOOL_NAMES = [
  'lit_search', 'lit_answer', 'lit_chain_get', 'lit_chain_propose',
  'lit_chain_save', 'lit_card', 'lit_cite', 'lit_graph', 'lit_blocks',
]
