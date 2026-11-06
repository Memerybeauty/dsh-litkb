# Vendor

| 文件 | 来源 | 版本 | 许可 |
|---|---|---|---|
| `cytoscape.min.js` | https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js | 3.30.4 | MIT（文件头保留版权与许可声明） |

服务端通过 `GET /api/litkb/vendor/cytoscape.js` 原样返回，客户端首次进入「证据链知识库」时懒加载；
不走 CDN，离线可用。升级时替换文件并同步 `docs/05` 的版本记录。
