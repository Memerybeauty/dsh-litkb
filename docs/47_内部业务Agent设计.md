# 内部业务模块收口：职责与协作设计

> 状态：**待规划（Backlog），未排期**
>
> 目标版本：v0.17.0（待定）
>
> 当前基础：dsh-litkb v0.16.3，90 条路由，12 个 `lit_*` 工具
>
> **2026-11-10 修订**：原叫「内部业务 Agent」。查代码后确认 12 个模型调用点全部是单次请求、没有一处需要自主决策，遂改名，并砍掉为 Agent 想象配套的编排器契约。改动清单见 §0.2。
>
> 目标：把散落在 jobs / themes / chains / writing 里的业务逻辑，收拢成 4 个内容 Owner + 2 个横切能力，**每个产物有唯一写入者**，并用一张 run 表解决失败定位。

---

## 0. 一句话

```text
Intake 收文 → Research 研究方向 → Evidence 证据 → Writing 写作
                         ↑
                    Review 质量门
Answer 只读旁路
路由 + run 记录 只记录，不判断内容
```

**单进程、模块化单体**，不做微服务、不做独立 Agent 进程、不先上事件总线中间件。

### 0.1 这不是 Agent 架构

查过 v0.16.3 代码：14 个 `callModel()` 调用点、12 个业务能力，**全部是「拼输入 → 收文本 → 校验 / 降级」的单次请求，没有一处需要模型决定下一步做什么**（清单见附录 A）。

那四个 Owner 也不是 Agent：没有对话循环，不自己决定顺序，本质是四个带唯一写入权的模块，加一张 run 记录表。

所以本版改名，并把原方案里为「Agent」想象配套的那部分砍掉。

### 0.2 2026-11-10 修订：砍掉了什么

| 原文 | 处置 |
|---|---|
| 原 §3.1 Command、§3.2 Event、§3.4 Agent 返回、§3.5 错误码表、§3.6 幂等键 | **删除**。单进程里这些就是函数返回值，一次上五套信封只是负担 |
| 原 §6 Orchestrator 的并发 / 超时 / 取消 / 重试矩阵 | **收缩**成一张 run 记录表，只解决「失败能定位到哪个 unit」 |
| 原 §10.1 新增 4 个 API | **不做**，run 先只落文件 |
| 原 §13 Phase 1（行为不变 + 140 项测试全过） | **不做**。没有任何人看得出区别的阶段 |
| 原 §3.3 产物信封（`basis`） | **保留**，成为新的 §3.1 |
| 原 §2.1 四个 Owner 的写入权 | **保留**。这是本方案唯一被验证有价值的部分 |

**保留不动**：§4 四个 Owner 的职责与验收、§5 两个横切能力、§7 业务流程、§8 状态机、§9 数据布局、§11 失败与恢复、§12 测试与评测。

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
| 工具与业务脱节 | 12 个 `lit_*` 工具是能力，不代表业务边界；谁有权写哪个产物没有定义 |

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
│                  路由 + Run 记录                   │
│          只记录 command / status，不调度           │
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

### 2.3 路由与 run 记录

- 只做三件事：调用 Owner、记一条 run、把状态给 UI；
- 不调用模型、不写业务产物、不做内容判断；
- **不管**并发 / 超时 / 取消 / 自动重试（沿用现有 job 的实现）；
- 详见 §6。

---

## 3. 只保留两条契约

原方案的 Command / Event / Agent 返回 / 错误码 / 幂等键五套信封全部删除。单进程里这些就是函数返回值，一次上全套等于同一个约定写三份。

### 3.1 产物信封：schema / version / basis

每个跨 Owner 的产物带：

```json
{
  "schema": "theme-analysis.v1",
  "id": "t-87b767e9",
  "version": 3,
  "owner": "research",
  "createdAt": "2026-11-10T07:10:00.000Z",
  "basis": {
    "themeUpdatedAt": "2026-11-10T06:50:00.000Z",
    "paperVersions": { "p-cd832870": 2, "p-7336f3a9": 1 },
    "cardVersions": { "p-cd832870": 1, "p-7336f3a9": 1 },
    "promptVersion": "theme-analysis.v1"
  }
}
```

规则只有三条：

- `basis` 任一字段变化 → 产物标 `stale`，**不删、不自动重算**；
- 只有 Owner 能写自己的产物（§2.1）；
- `version` 只增不减，用于 UI 判断新旧，不做版本协商。

**`basis` 是优先项**：它同时被 [48 待规划](48_待规划.md) 的「分析 stale 标记」需要，是本方案里唯一应当先于架构落地的部分。

### 3.2 run 记录：一张表

每次操作落一条，存 `cache/agents/runs/`（不备份）：

```json
{
  "id": "run-20261110-abc123",
  "command": "theme.analyze",
  "payload": { "themeId": "t-87b767e9", "facetKeys": ["f1", "f2"] },
  "status": "partial",
  "units": { "total": 66, "done": 65, "failed": 1 },
  "error": { "code": "truncated", "unit": { "paperId": "p-7336f3a9", "facetKey": "f5" } },
  "startedAt": "2026-11-10T07:00:00.000Z",
  "endedAt": "2026-11-10T07:12:00.000Z"
}
```

状态：`queued → running → done / partial / failed / cancelled`。

`error.code` 沿用现有分类，不新建枚举：`truncated`、`bad_json`、`no_model`、`no_llm`、`no_card`、`no_evidence`、`rate_limit`、`timeout`、`cancelled`。

**这张表只解决一件事**：66 个单元里挂了哪一个。v0.16.1 / v0.16.3 修截断时最痛的就是说不清是哪篇的哪个 facet。

**这张表不做**：不做自动重试、不做重试矩阵、不做事件订阅、不做幂等键。重试由人点，或在原有 job 里就地重试。

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

## 6. 路由与 run 记录（原 Orchestrator）

### 职责

只有三条：

1. 接到请求，调用对应的 Owner 模块；
2. 记一条 run（§3.2），带失败单元；
3. 把 run 状态交给 UI 显示进度。

### 不做什么

- 不调模型（调用点都在各 Owner 内部，见附录 A）；
- 不写业务产物；
- 不做内容判断；
- **不管并发 / 超时 / 取消**——沿用现有 job 的实现；
- **不做自动重试矩阵**。

### 为什么能砍到这么小

原方案的重试矩阵（`truncated` 拆分重试、`rate_limit` 指数退避）听着完整，但实际上**已经各自实现过了**：

- `generateCardSection`（`lib/cardgen.js:320`）——单段超预算就缩粒度重试；
- 方向分析（`lib/theme-analysis.js:209`、`:353`）——截断后紧凑重试 + 逐篇回退。

形态都是 `for` 循环里的 `try/catch`。再在编排器里造一套，等于同一策略两份实现、两处维护。

**先把这些既有的就地重试抽成共用函数，比新造一个编排器划算。**

---

## 7. 业务流程

> 下文图中的「路由」= §6 的路由 + run 记录，只记录不判断。

### 7.1 导入论文

```text
UI → 路由: paper.ingest
路由 → Intake
Intake: 解析 → 卡片 → 精读 → 质量检查
Intake → 状态: paper.ready
路由: 若论文在某个主题中 → 标记 theme.analysis stale
UI: 进度条
```

### 7.2 方向分析

```text
UI → 路由: theme.analyze
路由 → Research
Research:
  plan
  per paper: analyze（fan-out，2–3 并行）
  per facet: viewpoints（fan-in）
  save analysis
Research → 状态: theme.analysis.ready
路由 → Review: 分析质检（可选）
UI: 矩阵/观点/缺口
```

### 7.3 观点建链

```text
UI → 路由: viewpoint.chain
路由 → Evidence
Evidence: 校验 q-id → 生成 draft → 状态: chain.draft.created
路由 → Review: chain.audit
Review → report
UI: 人工确认
路由 → Evidence: chain.confirm
Evidence → 状态: chain.confirmed
路由 → Writing: 标记结论 stale
```

### 7.4 写作

```text
UI → 路由: summary.generate
路由 → Writing
Writing: 读 confirmed → 生成 → 状态: draft.generated
路由 → Review: draft.audit
Review → report
UI: 编辑/保存
```

### 7.5 问答

```text
UI → 路由: question.ask
路由 → Answer
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
    agents/runs/       # run 记录（不备份）
```

### 9.2 代码

```text
lib/agents/
  registry.js
  runs.js            # run 记录
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

路由只做三件事：调 Owner、记 run、返回状态。

```js
const run = runs.start('theme.analyze', payload)
try {
  const result = await research.analyze(payload)   // 业务在 Owner 里
  runs.finish(run, result)
  json(res, 200, { ok: true, ...result })
} catch (error) {
  runs.fail(run, error)                            // 带 unit
  json(res, 500, { ok: false, code: error.code, unit: error.unit })
}
```

不再直接改 paper / chain / draft，也不在路由里拼业务逻辑。

---

## 10. API 与 UI

### 10.1 新 API

**本版不加。** run 记录先只落文件，不做查询接口。等真的需要按 unit 重试时再加 `GET /api/litkb/runs` 和 `POST /api/litkb/runs/retry`。

现有业务接口保留，内部改为调用 Owner 模块。

### 10.2 UI

- 关于/设置 → 模块目录：**推后**，本版不做；
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
- 失败原因落到 run 记录的 `unit`，能定位到 paperId/facetKey。

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

## 13. 迁移计划（修订）

### 前置：先做 48 的三件事

[48 待规划](48_待规划.md) 给本方案设了启动条件，目前**不满足**：

| 项 | 现状 |
|---|---|
| 分析结果完整性 | 待观察 |
| 分析 stale 标记 | 待规划 |
| 观点指纹稳定 | 待规划 |

这三件里，**stale 标记就是 §3.1 的 `basis`**。先把它做掉，既拿到产品价值，也验证了本方案唯一值得保留的机制。其余不动。

### Phase A：写入权收口（行为不变）

- `applyAutoStatus` 收进 Intake；`createViewpointChain` 收进 Evidence；
- Writing 不再直接改 chain 状态；
- 只改调用位置，不改产物、不改 UI；
- 验收：140 项测试全过 + 手工跑一遍导入 / 分析 / 建链 / 写作。

### Phase B：run 记录 + 失败定位

- 每次 job 写一条 run（§3.2）；
- 失败带 `unit`（paperId / facetKey）；
- 只加记录，不改流程；
- 验收：故意让一篇论文或一个 facet 失败，能指到是哪篇哪个 facet。

### Phase C：Review（可选，看 Phase B 的真实失败分布再定）

- 先做质量门（`chain.audit` / `draft.audit`），不做第五个 Owner；
- 验收：q-id 失效、引文不支持能被拦下。

---

## 14. 风险与待定

### 风险

- 过度抽象：先单进程模块，不做微服务；
- 上下文重复：Research 一次全文分析尽量产出所有 facet；
- 契约漂移：产物必须带 schema/version/basis；
- 行为回归：每阶段保持现有测试通过。

### 待定

1. ~~Review 先做质量门，还是直接第五个 Owner？~~ **已定**：先做质量门，不作为第五个 Owner（§13 Phase C）。
2. 论文 ready 后是否自动触发主题分析？（建议否，只标 stale）
3. 观点是否自动生成 draft 链？（建议默认否）
4. 论文分析并发数？（建议 2–3）
5. CardProfile 是否开放 UI 配置？（建议先文件配置，稳定后 UI）
6. ~~runs/events 放 cache 还是备份？~~ **已定**：`cache/agents/runs/`，不备份（§3.2）。

---

## 15. 验收清单

### 本版范围（做完才算收口成功）

- [ ] 4 个 Owner 有明确目录，每个产物有唯一写入者；
- [ ] 路由不再直接改 paper / chain / draft；
- [ ] 产物带 `schema / version / basis`，`basis` 变了能标 stale；
- [ ] run 记录落盘，失败能指到 `paperId / facetKey`；
- [ ] Review 不生成内容；
- [ ] Writing 只读 confirmed；
- [ ] 现有 140 项测试全过；
- [ ] 手工跑通：导入 → 分析 → 建链 → 审核 → 写作。

### 推后（不做，写在这里防止被偷偷加回来）

- [ ] Command / Event / Agent 返回 / 错误码 / 幂等键五套信封；
- [ ] 自动重试矩阵；
- [ ] `/api/litkb/agents`、`/runs`、`/runs/cancel`、`/runs/retry`；
- [ ] 模块目录 UI；
- [ ] Review 作为第五个 Owner。

---

## 附录 A：模型调用点清单

> 依据 v0.16.3 代码实查：14 个 `callModel()` 调用点、12 个业务能力（七段卡占两行）。网关是 `lib/cardgen.js` 的 `callModel()`，模型路由由 `resolveRoute()` 决定：`LITKB_LLM_*` 环境变量 > `settings.llm` 的 fixed > 宿主 `agentDefaultModel`。

| 阶段 | 能力 | 入口 | 调用点 | prompt |
|---|---|---|---|---|
| Intake | 七段卡 | `generateCard` | `lib/cardgen.js:279` | seven-sections.v2 |
| Intake | 七段卡逐段补 | `generateCardSection` | `lib/cardgen.js:332` | seven-sections.v2 |
| Intake | 精读 | `buildDeepRead` | `lib/deepread.js:257`（:260 重试） | deep-read.v1 |
| Intake | 图谱抽取 | `analyzePaper` | `lib/graph.js:350` | graph-extract.v1 |
| Intake | 图谱概念归一 | `modelMappings` | `lib/graph.js:157` | graph-normalize.v1 |
| Intake | 翻译 | `translateBatch` | `lib/translate.js:169` | translate-zh.v1 |
| Research | 研究方向拆分 facet | `/api/litkb/themes/suggest` | `src/server/75-apply-routes-themes.js:660` | 内联 |
| Research | 逐篇 × 逐 facet 抽取 | `extractPaperAnalysis` | `lib/theme-analysis.js:179` | 内联 `EXTRACT_SYSTEM` |
| Research | 逐 facet 观点综合 | `synthesizeFacet` | `lib/theme-analysis.js:372` | 内联 `EXTRACT_SYSTEM` |
| Evidence | 观点 → claim 建议 | `suggestClaim` | `lib/chains.js:459` | chain-claim.v1 |
| Writing | 文稿段落辅助 | `assistDraft` | `lib/drafts.js:315` | write-evidence.v1 |
| 旁路 | 库内问答 | `answerQuestion` | `lib/answer.js:179` | chain-answer.v1 |
| 旁路 | 划词追问 | `askPaper` | `lib/ask.js:213` | ask-page-cited.v1 |

两条结论：

1. **核心链上只有两个**：七段卡和方向分析。其余 10 个都可以失败，而且多数已经写了降级——问答降级为抽取式、图谱归一降级为字符串相似度、研究方向拆分降级为规则拆分。
2. **两个最容易挂的地方都已就地重试**：`generateCardSection` 和方向分析都带「缩粒度重试」，也就是 v0.16.1 / v0.16.3 修的东西。这类重试在代码里是 `for` + `try/catch`，换成模型自主循环会立刻失去落点。

这就是改名和砍编排器的依据。

> 附注：`prompts/seven-sections.v1.md` 已无代码引用，只剩 v2 在用；`lib/index.js` 是 `scripts/build-server.mjs` 拼 `src/server/*.js` 的产物，改代码请改 `src/server/`。
