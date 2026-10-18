# XiaoColour

一个以 HTML、CSS 和 JavaScript 为主的综合性网站。GLOBAL PULSE 由同域 Cloudflare Worker 提供新闻代理、定时更新、健康状态和持久缓存。

网站包含个人主页与“GLOBAL PULSE 全球脉搏”实时新闻与情报中心。

## 本地查看

仅预览静态页面时可以直接打开 `index.html`。测试完整新闻服务时先安装依赖并运行 `pnpm dev`，然后访问 Wrangler 输出的本地地址；静态预览会保留浏览器直连 GDELT 的兼容降级，但生产环境应使用 Worker API。

## 文件说明

- `index.html`：个人主页内容与结构
- `styles.css`：页面设计与响应式样式
- `script.js`：年龄计算、滚动动画、时间线和移动端菜单
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
- `tests/news-stability.test.js`：实时、限流、过期缓存、空重大事件与恢复场景测试
- `OPEN_SOURCE_NOTICES.md`：开源许可证、数据来源与署名说明

页面中的年龄、年份和已生活天数会根据当前日期自动更新。

## GLOBAL PULSE 数据

- 全球新闻：GDELT DOC 2.0 公共接口
- M4.5+ 地震：USGS GeoJSON 实时订阅源
- 地图：Leaflet + OpenStreetMap

Cloudflare Cron 每 15 分钟刷新 24 小时和 7 天新闻快照，用户打开页面时优先读取同域 Worker 的最近成功缓存，不再依赖每位访客直接请求 GDELT。上游返回 429、5xx、超时、空响应或格式错误时，系统最多重试两次，间隔 5.5 秒与 11 秒，并保留上一次有效缓存；一分钟冷却期内不会因重复刷新继续冲击失败接口。浏览器缓存只作为最后一级显示降级。

新闻状态严格分为 `live`、`cache`、`stale` 和 `unavailable`。24 小时内的服务器缓存仍可参与今日筛选；超过 24 小时的内容只出现在“历史缓存新闻”，保留原始时间且不会冒充今日 TOP 5。普通新闻与重大事件使用独立结果集，因此重大事件为零不会清空普通新闻。页面的 DATA HEALTH 面板展示最近成功/失败、错误类型、原始/有效/缓存数量以及重大事件数量。

新闻先按规范化 URL 去重，再使用标题词元重合度、字符相似度以及数据源实际提供的摘要聚合同一事件；被聚合的不同媒体报道会保留在新闻详情的“关联报道”中。所有新闻保留原始来源链接。

“今日全球五大焦点”始终从最近 24 小时的独立事件中选择。候选新闻使用 GDELT `HybridRel` 相关性排序获取，再由本地规则综合事件影响信号（最高 30）、独立媒体域名数量（最高 25）、时效性（最高 15）、GDELT 相关性位次（最高 10）、跨地区信号（最高 10）和公共影响主题（最高 10）排序。页面不设置地区配额，也不会仅按发布时间选取；娱乐、体育、生活方式和明显地方性内容会被排除。卡片不展示缺乏上下文的总分，只在数据足够时显示“为什么值得关注”及可核对依据。合格事件不足五条时只显示实际数量。

探索新闻默认使用“精选”排序并只渲染 6 条，点击“查看更多新闻”可逐批访问完整结果；“最新”模式则严格按照事件的真实最新报道时间排序。搜索、地区、分类和时间筛选仍作用于完整事件集合，不会删除后台数据。TOP 5 使用独立的 24 小时事件池，因此切换“最近 1 小时 / 7 天”不会改变其时间口径。

页面默认使用 Midnight Intelligence 深色主题，也支持浅色模式。新闻图片按需加载，搜索采用防抖处理，地图进入视野后才加载。分类、地区和时间范围都使用同一份标准化新闻数据，不会在各个 UI 组件中重复请求接口。

GDELT DOC 接口只提供新闻标题和元数据，因此页面不会虚构正文摘要，也不会在没有可靠翻译服务时编造中文标题。非中文新闻明确标记“未接入翻译 · 显示原文”，并在关联报道中保留各媒体原始标题。地图中的蓝色圆点明确表示媒体来源国聚合，不被描述为事件发生坐标；只有 USGS 地震使用数据源提供的真实经纬度。地图周围的更新时间、地震数量和媒体地区数量均由当前载入数据计算。

TOP 5、60秒速览、普通新闻卡片和相关新闻默认进入 `global/news.html?id=<event-id>` 站内阅读页，支持直接链接与浏览器返回。详情页提供中文界面的事件摘要、可核对元数据、涉及地区、重要性说明、报道时间线、媒体标题对比、相关新闻和来源列表；同时按需读取 GDELT Context 2.0 明确提供的短上下文片段。详情页没有 iframe、第三方媒体脚本或自动跳转，只有页面底部由用户主动点击的“查看原始报道”会打开第三方网站。项目没有可用翻译或 AI 服务时保留原文并明确标注，不把规则整理冒充翻译或 AI 新闻正文。

`data/news-cache.json` 是开发时从 GDELT 获取的真实新闻快照，只用于首次访问且实时接口不可用、浏览器中又没有成功缓存的情况。界面会明确标记快照状态与实际时间，不把它伪装成实时内容。

当前项目没有后端、数据库或安全的模型密钥存储，因此 AI 摘要功能不会伪造启用。“60秒看懂今天的世界”当前明确标注为基于真实新闻标题与元数据的非 AI 热点速览。若将来接入模型，必须通过服务端代理保存密钥，不得在 `global.js` 中填写密钥。

当前源码中没有蓝色 AI 悬浮助手组件或第三方聊天挂件脚本；网站自身的返回顶部按钮与状态提示均固定在右下角。若悬浮助手来自托管平台或浏览器注入，需要在其所属平台配置中调整停靠、最小化与关闭行为，不能通过本站源码安全控制跨域组件。

## Cloudflare 部署

1. 登录目标 Cloudflare 账号，安装依赖：`pnpm install`。
2. 创建持久化缓存：`pnpm wrangler kv namespace create GLOBAL_PULSE_CACHE`。
3. 将命令返回的 namespace `id` 添加到 `wrangler.jsonc` 的 `kv_namespaces`，binding 必须为 `GLOBAL_PULSE_CACHE`。不要把 API Token 或其他 Secret 写入仓库。
4. 先运行 `pnpm test` 和 `pnpm wrangler deploy --dry-run`，再运行 `pnpm deploy`。
5. 部署后验证 `/api/news?time=1d`、`/api/news/health` 和 `/global`；在 Cloudflare 控制台确认 Cron `*/15 * * * *` 与 Worker Logs 正常。

未绑定 KV 时 Worker 会临时使用 Cache API，方便本地调试，但该缓存不是可靠的跨机房持久存储，不能作为生产完成状态。详细运维与故障判断见 `GLOBAL_PULSE_OPERATIONS.md`。

详细许可与署名信息见 `OPEN_SOURCE_NOTICES.md`。
