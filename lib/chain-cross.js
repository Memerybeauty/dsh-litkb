/**
 * P1 跨论文自动链：把不同论文里相近的 claim 聚成对比/矛盾/支持草稿。
 *
 * 原则：
 * - 只用库内 claim + q-id 证据，不调用模型也能跑；
 * - 关系先按线索词/数字差异判断，拿不准就标 compares；
 * - 产出 draft，进同一审核队列；
 * - 同 pair 的同一组 claim 不重复。
 */
import { readIndex } from './library.js'
import { readDeepRead } from './deepread.js'
import { readGraph } from './graph.js'
import { normalizeForMatch } from './evidence.js'
import { extractClaims, listChains, proposeFromClaim, shortText } from './chains.js'

const CJK_RUN = /[\u3400-\u9fff]+/g
const NEG = /未|没有|无法|不能|并不|相反|不一致|冲突|contradict|contrary|not\s|no\s/i
const LIMIT = /仅|只|限于|单一|单中心|小样本|样本量|不足|局[限部]|limited|single[- ]/i
const NUMBER = /\d+(?:\.\d+)?/g

export function claimTokens(text) {
  const value = String(text || '').toLowerCase()
  const out = new Set()
  for (const token of value.match(/[a-z0-9][a-z0-9._+-]*/g) || []) {
    if (token.length >= 2) out.add(token)
  }
  for (const run of value.match(CJK_RUN) || []) {
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2))
    if (run.length >= 2) out.add(run)
  }
  return out
}

export function claimSimilarity(a, b) {
  const left = claimTokens(a)
  const right = claimTokens(b)
  if (!left.size || !right.size) return 0
  let inter = 0
  for (const token of left) if (right.has(token)) inter += 1
  return inter / Math.max(1, left.size + right.size - inter)
}

function numbersOf(text) {
  return [...new Set(String(text || '').match(NUMBER) || [])]
}

export function crossRelation(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  const leftNumbers = numbersOf(left)
  const rightNumbers = numbersOf(right)
  const numeric = leftNumbers.length && rightNumbers.length
    && leftNumbers.some((value) => !rightNumbers.includes(value))
  if (numeric) return 'compares'
  const leftLimit = LIMIT.test(left)
  const rightLimit = LIMIT.test(right)
  if (leftLimit !== rightLimit) return 'qualifies'
  const leftNeg = NEG.test(left)
  const rightNeg = NEG.test(right)
  if (leftNeg !== rightNeg) return 'contradicts'
  return 'supports'
}

function topicOf(record, claimA, claimB) {
  const topic = (record?.topics || [])[0]
  if (topic) return topic
  return shortText(claimA || claimB, 12) || '跨论文主题'
}

function claimFingerprint(claim) {
  return normalizeForMatch(claim?.text || '')
}

function pairKey(a, b) {
  return [String(a.paperId), claimFingerprint(a), String(b.paperId), claimFingerprint(b)].join('|')
}

function crossTitle(relation, topic, claims) {
  const a = shortText(claims[0]?.text || '', 12)
  const b = shortText(claims[1]?.text || '', 12)
  if (relation === 'contradicts') return `矛盾：${topic}（${a} vs ${b}）`.slice(0, 60)
  if (relation === 'qualifies') return `边界：${topic}（${a} / ${b}）`.slice(0, 60)
  if (relation === 'compares') return `对比：${topic}（${a} / ${b}）`.slice(0, 60)
  return `共识：${topic}（${a} / ${b}）`.slice(0, 60)
}

function syntheticClaim(relation, topic, claims) {
  if (relation === 'contradicts') return `关于「${topic}」，不同论文的结论存在冲突。`
  if (relation === 'qualifies') return `关于「${topic}」，现有结论存在适用边界。`
  if (relation === 'compares') return `关于「${topic}」，不同论文的结果可以进行对比。`
  return `关于「${topic}」，多篇论文给出一致方向的证据。`
}

/**
 * 跨论文自动建链。纯函数，不落库。
 * options: { paperIds, topic, minSimilarity, maxPairs, limit, maxClaimsPerPaper }
 */
export function autoCrossPaperDrafts(options = {}) {
  const records = readIndex()
  const wanted = new Set((options.paperIds || []).map((id) => String(id)))
  const minSimilarity = Number(options.minSimilarity) > 0 ? Number(options.minSimilarity) : 0.18
  const maxPairs = Math.max(1, Math.min(40, Number(options.maxPairs) || 16))
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8))
  const maxClaims = Math.max(1, Math.min(12, Number(options.maxClaimsPerPaper) || 6))
  const topicFilter = String(options.topic || '').trim()
  const runId = `run-cross-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const claims = []
  const byPaper = new Map()
  for (const record of records) {
    if (wanted.size && !wanted.has(record.id)) continue
    if (topicFilter && !(record.topics || []).includes(topicFilter)) continue
    const deepread = readDeepRead(record.id)
    if (!deepread) continue
    const list = extractClaims(deepread).slice(0, maxClaims)
    byPaper.set(record.id, record)
    for (const claim of list) {
      claims.push({ ...claim, record })
    }
  }
  const existing = new Set(listChains().map((chain) => normalizeForMatch(chain.claim?.text || chain.claim || '')))
  const seenPairs = new Set()
  const candidates = []
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i]
      const b = claims[j]
      if (a.paperId === b.paperId) continue
      if (existing.has(claimFingerprint(a)) || existing.has(claimFingerprint(b))) continue
      const key = pairKey(a, b)
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const similarity = claimSimilarity(a.text, b.text)
      if (similarity < minSimilarity) continue
      candidates.push({ a, b, similarity, relation: crossRelation(a.text, b.text) })
    }
  }
  // 字面不相似时，按主题/共享概念强配对。只补“还没有字面候选”的论文对。
  const strong = []
  const lexicalPairKeys = new Set(candidates.map((pair) => [pair.a.paperId, pair.b.paperId].sort().join('|')))
  const groups = new Map()
  for (const claim of claims) {
    for (const topic of claim.record?.topics || []) {
      const key = `topic:${topic}`
      if (!groups.has(key)) groups.set(key, { kind: 'topic', label: topic, claims: [] })
      groups.get(key).claims.push(claim)
    }
  }
  try {
    const graph = readGraph()
    const paperConcepts = new Map()
    for (const edge of graph.edges || []) {
      const paperId = edge.sourceType === 'paper' ? edge.source : (edge.targetType === 'paper' ? edge.target : '')
      const name = edge.sourceType === 'concept' ? edge.sourceName : (edge.targetType === 'concept' ? edge.targetName : '')
      if (!paperId || !name) continue
      if (!paperConcepts.has(paperId)) paperConcepts.set(paperId, new Set())
      paperConcepts.get(paperId).add(name)
    }
    for (const claim of claims) {
      for (const concept of paperConcepts.get(claim.paperId) || []) {
        const key = `concept:${concept}`
        if (!groups.has(key)) groups.set(key, { kind: 'concept', label: concept, claims: [] })
        groups.get(key).claims.push(claim)
      }
    }
  } catch { /* 图谱未构建时只用主题 */ }
  const strongPairs = new Set()
  for (const group of [...groups.values()].sort((a, b) => b.claims.length - a.claims.length)) {
    const papers = new Map()
    for (const claim of group.claims) if (!papers.has(claim.paperId)) papers.set(claim.paperId, claim)
    if (papers.size < 2) continue
    const list = [...papers.values()]
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]
        const b = list[j]
        const pairId = [a.paperId, b.paperId].sort().join('|')
        if (lexicalPairKeys.has(pairId) || strongPairs.has(pairId)) continue
        if (existing.has(claimFingerprint(a)) || existing.has(claimFingerprint(b))) continue
        strongPairs.add(pairId)
        const similarity = claimSimilarity(a.text, b.text)
        let relation = crossRelation(a.text, b.text)
        if (relation === 'supports') relation = 'compares'
        strong.push({
          a, b, similarity, relation,
          topic: group.label,
          strongPair: { kind: group.kind, key: group.label, similarity: Math.round(similarity * 100) / 100 },
        })
        if (strong.length >= limit * 2) break
      }
      if (strong.length >= limit * 2) break
    }
    if (strong.length >= limit * 2) break
  }
  candidates.push(...strong)
  candidates.sort((left, right) => (left.strongPair ? 1 : 0) - (right.strongPair ? 1 : 0) || right.similarity - left.similarity)
  const drafts = []
  const skipped = []
  const used = new Set()
  for (const pair of candidates) {
    if (drafts.length >= limit) break
    const key = pairKey(pair.a, pair.b)
    if (used.has(key)) continue
    const left = proposeFromClaim({
      paperId: pair.a.paperId, claim: pair.a.text,
      evidenceIds: pair.a.evidenceIds, pages: pair.a.pages, limit: 2,
    })
    const right = proposeFromClaim({
      paperId: pair.b.paperId, claim: pair.b.text,
      evidenceIds: pair.b.evidenceIds, pages: pair.b.pages, limit: 2,
    })
    if (!left.nodes.length || !right.nodes.length) {
      skipped.push({ papers: [pair.a.paperId, pair.b.paperId], reason: '有一侧没有可锚定的 q-id 证据' })
      continue
    }
    const relation = pair.relation
    const nodes = []
    const seen = new Set()
    const add = (list, side) => {
      for (const node of list) {
        if (seen.has(node.evidenceId)) continue
        seen.add(node.evidenceId)
        const nodeRelation = relation === 'contradicts'
          ? (side === 'left' ? 'supports' : 'contradicts')
          : relation === 'qualifies'
            ? (side === 'left' ? 'supports' : 'qualifies')
            : relation
        nodes.push({ ...node, relation: nodeRelation })
      }
    }
    add(left.nodes, 'left')
    add(right.nodes, 'right')
    if (nodes.length < 2) {
      skipped.push({ papers: [pair.a.paperId, pair.b.paperId], reason: '有效证据节点不足 2 条' })
      continue
    }
    const topic = pair.topic || topicOf(pair.a.record, pair.a.text, pair.b.text)
    const title = crossTitle(relation, topic, [pair.a, pair.b])
    const claimText = syntheticClaim(relation, topic, [pair.a, pair.b])
    if (existing.has(normalizeForMatch(claimText))) {
      skipped.push({ papers: [pair.a.paperId, pair.b.paperId], reason: '同主题跨论文链已存在' })
      continue
    }
    existing.add(normalizeForMatch(claimText))
    used.add(key)
    drafts.push({
      title,
      origin: 'auto',
      status: 'draft',
      confidence: Math.round(Math.min(0.95, (pair.strongPair ? 0.52 : 0.58) + pair.similarity * 0.25 + Math.min(0.1, nodes.length * 0.03)) * 100) / 100,
      topic,
      paperIds: [pair.a.paperId, pair.b.paperId],
      question: '',
      provenance: {
        runId,
        model: null,
        promptVersion: 'chain-cross.v1',
        kind: 'cross-paper',
        relation,
        similarity: Math.round(pair.similarity * 100) / 100,
        strongPair: pair.strongPair || null,
        claims: [
          { paperId: pair.a.paperId, text: pair.a.text, sectionKey: pair.a.sectionKey },
          { paperId: pair.b.paperId, text: pair.b.text, sectionKey: pair.b.sectionKey },
        ],
        extractedAt: new Date().toISOString(),
      },
      relations: [],
      warnings: [
        `跨论文关系由规则初判为「${relation}」，请人工确认。`,
        pair.strongPair ? `按${pair.strongPair.kind === 'concept' ? '共享概念' : '主题'}「${pair.strongPair.key}」强配对，字面相似度 ${Math.round(pair.strongPair.similarity * 100)}%，请重点核对。` : '',
        pair.similarity < 0.3 && !pair.strongPair ? '两篇 claim 的字面相似度偏低，可能是弱关联。' : '',
      ].filter(Boolean),
      claim: {
        text: claimText,
        paperId: pair.a.paperId,
        sectionKey: pair.a.sectionKey,
        source: 'auto-cross',
      },
      nodes,
    })
  }
  return {
    runId,
    drafts,
    skipped,
    scanned: claims.length,
    papers: [...byPaper.keys()],
    candidates: candidates.length,
  }
}
