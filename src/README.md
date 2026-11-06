# 源码结构

`lib/` 是可加载产物，`src/` 是维护源。

## 客户端

`src/client/00-base.js` → `70-apply.js` 是**同一个 factory 作用域内的片段**，不是独立 ES 模块。
`scripts/build-client.mjs` 按文件名排序拼接为 `lib/client.js`，保持 DSH `window.__ModuleLoader__.load` 的单文件加载方式。

| 片段 | 内容 |
|---|---|
| `00-base` | React、常量、openState、通用 helper |
| `10-library` | Entry / LibraryPage / Settings / Workspace / PaperList / Detail / DeepRead |
| `20-reading` | 七段卡、PDF、PdfRail、解析稿、Markdown |
| `30-writing-search` | 检索页、写作页 |
| `40-chain` | 建链弹窗、标签管理、追问 |
| `45-graph` | 证据链图、概念图、自动建链、横向 |
| `50-misc` | 概念队列、Empty |
| `60-styles` | 全部 CSS |
| `70-apply` | slots 注册、ModuleLoader 出口 |

## 服务端

`src/server/00-imports.js` → `80-apply-routes-writing.js` 按文件名拼接为 `lib/index.js`。

## 构建

```bash
npm run build
npm test
npm run check
```

不要直接编辑 `lib/client.js` / `lib/index.js`；它们是生成文件。
