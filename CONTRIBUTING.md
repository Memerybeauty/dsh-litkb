# Contributing

## 开发

```bash
npm install
npm run build
npm test
npm run check
```

- `lib/` 是生成产物，不要直接编辑；
- 客户端源码：`src/client/*.js`，由 `scripts/build-client.mjs` 按文件名拼接；
- 服务端源码：`src/server/*.js`，由 `scripts/build-server.mjs` 拼接；
- 新增路由后：重启 DSH，再更新 `tests/plugin-smoke.mjs` 的路由列表；
- 新增页面/组件时注意 CSS 类名不要复用旧组件名。

## 提交

- 一个提交只做一件事；
- 信息用 `feat: ...` / `fix: ...` / `docs: ...` / `refactor: ...`；
- 提交前必须 `npm test` 通过。

## 数据

不要把 `~/Documents/文献库`、PDF、卡片、截图中的个人信息提交进仓库。
