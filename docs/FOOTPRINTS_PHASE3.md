# Footprints 第三阶段实现说明

## 范围

本阶段只把已确认的 Footprints 原型接入正式项目代码。Home、Little Notes、My Days、登录邀请系统、旧 Journal/Gallery/Collections 数据和 GLOBAL PULSE 均不重新设计。

## 技术方案

- 地图：MapLibre GL JS 6.15.0。
- 底图：OpenFreeMap `liberty` 样式，保留 MapLibre 自动生成的地图署名。
- 搜索：登录后的 Worker 代理请求 Nominatim。仅在用户提交搜索时请求，不做自动补全。
- 搜索保护：查询散列缓存 30 天；D1 全局限速间隔 1.1 秒；上游超时 8 秒；上游故障不影响已有足迹读取。
- 持久化：D1 `footprints` 表，所有查询和写入都强制带当前 `session.user.id`。
- 界面：沿用已验收的 Footprints 排版；移动端地图保持触控，地点详情显示为底部面板。

## 新增接口

- `GET /api/me/footprints`
- `GET /api/me/footprints?status=visited|wish`
- `POST /api/me/footprints`
- `PATCH /api/me/footprints/:id`
- `DELETE /api/me/footprints/:id`
- `GET /api/me/footprints/search?q=...`

所有接口都要求有效登录会话；写接口同时检查同源请求与 CSRF token。按 id 更新或删除时，SQL 同时限制 `id` 和 `user_id`，跨账户请求返回 404。

## 数据库迁移

迁移文件为 `migrations/0005_footprints.sql`，只新增：

- `footprints`
- `geocode_cache`
- `geocode_rate_state`

迁移不修改或删除已有表和数据。当前阶段只允许应用到本地 D1；生产 D1 必须在确认备份、影响范围并获得用户明确同意后执行。

## 外部资源和费用

当前方案不需要付费项目、R2、地图 API Key 或新账户。OpenFreeMap 公共服务和公共 Nominatim 适合当前小型私人站点原型，但它们不是带 SLA 的商业服务。若未来公开流量明显增加，需要重新评估自托管或服务商方案，涉及费用前必须先取得确认。

## 本地验收

1. 应用迁移：`npm run db:local`
2. 启动 Worker：`npm run dev -- --port 45454`
3. 运行静态检查和单元测试：`npm run check && npm test`
4. 运行第二阶段回归：`npm run test:personal-space`
5. 运行 Footprints 隔离与持久化测试：`npm run test:footprints`

地点搜索需要联网；自动化测试不向公共 Nominatim 发送真实查询，真实地图和搜索通过浏览器手动验收。
