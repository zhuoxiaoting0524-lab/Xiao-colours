# XiaoColour

一个以 HTML、CSS 和 JavaScript 为主的综合性网站。GLOBAL PULSE 由同域 Cloudflare Worker 提供新闻代理、定时更新、健康状态和持久缓存。

网站包含个人主页与“GLOBAL PULSE 全球脉搏”实时新闻与情报中心。

## 本地查看

仅预览静态页面时可以直接打开 `index.html`，或运行：

```bash
npx --yes serve -l 43127 .
```

测试完整新闻服务时先安装依赖并运行 `pnpm dev`，然后访问 Wrangler 输出的本地地址；静态预览会保留浏览器直连 GDELT 的兼容降级，但生产环境应使用 Worker API。

```bash
pnpm install
pnpm dev
```

## 个人模块

手绘 Welcome + Journal / Gallery / Collections。现已加入**邀请制多用户账户（第一阶段）**：

- 密码：Web Crypto **PBKDF2-SHA-256**（100k 迭代（Cloudflare Workers 上限））
- Session：存 **D1**；Cookie `HttpOnly` + `Secure` + `SameSite=Lax`
- 邀请：管理员生成，7 天有效，单次使用，可撤销
- 每人独立空白 Journal / Gallery / Collections 壳子
- Global Pulse 与其 KV **未改动**
- R2 仅预留架构，本阶段不接上传

详见 `docs/MULTIUSER_PHASE1.md`。

## 文件说明

- `index.html`：个人主页内容与结构
- `styles.css`：页面设计与响应式样式
- `script.js`：个人空间切换与动画
- `favicon.svg`：浏览器标签页图标
- `global.html`：全球动态监控页面
- `global.css`：监控中心、地图和移动端样式
- `global.js`：GLOBAL PULSE 页面入口与状态协调
- `global/config.js`：数据源、分类规则、时间范围与地图位置配置
- `global/data-service.js`：GDELT / USGS 数据适配、去重、缓存和降级逻辑
- `global/gdelt-client.js`：GDELT 公共接口节流与安全 JSON 解析
- `global/news-quality.js`：规范化 URL、标题/可用摘要相似度、多来源事件聚合与透明重要性评分
- `global/components.js`：TOP 5、60秒速览、新闻卡片、筛选、简报和更新时间组件
- `global/news.html`：可直接访问的站内新闻详情页
- `global/news-page.js`：详情加载、事件摘要、来源对比、报道时间线与错误状态
- `global/news-reader.js`：详情链接、事件定位和 GDELT Context 短片段适配
- `global/map.js`：Leaflet 按需加载、图层、标记与事件弹窗
- `worker/index.js`：同域新闻 API、静态资源分发与 Cloudflare Cron 入口
- `worker/news-cache.js`：GDELT 校验、有限重试、健康记录及 KV/Cache API 存储
- `wrangler.jsonc`：Cloudflare Worker、静态资源、定时任务和可观测性配置
- `GLOBAL_PULSE_OPERATIONS.md`：数据运维与健康状态说明
- `OPEN_SOURCE_NOTICES.md`：开源许可证、数据来源与署名说明

## GLOBAL PULSE 数据

- 全球新闻：GDELT DOC 2.0 公共接口
- M4.5+ 地震：USGS GeoJSON 实时订阅源
- 地图：Leaflet + OpenStreetMap

Cloudflare Cron 每 15 分钟刷新 24 小时和 7 天新闻快照。详细运维与故障判断见 `GLOBAL_PULSE_OPERATIONS.md`。

详细许可与署名信息见 `OPEN_SOURCE_NOTICES.md`。

## Cloudflare 部署

当前 Cloud Agent 环境没有 Cloudflare 登录态，**无法替你直接发布到** `xiao-colours.*.workers.dev`。请在本机或已登录 Cloudflare 的环境执行：

```bash
# 1. 拿到这份改版代码（从 Cursor 项目导出 / 拉取仓库）
pnpm install

# 2. 登录 Cloudflare（浏览器授权一次即可）
pnpm exec wrangler login

# 3. 确认不会误传 node_modules（仓库已含 .assetsignore）
pnpm exec wrangler deploy --dry-run

# 4. 发布到现有 Worker 名称 xiao-colours
pnpm deploy
```

首次绑定 KV（若尚未创建）：

1. `pnpm wrangler kv namespace create GLOBAL_PULSE_CACHE`
2. 把返回的 namespace `id` 写入 `wrangler.jsonc` 的 `kv_namespaces`
3. 不要把 API Token 或其他 Secret 写入仓库

发布后请打开：

- 首页是否变为 Welcome + Journal / Gallery / Collections
- `/global`、`/api/news?time=1d`、`/api/news/health`
- Cloudflare 控制台确认 Cron `*/15 * * * *`

未绑定 KV 时 Worker 会临时使用内存缓存，方便本地调试，但不能作为生产完成状态。
