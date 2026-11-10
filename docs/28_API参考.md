# API 参考（v0.15.1）

所有接口前缀：`/api/litkb`；v0.15.1 共注册 **86** 条。请求/响应均为 JSON；PDF 上传为原始 body + `x-filename`；备份恢复为原始 zip body；错误统一为：

```json
{ "ok": false, "code": "error_code", "error": "人类可读信息" }
```

## 产品化（v0.15.1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/onboarding` | 上手里程碑：items / completed / next / counts |
| GET | `/backup` | 整库 zip 下载（含 manifest；排除 settings.json 与 cache/） |
| POST | `/restore?confirm=restore` | 原始 zip body；校验后覆盖，覆盖前自动快照 |
| GET | `/diag` | 版本、模型、任务、运行时、库计数、最近快照 |

恢复错误码：`confirm_required`(428)、`restore_busy`(409)、`too_large`(413)、`bad_zip`/`bad_entry`/`bad_manifest`/`no_data`(422)。

## 入库自动管线（v0.15.1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ingest` | 最近 20 条任务；`?id=` 查单篇，没有任务返回 `job:null` |
| POST | `/ingest` | `{id}` 手动补全：已有解析/卡片/精读自动跳过 |
| GET | `/diag` | 额外返回 `ingest`（最近 5 条） |

导入响应（`POST /import`、`POST /import/link`）新增 `ingest` 字段；`autoIngest:false` 时为 `null`。

任务状态：`queued → running → done | partial | failed`；`steps.blocks/card/deepread` 各有 `done / running / skipped / failed`。

## 删除论文（v0.15.1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/delete?id=` | 影响面：cards/blocks/deepread/translations/files/chains/chainsRemoved/chainsUpdated/themes/drafts |
| POST | `/delete` | `{id, confirm:true}` 执行删除；缺少 confirm 返回 428；有解析/卡片/精读任务在跑返回 409 `busy` |

删除范围：index、PDF、text、blocks、卡片 JSON/MD/历史版本、译文、精读、`concepts/papers`、`cache/pages/<id>/`。
证据链：只引用该论文的链删除；跨论文链移除该论文节点后保留；研究 `papers.include/exclude/lastMatch` 同步移除。

## 工作台模型（v0.15.1）

`GET /settings` 返回 `settings.llm`：

```json
{ "llm": { "mode": "fixed", "provider": "deepseek-official", "model": "deepseek-v4-pro" } }
```

`POST /settings` 可写：

```json
{ "llm": { "mode": "fixed", "provider": "deepseek-official", "model": "deepseek-v4-pro" } }
```

- `mode=fixed`：七段卡/精读/翻译/检索答案/主题建链/图谱抽取全部走该路由；
- `mode=host`：跟随 DSH 默认模型；
- 环境变量 `LITKB_LLM_PROVIDER` / `LITKB_LLM_MODEL` 优先级最高；
- DeepSeek V4 的 `reasoningEffort: off` 自动升为 `high`。

## 库 / 健康

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 版本、库路径、统计 |
| GET | `/diag` | 模型、任务、待归一、runtime / library / backup |
| GET | `/papers` | 论文列表 + stats |
| GET | `/settings` / POST | 设置读取/保存 |
| GET | `/tags` / POST | 标签读取/创建 |
| POST | `/tags/delete` | 删除标签 |
| POST | `/reclassify` | 重新打标 |
| POST | `/update` | 更新论文元数据/状态 |
| GET | `/export` | BibTeX/GB-T/卡片/图等导出 |

## 收文

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/import` | 原始 PDF body，header `x-filename` |
| POST | `/import/link` | `{value, kind?: 'auto'|'url'|'doi'|'arxiv'}`；下载 PDF + Crossref/HTML 元数据，SHA 去重 |

## 解析 / 卡片 / 翻译

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/blocks` | 解析稿块 |
| POST | `/blocks/build` | 构建解析稿（PaddleOCR/pdf.js） |
| GET | `/blocks.md` | 解析稿 Markdown |
| GET | `/page` | 页图 PNG |
| GET | `/pdf` | 原 PDF |
| GET | `/card` | 七段卡 + 任务 |
| POST | `/card/generate` | 整卡生成/重生成 |
| POST | `/card/section` | 单段编辑 |
| POST | `/card/annotate` | 批注 |
| POST | `/card/status` | 卡片状态 |
| POST | `/card/regenerate` | 整卡/单段重生成 |
| GET | `/card/versions` | 版本列表 |
| POST | `/card/restore` | 回滚 |
| GET/POST | `/translate` | 翻译读取/提交 |
| GET/POST | `/glossary` | 术语表 |
| GET | `/evidence/search` | 子串证据搜索（兼容旧 UI） |
| GET | `/evidence/export` | JSON/CSV |
| GET | `/evidence/backlinks` | 反链 |

## 精读 / 图谱 / 对比

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/deepread?id=` | 单篇精读 |
| POST | `/ask` | 单篇追问（可带 selection） |
| POST | `/deepread/build` | 后台构建精读 |
| GET | `/deepread/compare?ids=p1,p2` | 横向精读：合并 11 板块，返回每篇 section markdown |
| POST | `/deepread/section` | `{id,key,markdown}` 只改精读某一段并重算整篇 |
| GET | `/graph` | 概念图谱数据（UI 暂停用） |
| POST | `/graph/build` | 图谱抽取 |
| GET | `/concepts` | 概念词表 |
| POST | `/concepts/merge` | 合并概念 |
| POST | `/concepts/update` | 更新概念 |
| GET | `/compare` | 可比组 |

## 证据链

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/chains` | 链列表 |
| GET | `/chains/read?id=` | 单条链（含 stale） |
| GET | `/chains/claims?paperId=` | 精读论点候选 |
| POST | `/chains/propose` | 生成草稿（claim/evidence/question/block） |
| POST | `/chains/save` | 保存 |
| POST | `/chains/delete` | 删除 |
| POST | `/chains/insert` | 插入文稿（`append:true` 新建/追加） |
| POST | `/chains/auto/run` | 后台自动建链：`{scope,paperIds,sections,mode:'paper'|'cross',topic,autoConfirm}` |
| GET | `/chains/auto/jobs?id=` | 任务进度 |
| GET | `/chains/review` | 待审核 draft 链（`?origin=topic` 只看主题链） |
| POST | `/chains/review/batch` | `{ids,action:'accept'|'reject'}`，逐条结果 |
| POST | `/chains/dedupe` | `{themeId}`，按 facet 合并重复 confirmed |
| POST | `/chains/review` | `{id,action:'accept'|'reject'|'merge',targetId?}` |
| GET | `/chains/graph` | 证据链知识库图 |
| POST | `/chains/layout` | 保存图坐标 |
| GET | `/vendor/cytoscape.js` | 本地 Cytoscape |

## 检索 / 问答 / 历史

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/search` | `{q,filters,limit}` → evidence + chains + took |
| GET/POST | `/search/answer` | 链优先答案：answer/citations/chains/trace |
| GET | `/search/history?limit=` | 最近检索（最多 50，默认 20） |

## 写作

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/drafts` | 文稿列表/新建 |
| GET/POST | `/drafts/read` | 读取 |
| POST | `/drafts/save` | 保存 |
| POST | `/drafts/delete` | 删除 |
| GET | `/drafts/export` | MD 导出 |
| GET | `/drafts/citations` | 引用/缺失 |
| POST | `/drafts/assist` | 按证据 AI 扩写 |

## 研究工作台（v0.2.0）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/themes` | 研究列表 + 统计（论文/链/缺口/待审/写作） |
| GET | `/themes/read?id=` | 研究详情：theme（含 match）、chains、facetChains、stats、papers、summaryState、draft |
| POST | `/themes/save` | 新建/更新（facets 全量覆盖，key 保留） |
| POST | `/themes/delete` | 删除研究（链与文稿保留） |
| POST | `/themes/match` | 匹配预览；`persist:true` 写 lastMatch |
| POST | `/themes/chain` | 生成主题链草稿（任务），返回 job |
| POST | `/themes/explore` | 一次完成匹配 + 建链，返回 match 与 job；使用 theme.match |
| GET | `/themes/jobs?id=` | 任务进度；不带 id 返回最近 20 条 |
| POST | `/themes/jobs/cancel` | `{id}` 取消排队/运行中的主题任务 |
| POST | `/themes/papers` | 手动加入/移出/恢复论文（`action`） |
| POST | `/themes/outline` | 生成提纲；`mode`=new/append/replace 写入文稿 |
| POST | `/themes/summary` | 不带 text 生成结论；带 text 保存 |
| POST | `/themes/suggest` | 拆分细分描述（有模型走模型，无模型模板） |

**研究对象**

```json
{
  "id": "t-1a2b3c4d",
  "title": "多模态大模型在医学影像诊断中的应用",
  "description": "综述第二章",
  "tags": ["医学影像"],
  "facets": [
    { "key": "f1", "title": "多模态融合方式", "description": "…", "keywords": ["fusion"], "mode": "compare", "enabled": true }
  ],
  "papers": { "include": [], "exclude": [], "lastMatch": { "at": "…", "papers": [] } },
  "draftId": "d-9a8b7c6d",
  "summary": { "text": "", "updatedAt": null, "model": null }
}
```

主题链：`origin: "topic"`，`provenance: { themeId, facetKey, runId, matcher, query, tokens }`；审核用 `GET /chains/review?origin=topic`。

## 示例

```bash
curl -s http://127.0.0.1:<端口>/api/litkb/health

curl -s -X POST http://127.0.0.1:<端口>/api/litkb/import/link \
  -H 'content-type: application/json' \
  -d '{"value":"2401.12345","kind":"arxiv"}'

curl -s -X POST http://127.0.0.1:<端口>/api/litkb/search/answer \
  -H 'content-type: application/json' \
  -d '{"q":"极坐标对视盘边界有什么用？","limit":10}'

# 整库备份 / 恢复
curl -s -o litkb-backup.zip http://127.0.0.1:<端口>/api/litkb/backup
curl -s -X POST 'http://127.0.0.1:<端口>/api/litkb/restore?confirm=restore' \
  -H 'content-type: application/zip' --data-binary @litkb-backup.zip
```

> 实际端口以 DSH Web 页面为准；新路由需要重启 DSH 才注册。
