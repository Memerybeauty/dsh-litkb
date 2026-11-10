# 内部业务 Agent：职责与协作设计

> 状态：**设计稿，未实现**  
> 目标版本：v0.17.0  
> 当前基础：dsh-litkb v0.16.1，90 条路由，12 个 `lit_*` 工具  
> 目标：把散落在 jobs / themes / chains / writing 里的业务逻辑，收拢成 4 个内容 Owner + 2 个横切能力 + 1 个编排器。

---

## 0. 一句话

```text
Intake 收文 → Research 研究方向 → Evidence 证据 → Writing 写作
                         ↑
                    Review 质量门
Answer 只读旁路
Orchestrator 只调度，不判断内容
```

**单进程、模块化单体**，不做微服务、不做独立 Agent 进程、不先上事件总线中间件。

---

## 1. 现状与问题

### 1.1 现状

- 论文导入、解析、七段卡、精读：`src/server/20-jobs.js`、`10-import-helpers.js`、`lib/cardgen.js`、`deepread.js`、`blocks.js`；
- 研究方向、匹配、方向分析：`lib/themes.js`、`lib/theme-analysis.js`、`src/server/75-apply-routes-themes.js`；
- 证据链、审核：`lib/chains.js`、`lib/evidence.js`、`src/server/70-apply-routes-chains.js`；
- 写作、文稿：`lib/drafts.js`、`src/server/80-apply-routes-writing.js`；
- 检索、问答、图谱：`lib/search.js`、`answer.js`、`graph.js`；
- Agent 工具：`lib/agent-tools.js`，12 个；
- 路由直接调用上述函数，没有统一业务 Owner。

### 1.2 问题

| 问题 | 表现 |
|---|---|
| 业务无唯一负责人 | 改七段卡要跨 prompt、cardgen、UI、导出、测试 |
| 写入分散 | 多个路由/任务都能改 paper、chain、draft |
| 状态不一致 | 论文状态、精读任务、卡片任务、分析任务各有一套 |
| 失败不可定位 | 只看到“某任务失败”，不知道哪个业务环节 |
| 无法版本化 | prompt/schema 改了，旧产物没有失效标记 |
| Agent 工具碎片化 | 12 个工具是能力，不是业务 Agent |

### 1.3 非目标

- 不做多进程/微服务；
- 不做独立 Agent 之间的自由对话；
- 不做自动 confirmed；
- 不把 q-id、BM25、文件写入放进 Agent；
- 不在第一阶段重写全部 UI。

---

## 2. 目标架构

```text
┌────────────────────────────────────────────────────┐
│                    Workbench UI                    │
└──────────────────────┬─────────────────────────────┘
                       │ command
┌──────────────────────▼─────────────────────────────┐
│                  Orchestrator                      │
│  dispatch / run state / retry / cancel / confirm   │
└───┬──────────┬──────────┬──────────┬───────────────┘
    │          │          │          │
┌───▼───┐ ┌────▼────┐ ┌───▼─────┐ ┌──▼─────┐
│Intake │ │Research │ │Evidence │ │Writing │
└───┬───┘ └────┬────┘ └───┬─────┘ └──┬─────┘
    │          │          │          │
    │          │      ┌───▼─────┐    │
    │          │      │ Review  │    │
    │          │      │ 质量门  │    │
    │          │      └─────────┘    │
    │          │                     │
    └──────────┴──────────┬──────────┘
                          │
                    ┌─────▼─────┐
                    │  Answer   │
                    │ 只读旁路  │
                    └───────────┘
```

### 2.1 四个内容 Owner

| Owner | 定位 | 唯一写入的产物 |
|---|---|---|
| **Intake** | 论文变成可研究状态 | papers / blocks / cards / deepread / paper.status |
| **Research** | 论文对研究方向意味着什么 | themes / themes/analysis |
| **Evidence** | 观点有没有真实证据、能不能成链 | chains |
| **Writing** | 已确认内容怎么写 | theme.summary / outline / drafts |

### 2.2 两个横切能力

- **Review**：质量门，独立审核；不拥有内容，只产出 review report 和 verdict；
- **Answer**：只读检索/问答/图谱；不写库。

### 2.3 编排器

- 只管命令、状态、队列、并发、超时、取消、重试、人工确认；
- 不调用模型；
- 不写业务产物；
- 记录 run 与 event。

---

## 3. 通用契约

### 3.1 Command

工作台只发命令：

```json
{
  "command": "theme.analyze",
  "runId": "run-20261110-abc123",
  "actor": { "type": "user", "id": "local" },
  "idempotencyKey": "theme:t-87b767e9:analyze:v1",
  "payload": {
    "themeId": "t-87b767e9",
    "facetKeys": ["f1", "f2"],
    "paperIds": []
  },
  "options": {
    "dryRun": false,
    "force": false,
    "confirm": false
  }
}
```

### 3.2 Event

```json
{
  "id": "evt-20261110-001",
  "type": "theme.analysis.ready",
  "at": "2026-11-10T07:10:00.000Z",
  "runId": "run-20261110-abc123",
  "subject": { "type": "theme", "id": "t-87b767e9" },
  "payload": {
    "analysisId": "t-87b767e9",
    "stats": { "papers": 11, "relevant": 9, "viewpoints": 14, "gaps": 1 }
  }
}
```

### 3.3 Artifact envelope

每个跨 Owner 的产物都要有：

```json
{
  "schema": "theme-analysis.v1",
  "id": "t-87b767e9",
  "version": 3,
  "owner": "research",
  "runId": "run-20261110-abc123",
  "createdAt": "2026-11-10T07:10:00.000Z",
  "basis": {
    "themeUpdatedAt": "2026-11-10T06:50:00.000Z",
    "paperVersions": { "p-cd832870": 2, "p-7336f3a9": 1 },
    "cardVersions": { "p-cd832870": 1, "p-7336f3a9": 1 },
    "promptVersion": "theme-analysis.v1"
  }
}
```

`basis` 任一变化 → 产物标记 stale。

### 3.4 Agent 返回

```json
{
  "ok": true,
  "agentId": "research",
  "runId": "run-20261110-abc123",
  "artifacts": [
    { "type": "theme-analysis", "id": "t-87b767e9", "version": 3 }
  ],
  "warnings": [],
  "metrics": {
    "units": 11,
    "failed": 0,
    "tokens": 120000,
    "durationMs": 180000
  }
}
```

### 3.5 错误

```json
{
  "ok": false,
  "agentId": "research",
  "code": "truncated",
  "message": "模型输出被截断（max-tokens），请重试",
  "unit": { "paperId": "p-7336f3a9", "facetKey": "f1" },
  "retryable": true
}
```

错误码：

| code | 含义 | 处理 |
|---|---|---|
| `truncated` | 输出超预算 | 拆分/增大预算重试 |
| `bad_json` | JSON 不合法 | 修复 prompt 重试一次 |
| `no_model` | 无可用模型 | 立即失败，提示配置 |
| `no_card` | 论文无七段卡 | 不重试，提示先补全 |
| `no_evidence` | 观点无可锚定 q-id | 标记缺口，不重试 |
| `rate_limit` | 限流 | 退避重试 |
| `timeout` | 超时 | 重试一次 |
| `cancelled` | 用户取消 | 保存已完成部分 |

### 3.6 幂等键

```text
paper.ingest:       paper:<paperId>:<fileHash>
theme.analyze:      theme:<themeId>:<basisHash>
viewpoint.chain:    theme:<themeId>:facet:<facetKey>:viewpoint:<fingerprint>
summary.generate:   theme:<themeId>:<chainFingerprint>
draft.save:         draft:<draftId>:<contentHash>
```

---

## 4. 四个 Owner

### 4.1 Intake：收文

### 定位

让一篇论文变成“可研究状态”：有解析、有七段卡、有精读、状态正确。

### 命令

```text
paper.ingest        导入/补全
paper.repair        修复失败步骤
paper.status        手动改阅读状态
paper.delete        删除论文（强确认）
```

### 输入

```json
{
  "paperId": "p-...",
  "file": "本地路径或上传句柄",
  "profile": "card-profile.v3",
  "options": { "force": false, "parseMode": "auto" }
}
```

### 输出产物

```text
paper record
blocks/<id>.json
cards/<id>.card.json
deepread/<id>.json
cache/pages/<id>/
```

### 内部步骤

```text
1. 导入/去重
2. 元数据、分类、标签
3. 解析 blocks + 页图
4. 七段卡（CardProfile）
5. 精读
6. 状态自动标记（略读/精读）
7. 质量检查：解析质量、卡完整度、精读存在
8. 发 paper.ready / paper.partial
```

### 不做什么

- 不判断研究方向相关性；
- 不抽研究观点；
- 不建链；
- 不写作。

### 配置：CardProfile

```json
{
  "id": "card-profile.v3",
  "sections": [
    {
      "key": "oneLine",
      "title": "一句话",
      "required": true,
      "needsEvidence": true,
      "promptHint": "用一句话概括论文"
    },
    {
      "key": "problem",
      "title": "问题与动机",
      "required": true,
      "needsEvidence": true
    },
    {
      "key": "method",
      "title": "方法",
      "required": true,
      "needsEvidence": true
    },
    {
      "key": "data",
      "title": "数据与实验",
      "required": true,
      "needsEvidence": true
    },
    {
      "key": "results",
      "title": "结果",
      "required": true,
      "needsEvidence": true
    },
    {
      "key": "limits",
      "title": "局限",
      "required": true,
      "needsEvidence": false
    },
    {
      "key": "relevance",
      "title": "与我的课题",
      "required": true,
      "needsEvidence": false
    }
  ]
}
```

### 当前代码映射

| 现有 | 迁移 |
|---|---|
| `src/server/20-jobs.js` | 收进 `agents/intake` |
| `src/server/10-import-helpers.js` | 收进 `agents/intake` |
| `lib/cardgen.js` | 保留为 card 服务，由 Intake 调用 |
| `lib/deepread.js` | 保留为 deepread 服务 |
| `lib/blocks.js` / `pdf.js` | 保留为解析服务 |
| `applyAutoStatus` | Intake 在 paper.ready 后调用 |

### 验收

- 导入一篇论文，行为与 v0.16.1 一致；
- 失败步骤可单独补全；
- paper.ready 带 card/deepread version；
- 不触发研究方向分析。

---

### 4.2 Research：研究方向

### 定位

判断论文对研究内容意味着什么：符合/不符合、观点、一致/分歧。

### 命令

```text
theme.save           创建/编辑研究
theme.delete         删除研究
theme.match          匹配预览
theme.analyze        全文方向分析
theme.analysis.cancel 停止分析
```

### 输入

```json
{
  "themeId": "t-87b767e9",
  "facetKeys": ["f1", "f2"],
  "paperIds": [],
  "profile": "analysis-profile.v1",
  "options": { "force": false }
}
```

### 输出产物

```text
themes/<id>.json
themes/analysis/<id>.json
```

### 内部命令

```text
plan        把主题拆成 3–6 条研究内容
analyze     每篇论文 × 每条研究内容：relevance/stance/claims
viewpoints  每条研究内容：观点聚类/一致/分歧/缺口
```

### AnalysisProfile

```json
{
  "id": "analysis-profile.v1",
  "maxFacets": 6,
  "maxClaimsPerFacet": 3,
  "maxPapersPerFacet": 12,
  "requireStance": true,
  "requireEvidencePerClaim": false,
  "dimensions": ["method", "data", "metric", "result", "limitation"]
}
```

### 不做什么

- 不最终确认 q-id；
- 不建链；
- 不写结论/提纲；
- 不改卡片。

### 当前代码映射

| 现有 | 迁移 |
|---|---|
| `lib/themes.js` | 收进 `agents/research` |
| `lib/theme-analysis.js` | 收进 `agents/research` |
| `src/server/75-apply-routes-themes.js` | 改为 dispatch |
| `buildThemeSummary/Outline` | 移到 Writing |

### 验收

- 11 篇论文分析完成，矩阵/观点/缺口可读；
- 单篇失败不影响其他；
- 分析产物带 basis；
- 论文/主题变化后标记 stale。

---

### 4.3 Evidence：证据

### 定位

保证每个观点有真实 q-id，并形成可审核的链。

### 命令

```text
viewpoint.chain     观点 → 草稿链
chain.save          手动保存链
chain.dedupe        去重
chain.merge         合并
chain.delete        删除
```

### 输入

```json
{
  "themeId": "t-87b767e9",
  "facetKey": "f2",
  "viewpointId": "v1",
  "policy": "evidence-policy.v2",
  "confirm": false
}
```

### 输出产物

```text
chains/<id>.json
```

### 内部步骤

```text
1. 读取观点与候选 q-id
2. 校验 q-id 存在
3. 回贴 quote/page/block
4. 选节点（EvidencePolicy）
5. 判断关系（supports/contradicts/qualifies/compares）
6. 生成 draft
7. 同 viewpointId 幂等更新
8. 发 chain.draft.created
```

### EvidencePolicy

```json
{
  "id": "evidence-policy.v2",
  "minQuoteChars": 24,
  "maxNodes": 4,
  "perPaper": 2,
  "requireKeywordHit": true,
  "sectionWhitelist": ["abstract", "method", "result", "discussion"],
  "relationMode": "cue",
  "allowNewQuotes": true,
  "auditRequired": true
}
```

### 不做什么

- 不生成观点；
- 不判断研究方向；
- 不自动 confirmed；
- 不做全局质量审核。

### 当前代码映射

| 现有 | 迁移 |
|---|---|
| `lib/chains.js` | 收进 `agents/evidence` |
| `lib/evidence.js` | 保留为证据服务 |
| `src/server/70-apply-routes-chains.js` | 改为 dispatch |
| `createViewpointChain` | 收进 Evidence |

### 验收

- 观点可生成 draft；
- 同一观点重跑不重复；
- 无效 q-id 被拒绝；
- confirmed 只能由 Review/人工确认。

---

### 4.4 Writing：写作

### 定位

把已确认的观点写成研究结论、提纲和文稿。

### 命令

```text
summary.generate    生成研究结论
outline.generate    生成提纲
draft.create        新建文稿
draft.save          保存文稿
draft.insertChain   把链插入文稿
```

### 输入

```json
{
  "themeId": "t-87b767e9",
  "mode": "append",
  "profile": "writing-profile.v1",
  "confirm": false
}
```

### 输出产物

```text
theme.summary
outline markdown
drafts/<id>.json
```

### 内部步骤

```text
1. 只读 confirmed chains
2. 按 facet/viewpoint 组织
3. 生成结论或提纲
4. 插入引用
5. 保存
6. 发 draft.generated
```

### WritingProfile

```json
{
  "id": "writing-profile.v1",
  "summaryStyle": "structured",
  "maxSummaryChars": 20000,
  "outlineDepth": 2,
  "citationFormat": "[[paperId#^evidenceId|Author Year, p.N]]",
  "requireCitationPerClaim": true,
  "forbidNewClaims": true
}
```

### 不做什么

- 不新增事实；
- 不选证据；
- 不建链；
- 不把 draft 链写进结论。

### 当前代码映射

| 现有 | 迁移 |
|---|---|
| `lib/drafts.js` | 收进 `agents/writing` |
| `src/server/80-apply-routes-writing.js` | 改为 dispatch |
| `buildThemeSummary` | 移到 Writing |
| `buildThemeOutline` | 移到 Writing |

### 验收

- 只使用 confirmed 链；
- 每个事实句有引用；
- 结论过期能提示；
- 手改内容不被重跑覆盖。

---

## 5. 横切能力

### 5.1 Review：质量门

### 定位

独立审核，不生成内容。

### 命令

```text
chain.audit     审核一条链
draft.audit     审核文稿引用
chain.decide    人工通过/拒绝/合并
```

### 检查项

| code | 含义 | 级别 |
|---|---|---|
| `qid_missing` | q-id 不存在 | blocker |
| `quote_mismatch` | 引文与卡片不一致 | blocker |
| `page_mismatch` | 页码不一致 | warn |
| `claim_unsupported` | 引文不支持观点 | blocker |
| `single_paper` | 只有一篇论文 | warn |
| `coverage_gap` | 缺少方法/数据/结果维度 | warn |
| `duplicate_chain` | 同一观点多条链 | warn |
| `contradiction_unhandled` | 有反驳未处理 | warn |
| `draft_in_summary` | 结论引用了 draft | blocker |

### 输出

```json
{
  "schema": "review-report.v1",
  "subject": { "type": "chain", "id": "c-..." },
  "verdict": "pass | pass_with_warnings | reject",
  "checks": [
    { "code": "single_paper", "severity": "warn", "message": "只有 1 篇论文支撑" }
  ],
  "recommendations": ["补充第二篇论文"]
}
```

### 边界

- Review 不写 chain；只产出 report；
- Evidence 根据 report 和人工决定改 chain 状态；
- 生成与审核使用不同 prompt/入口；
- 默认人工确认，不自动 confirmed。

### 5.2 Answer：只读问答

```text
search.query    检索
question.ask    带引用回答
graph.query     图谱查询
```

- 只读；
- 不写库；
- 不参与主流程；
- 引用必须来自库内 q-id。

---

## 6. Orchestrator：编排器

### 职责

- 接收 command；
- 分派给 Owner；
- 维护 run 状态；
- 记录事件；
- 控制并发/超时/取消/重试；
- 执行人工确认策略。

### 不做什么

- 不调模型；
- 不写论文/分析/链/文稿；
- 不做内容判断。

### Run 状态

```text
queued → running → done
                 → partial
                 → failed
                 → cancelled
```

### 重试矩阵

| 错误 | 自动重试 | 策略 |
|---|---|---|
| `truncated` | 是 | 拆分 unit / 增大预算 |
| `bad_json` | 是 | 修复 prompt 一次 |
| `rate_limit` | 是 | 指数退避 |
| `timeout` | 是 | 一次 |
| `no_model` | 否 | 提示配置 |
| `no_card` | 否 | 提示补全 |
| `no_evidence` | 否 | 标缺口 |
| `cancelled` | 否 | 保存部分 |

### 取消

- 检查 `cancelled` 在每个 unit 边界；
- 已完成 unit 不回滚；
- 产物保存 partial；
- UI 显示“已停止”。

---

## 7. 业务流程

### 7.1 导入论文

```text
UI → Orchestrator: paper.ingest
Orchestrator → Intake
Intake: 解析 → 卡片 → 精读 → 质量检查
Intake → event: paper.ready
Orchestrator: 若论文在某个主题中 → event: theme.analysis.stale
UI: 进度条
```

### 7.2 方向分析

```text
UI → Orchestrator: theme.analyze
Orchestrator → Research
Research:
  plan
  per paper: analyze（fan-out，2–3 并行）
  per facet: viewpoints（fan-in）
  save analysis
Research → event: theme.analysis.ready
Orchestrator → Review: 分析质检（可选）
UI: 矩阵/观点/缺口
```

### 7.3 观点建链

```text
UI → Orchestrator: viewpoint.chain
Orchestrator → Evidence
Evidence: 校验 q-id → 生成 draft → event: chain.draft.created
Orchestrator → Review: chain.audit
Review → report
UI: 人工确认
Orchestrator → Evidence: chain.confirm
Evidence → event: chain.confirmed
Orchestrator → Writing: 标记结论 stale
```

### 7.4 写作

```text
UI → Orchestrator: summary.generate
Orchestrator → Writing
Writing: 读 confirmed → 生成 → event: draft.generated
Orchestrator → Review: draft.audit
Review → report
UI: 编辑/保存
```

### 7.5 问答

```text
UI → Orchestrator: question.ask
Orchestrator → Answer
Answer: 检索 → 回答 + citations
```

---

## 8. 状态机

### 8.1 论文

```text
paper.status（阅读状态）:
  待读 → 略读 → 精读 → 已引用 / 弃读

paper.ingest（处理状态）:
  imported → parsing → card → deepread → ready
                                      → partial
                                      → failed
```

**阅读状态和入库状态分开**，不再用一个字段表达两件事。

### 8.2 分析

```text
none → queued → running → ready
                        → partial
                        → failed
ready → stale（论文/主题变化）
```

### 8.3 链

```text
draft → confirmed
draft → rejected
confirmed → stale（证据失效）
```

### 8.4 文稿

```text
empty → generated → edited
generated/edited → stale（链变化）
```

---

## 9. 数据与文件布局

### 9.1 文献库

```text
文献库/
  papers/ blocks/ cards/ deepread/
  themes/
    t-....json
    analysis/t-....json
  chains/
  drafts/
  cache/
    pages/
    agents/runs/       # 运行记录（不备份）
    agents/events/     # 事件日志（不备份）
```

### 9.2 代码

```text
lib/agents/
  registry.js
  orchestrator.js
  intake/
    index.js
    profile.js
  research/
    index.js
    plan.js
    analyze.js
    viewpoints.js
  evidence/
    index.js
    select.js
    chain.js
  writing/
    index.js
    summary.js
    outline.js
  review/
    index.js
    checks.js
  answer/
    index.js
profiles/
  card-profile.v3.json
  analysis-profile.v1.json
  evidence-policy.v2.json
  writing-profile.v1.json
```

### 9.3 路由

路由只做：

```js
const run = orchestrator.dispatch(command, payload)
json(res, 202, { run })
```

不再直接调用业务函数。

---

## 10. API 与 UI

### 10.1 新 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/litkb/agents` | Agent 目录、职责、状态 |
| GET | `/api/litkb/runs?id=` | 运行记录 |
| POST | `/api/litkb/runs/cancel` | 取消运行 |
| POST | `/api/litkb/runs/retry` | 重试失败单元 |

现有业务接口保留，内部改为 dispatch。

### 10.2 UI

- 关于/设置 →「内部 Agent」目录：4 Owner + Review + Answer；
- 任务条显示：当前 Agent、步骤、进度、取消；
- 论文详情显示：由 Intake 生成；
- 研究方向显示：由 Research 分析；
- 链显示：Evidence 生成、Review 审核；
- stale 提示：分析过期、结论过期、链节点失效。

---

## 11. 失败与恢复

- 每个 unit 完成即保存；
- 单篇失败不影响其他；
- 重试只重试失败 unit；
- 取消保存部分；
- 旧产物不删除，标 stale；
- 失败原因落到 run/event，UI 可定位到 paperId/facetKey。

---

## 12. 测试与评测

### 12.1 测试

- 单元测试：每个 Owner 的纯函数；
- 契约测试：输入/输出 schema；
- 集成测试：fake LLM + 临时库；
- 端到端：导入 → 分析 → 建链 → 审核 → 写作；
- 回归：固定论文集，比对分析/链结果。

### 12.2 指标

```text
方向相关性准确率
观点可追溯率（有 q-id）
引用支持率（审核通过/总证据）
每条研究内容覆盖率
重复链率
单篇失败率
平均耗时/token
```

---

## 13. 迁移计划

### Phase 0：文档与骨架

- 本文档；
- `agents/registry.js`、`orchestrator.js` 骨架；
- 不改行为。

### Phase 1：Intake 收口

- 20-jobs → Intake；
- 路由 dispatch；
- run/event 日志；
- 行为、数据、UI 不变；
- 验收：现有 140 项测试全过。

### Phase 2：Research 收口

- themes + theme-analysis → Research；
- 分析 stale；
- 行为不变；
- 验收：方向分析结果与 v0.16.1 一致。

### Phase 3：Evidence + Review

- chains + createViewpointChain → Evidence；
- Review 质量门；
- 观点链、审核；
- 验收：同一观点幂等、审核不串链。

### Phase 4：Writing + Answer

- summary/outline/draft → Writing；
- Answer 接入 registry；
- Agent 目录 UI；
- 验收：结论只读 confirmed，引用可追溯。

---

## 14. 风险与待定

### 风险

- 过度抽象：先单进程模块，不做微服务；
- 上下文重复：Research 一次全文分析尽量产出所有 facet；
- 契约漂移：产物必须带 schema/version/basis；
- 行为回归：每阶段保持现有测试通过。

### 待定

1. Review 先做质量门，还是直接第五个 Owner？
2. 论文 ready 后是否自动触发主题分析？（建议否，只标 stale）
3. 观点是否自动生成 draft 链？（建议默认否）
4. 论文分析并发数？（建议 2–3）
5. CardProfile 是否开放 UI 配置？（建议先文件配置，稳定后 UI）
6. runs/events 放 cache 还是备份？（建议 cache，不备份）

---

## 15. 验收清单

- [ ] 4 个 Owner 有明确目录和 `run(command)`；
- [ ] 路由不再直接调业务函数；
- [ ] 每个产物有 owner/schema/version/basis；
- [ ] 论文/主题/链变化能标 stale；
- [ ] 单篇/单 facet 失败可重试；
- [ ] 取消能停；
- [ ] Review 不生成内容；
- [ ] Writing 只读 confirmed；
- [ ] Agent 目录 UI 可见；
- [ ] 现有 140 项测试全过。
