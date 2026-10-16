# 卓潇婷的个人简介网站

一个纯 HTML、CSS 和 JavaScript 制作的响应式个人网站，无需安装任何构建依赖。

网站包含个人主页与“全球动态”实时新闻监控中心。

## 本地查看

直接双击 `index.html`，或在项目目录运行任意静态文件服务器即可。

## 文件说明

- `index.html`：个人主页内容与结构
- `styles.css`：页面设计与响应式样式
- `script.js`：年龄计算、滚动动画、配色切换和移动端菜单
- `favicon.svg`：浏览器标签页图标
- `global.html`：全球动态监控页面
- `global.css`：监控中心、地图和移动端样式
- `global.js`：实时新闻、地震、地图联动、筛选、缓存与自动更新
- `OPEN_SOURCE_NOTICES.md`：开源许可证、数据来源与署名说明

页面中的年龄、年份和已生活天数会根据当前日期自动更新。

## 全球动态数据

- 全球新闻：GDELT DOC 2.0 公共接口
- M4.5+ 地震：USGS GeoJSON 实时订阅源
- 地图：Leaflet + OpenStreetMap

页面每 15 分钟自动刷新，并在接口临时不可用时显示浏览器中最近一次成功更新的内容。新闻根据规范化 URL 去重；所有新闻保留原始来源链接。

`data/news-cache.json` 是开发时从 GDELT 获取的真实新闻快照，只用于首次访问且实时接口不可用、浏览器中又没有成功缓存的情况。界面会明确标记快照状态与实际时间，不把它伪装成实时内容。

当前项目没有后端、数据库或安全的模型密钥存储，因此 AI 摘要功能不会伪造启用。若将来接入模型，必须通过服务端代理保存密钥，不得在 `global.js` 中填写密钥。

## 部署

这是静态网站，可以直接部署到 GitHub Pages、Netlify、Vercel 静态托管或普通 Web 服务器：

1. 将仓库根目录作为静态发布目录。
2. 确保 `index.html`、`global.html` 及其 CSS/JS 文件保持同级。
3. 不需要环境变量，也不要在前端加入 API Key。
4. 部署后检查托管平台是否允许访问 GDELT、USGS、unpkg 和 OpenStreetMap 资源。

详细许可与署名信息见 `OPEN_SOURCE_NOTICES.md`。
