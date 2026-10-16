# 卓潇婷的个人简介网站

一个纯 HTML、CSS 和 JavaScript 制作的响应式个人网站，无需安装任何构建依赖。

网站包含个人主页与“GLOBAL PULSE 全球脉搏”实时新闻与情报中心。

## 本地查看

直接双击 `index.html`，或在项目目录运行任意静态文件服务器即可。

## 文件说明

- `index.html`：个人主页内容与结构
- `styles.css`：页面设计与响应式样式
- `script.js`：年龄计算、滚动动画、配色切换和移动端菜单
- `favicon.svg`：浏览器标签页图标
- `global.html`：全球动态监控页面
- `global.css`：监控中心、地图和移动端样式
- `global.js`：GLOBAL PULSE 页面入口与状态协调
- `global/config.js`：数据源、分类规则、时间范围与地图位置配置
- `global/data-service.js`：GDELT / USGS 数据适配、去重、缓存和降级逻辑
- `global/news-quality.js`：规范化 URL 去重、标题相似度计算和多来源事件聚合
- `global/components.js`：头条、新闻卡片、筛选、简报和更新时间组件
- `global/map.js`：Leaflet 按需加载、图层、标记与事件弹窗
- `OPEN_SOURCE_NOTICES.md`：开源许可证、数据来源与署名说明

页面中的年龄、年份和已生活天数会根据当前日期自动更新。

## GLOBAL PULSE 数据

- 全球新闻：GDELT DOC 2.0 公共接口
- M4.5+ 地震：USGS GeoJSON 实时订阅源
- 地图：Leaflet + OpenStreetMap

页面每 15 分钟自动刷新，并在接口临时不可用时显示浏览器中最近一次成功更新的内容。新闻先按规范化 URL 去重，再使用标题词元重合度与字符相似度聚合同一事件；被聚合的不同媒体报道会保留在新闻详情的“关联报道”中。所有新闻保留原始来源链接。

页面默认使用 Midnight Intelligence 深色主题，也支持浅色模式。新闻图片按需加载，搜索采用防抖处理，地图进入视野后才加载。分类、地区和时间范围都使用同一份标准化新闻数据，不会在各个 UI 组件中重复请求接口。

GDELT DOC 接口只提供新闻标题和元数据，因此页面不会虚构正文摘要，也不会在没有可靠翻译服务时编造中文标题。地图中的蓝色圆点明确表示媒体来源国聚合，不被描述为事件发生坐标；只有 USGS 地震使用数据源提供的真实经纬度。地图周围的更新时间、地震数量和媒体地区数量均由当前载入数据计算。

`data/news-cache.json` 是开发时从 GDELT 获取的真实新闻快照，只用于首次访问且实时接口不可用、浏览器中又没有成功缓存的情况。界面会明确标记快照状态与实际时间，不把它伪装成实时内容。

当前项目没有后端、数据库或安全的模型密钥存储，因此 AI 摘要功能不会伪造启用。若将来接入模型，必须通过服务端代理保存密钥，不得在 `global.js` 中填写密钥。

## 部署

这是静态网站，可以直接部署到 GitHub Pages、Netlify、Vercel 静态托管或普通 Web 服务器：

1. 将仓库根目录作为静态发布目录。
2. 确保 `index.html`、`global.html` 及其 CSS/JS 文件保持同级。
3. 不需要环境变量，也不要在前端加入 API Key。
4. 部署后检查托管平台是否允许访问 GDELT、USGS、unpkg 和 OpenStreetMap 资源。

详细许可与署名信息见 `OPEN_SOURCE_NOTICES.md`。
