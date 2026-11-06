# API 参考（v0.1.1）

所有接口前缀：`/api/litkb`；v0.1.x 共注册 **63** 条。请求/响应均为 JSON；PDF 上传为原始 body + `x-filename`；错误统一为：

```json
{ "ok": false, "code": "error_code", "error": "人类可读信息" }
```

## 库 / 健康

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 版本、库路径、统计 |
| GET | `/diag` | 模型、任务、待归一 |
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
| GET | `/chains/review` | 待审核 draft 链 |
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

## 示例

```bash
curl -s http://127.0.0.1:<端口>/api/litkb/health

curl -s -X POST http://127.0.0.1:<端口>/api/litkb/import/link \
  -H 'content-type: application/json' \
  -d '{"value":"2401.12345","kind":"arxiv"}'

curl -s -X POST http://127.0.0.1:<端口>/api/litkb/search/answer \
  -H 'content-type: application/json' \
  -d '{"q":"极坐标对视盘边界有什么用？","limit":10}'
```

> 实际端口以 DSH Web 页面为准；新路由需要重启 DSH 才注册。
