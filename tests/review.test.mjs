/**
 * 研究结论润色 + 研究综述成文。
 *
 * 校验重点：
 *   1. 结论兜底 ≤500 字；
 *   2. 综述只引用已确认链里的 (paperId, evidenceId)；
 *   3. 模型越界（编造引用 / 无引用段落）必须退回确定性文本。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'dsh-litkb-review-'))
process.env.LITKB_LIBRARY = root
process.env.LITKB_LLM_PROVIDER = 'deepseek-official'
process.env.LITKB_LLM_MODEL = 'deepseek-v4-pro'

import { mkdirSync, writeFileSync } from 'node:fs'

const { ensureLibrary, PATHS, upsert } = await import('../lib/library.js')
ensureLibrary()
const { saveTheme } = await import('../lib/themes.js')
const {
  auditCitations,
  buildSummaryBrief,
  buildThemeReview,
  composeReview,
  fitProse,
  polishReviewSection,
  polishSummary,
  SUMMARY_MAX_CHARS,
} = await import('../lib/review.js')

const record = {
  id: 'p-review001',
  title: '坐标注意力在眼底杯盘分割中的应用',
  authors: '张三, 李四',
  year: '2024',
  venue: '测试期刊',
  type: '学术期刊',
  doi: '',
  file: '',
  hash: 'hash-review-001',
  createdAt: new Date().toISOString(),
}
upsert(record)

const theme = saveTheme({
  title: '眼底杯盘分割研究',
  description: '测试用研究主题',
  facets: [
    { key: 'f1', title: '杯盘边界分割', enabled: true, keywords: ['杯盘'] },
    { key: 'f2', title: '注意力机制', enabled: true, keywords: ['注意力'] },
    { key: 'f3', title: '尚未覆盖的方向', enabled: true, keywords: [] },
  ],
})

mkdirSync(PATHS.chains, { recursive: true })
const now = new Date().toISOString()

/** 直接落链文件：本测试只关心 review 层怎么读链，不需要走 normalizeChain 的证据回贴。 */
function putChain(id, data) {
  writeFileSync(
    join(PATHS.chains, `${id}.json`),
    JSON.stringify(
      {
        id,
        origin: 'topic',
        status: 'confirmed',
        confidence: 0.8,
        paperIds: [record.id],
        relations: [],
        review: {},
        warnings: [],
        createdAt: now,
        updatedAt: now,
        ...data,
      },
      null,
      2,
    ),
    'utf8',
  )
}

putChain('c-review001', {
  title: '杯盘边界分割',
  claim: { text: '两阶段先粗后细的分割策略能改善杯盘边界。', paperId: record.id },
  nodes: [
    {
      paperId: record.id,
      evidenceId: 'q-aaaa1111',
      page: 3,
      relation: 'supports',
      quote: 'Two-stage segmentation improves the cup boundary.',
      authors: '张三',
      year: '2024',
    },
    {
      paperId: record.id,
      evidenceId: 'q-bbbb2222',
      page: 5,
      relation: 'qualifies',
      quote: 'The gain is limited on small cups.',
      authors: '张三',
      year: '2024',
    },
  ],
  provenance: { themeId: theme.id, facetKey: 'f1', viewpointId: 'v1' },
})

putChain('c-review002', {
  title: '注意力机制',
  claim: { text: '坐标注意力沿空间方向编码位置信息。', paperId: record.id },
  nodes: [
    {
      paperId: record.id,
      evidenceId: 'q-cccc3333',
      page: 2,
      relation: 'supports',
      quote: 'Coordinate attention encodes position along two directions.',
      authors: '张三',
      year: '2024',
    },
  ],
  provenance: { themeId: theme.id, facetKey: 'f2', viewpointId: 'v2' },
})

putChain('c-review003', {
  title: '草稿链不应进入结论',
  status: 'draft',
  confidence: 0.3,
  claim: { text: '这条是草稿，不能进综述。', paperId: record.id },
  nodes: [{ paperId: record.id, evidenceId: 'q-dddd4444', page: 9, relation: 'supports', quote: 'draft only' }],
  provenance: { themeId: theme.id, facetKey: 'f1', viewpointId: 'v3' },
})

function fakeCtx(responses) {
  let index = 0
  return {
    get(name) {
      if (name !== 'llm') return undefined
      return {
        stream() {
          const text = responses[Math.min(index, responses.length - 1)]
          index += 1
          return (async function* () {
            yield { type: 'text-delta', text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
}

/* ---------- 1. 兜底摘要 ---------- */
const brief = buildSummaryBrief(theme)
assert.ok(brief.text.length > 0)
assert.ok(brief.text.length <= SUMMARY_MAX_CHARS, `兜底摘要应 ≤500 字，实际 ${brief.text.length}`)
assert.ok(brief.text.includes('覆盖 2/3 条研究内容'))
assert.ok(brief.text.includes('尚未覆盖'))
assert.equal(brief.mode, 'brief')

/* ---------- 2. 引用审计 ---------- */
const allowed = new Set([`${record.id}#q-aaaa1111`])
const good = auditCitations(`有依据 [[${record.id}#^q-aaaa1111|张三 2024, p.3]]`, allowed)
assert.deepEqual(good.invalid, [])
const bad = auditCitations(`编造 [[${record.id}#^q-ffff9999|张三 2024, p.3]]`, allowed)
assert.deepEqual(bad.invalid, [`${record.id}#q-ffff9999`])

/* ---------- 3. 综述骨架 ---------- */
const review = buildThemeReview(theme)
const markdown = review.markdown
assert.ok(markdown.startsWith('# 眼底杯盘分割研究'))
assert.ok(markdown.includes('## 1、研究背景与目标'))
assert.ok(markdown.includes('## 2、杯盘边界分割'))
assert.ok(markdown.includes('## 3、注意力机制'))
assert.ok(!markdown.includes('## 4、'), '未覆盖的研究内容不占正文章节')
assert.ok(markdown.includes('## 研究缺口'))
assert.ok(markdown.includes('尚未覆盖的方向'))
assert.ok(markdown.includes('张三 2024'), '引用应带作者与年份')
assert.ok(!markdown.includes('q-dddd4444'), '草稿链的证证据不能进综述')
assert.ok(!markdown.includes('草稿，不能进综述'))
assert.equal(review.chains, 2)
assert.equal(review.covered, 2)
assert.equal(review.missing.length, 1)

const citedKeys = (text) =>
  [...text.matchAll(/\[\[([a-zA-Z0-9_-]+)#\^([a-zA-Z0-9_-]+)\|/g)].map((m) => `${m[1]}#${m[2]}`)
for (const key of citedKeys(markdown)) {
  assert.ok(
    key.endsWith('#q-aaaa1111') || key.endsWith('#q-bbbb2222') || key.endsWith('#q-cccc3333'),
    `综述不得引用白名单之外的证据：${key}`,
  )
}

/* ---------- 4. 结论润色：模型返回散文即可 ---------- */
const summaryCtx = fakeCtx(['已有工作集中在两阶段分割与注意力机制；在杯盘边界上存在方法差异。'])
const polished = await polishSummary({ ctx: summaryCtx, theme })
assert.equal(polished.mode, 'model')
assert.ok(polished.text.length <= SUMMARY_MAX_CHARS)
assert.ok(polished.text.includes('两阶段'))

/* ---------- 5. 结论里出现的引用标记要被剥掉（不能带无法校验的出处） ---------- */
const markCtx = fakeCtx([`已有工作集中在两阶段分割 [[${record.id}#^q-fake0000|张三 2024, p.3]]。`])
const marked = await polishSummary({ ctx: markCtx, theme })
assert.equal(marked.mode, 'model')
assert.ok(!marked.text.includes('[['), '结论正文不应残留引用标记')

/* ---------- 5.5 字数控制：整句收尾，不硬截断 ---------- */
const sentence = '该方向已有工作集中在编码器-解码器变体与注意力机制上，评估口径存在差异。'
const longText = sentence.repeat(30) // 约 900 字，远超硬上限
const fitted = fitProse(longText)
assert.ok(fitted.length <= 750, `硬上限 750，实际 ${fitted.length}`)
assert.ok(fitted.endsWith('。'), '必须以句号收尾，不能停在半句')
assert.ok(!fitted.endsWith('…'), '不应出现省略号截断')

const shortText = sentence.repeat(3) // 约 90 字
assert.equal(fitProse(shortText), shortText, '短文本原样返回')

// 略超 500 但不超过 750：完整保留，不截断
const medium = sentence.repeat(18) // 约 540 字
assert.ok(medium.length > 500 && medium.length <= 750)
assert.equal(fitProse(medium), medium, '略超目标字数应完整保留')

/* ---------- 6. 模型返回空 → 退回兜底 ---------- */
const emptyCtx = fakeCtx(['   '])
const empty = await polishSummary({ ctx: emptyCtx, theme })
assert.equal(empty.mode, 'brief')

/* ---------- 7. 没有模型时退回兜底 ---------- */
const noModel = await polishSummary({ ctx: { get: () => undefined }, theme })
assert.equal(noModel.mode, 'brief')

/* ---------- 8. 综述分节：缺引用自动补，越界引用只删标记 ---------- */
const facet = theme.facets[0]
const group = [
  {
    claim: { text: '两阶段先粗后细能改善边界。' },
    nodes: [
      {
        paperId: record.id,
        evidenceId: 'q-aaaa1111',
        page: 3,
        relation: 'supports',
        quote: 'Two-stage segmentation.',
        authors: '张三',
        year: '2024',
      },
    ],
    provenance: { themeId: theme.id, facetKey: 'f1' },
  },
]
const route = { provider: 'deepseek-official', model: 'x' }

const nakedCtx = fakeCtx(['这是一段没有任何引用的综述段落。'])
const naked = await polishReviewSection({ ctx: nakedCtx, route, theme, facet, group })
assert.equal(naked.mode, 'model', '缺引用不再整节丢弃')
assert.ok(naked.text.includes('这是一段没有任何引用的综述段落'))
assert.ok(naked.text.includes(`#^q-aaaa1111`), '应在段末补上本节证据')
assert.ok(naked.warnings?.length)

const forgedCtx = fakeCtx([`有依据段落 [[${record.id}#^q-ffff9999|张三 2024, p.3]]。`])
const forged = await polishReviewSection({ ctx: forgedCtx, route, theme, facet, group })
assert.equal(forged.mode, 'model')
assert.ok(!forged.text.includes('q-ffff9999'), '越界引用标记必须被删掉')
assert.ok(forged.text.includes(`#^q-aaaa1111`), '删完要补回本节证据')
assert.ok(forged.warnings?.some((message) => message.includes('不在证据链内')))

const goodCtx = fakeCtx([`两阶段策略被用于改善杯盘边界 [[${record.id}#^q-aaaa1111|张三 2024, p.3]]。`])
const okSection = await polishReviewSection({ ctx: goodCtx, route, theme, facet, group })
assert.equal(okSection.mode, 'model')
assert.ok(okSection.text.includes(`#^q-aaaa1111`))

const blankCtx = fakeCtx(['   '])
const blank = await polishReviewSection({ ctx: blankCtx, route, theme, facet, group })
assert.equal(blank.mode, 'fallback', '模型返回空才退回确定性写法')

/* ---------- 9. 无模型时 assemble 仍产出完整稿 ---------- */
const composed = await composeReview({ ctx: { get: () => undefined }, theme })
assert.equal(composed.polished, 0)
assert.ok(composed.warnings.length)
assert.ok(composed.markdown.includes('## 1、研究背景与目标'))
assert.ok(composed.markdown.length > 200)

console.log('review tests passed')
