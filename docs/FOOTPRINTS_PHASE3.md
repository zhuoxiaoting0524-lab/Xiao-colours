# Footprints 3D 地球升级实现说明

## 范围

本阶段只升级 Footprints。Home、My Days、登录邀请系统、旧 Journal/Gallery/Collections 数据和 GLOBAL PULSE 均不重新设计。

## 技术方案

- 地图：MapLibre GL JS 6.16.0。默认使用真正的 `globe` 球形投影，可旋转、缩放和触摸操作。
- 底图：OpenFreeMap `liberty`（真实地球/地形）与 `positron`（柔和地图），保留地图署名。
- 地形：Mapterhorn `raster-dem`，仅在地形模式启用；使用墨卡托投影以兼容 3D Terrain。
- 回退：WebGL 或 3D 资源不可用时，自动加载 Leaflet + OpenStreetMap 二维交互地图；若二维地图也失败，会显示错误和重试按钮，不使用静态假地图。
- 搜索：登录后的 Worker 代理请求 Nominatim。遵守公共服务政策，只在用户明确提交时请求，不向 Nominatim 发送逐键自动补全请求。
- 本地候选：常见国家/城市的中英文别名在浏览器本地提供 300ms 防抖候选，例如日本/Japan、巴黎/Paris；中英文别名使用同一稳定地点标识和经纬度。
- 搜索保护：查询散列缓存 30 天；D1 全局限速间隔 1.1 秒；上游超时 8 秒；上游故障不影响已有足迹读取。
- 持久化：D1 `footprints` 表，保存中英文名称、国家 ISO 代码、经纬度、地点类别与状态；所有查询和写入都强制带当前 `session.user.id`。
- 私人照片：每条足迹可保存一张用户主动选择的封面。浏览器先压缩为不超过 700KB 的 WebP，再写入 D1 私有 BLOB；读取、替换和删除均校验当前用户，不使用 R2 或付费存储。
- 界面：左侧地图约 65%，右侧记录约 35%；移动端改为地图优先的纵向布局，地点详情显示为底部面板。

## 新增接口

- `GET /api/me/footprints`
- `GET /api/me/footprints?status=visited|wish`
- `POST /api/me/footprints`
- `PATCH /api/me/footprints/:id`
- `DELETE /api/me/footprints/:id`
- `GET /api/me/footprints/search?q=...`
- `GET /api/me/footprints/:id/photo`
- `PUT /api/me/footprints/:id/photo`
- `DELETE /api/me/footprints/:id/photo`

所有接口都要求有效登录会话；写接口同时检查同源请求与 CSRF token。按 id 更新或删除时，SQL 同时限制 `id` 和 `user_id`，跨账户请求返回 404。

## 数据库迁移

基础迁移 `migrations/0005_footprints.sql` 只新增：

- `footprints`
- `geocode_cache`
- `geocode_rate_state`

升级迁移 `migrations/0006_footprints_globe.sql` 只新增规范化地点字段和 `footprint_photos` 表。两份迁移均不删除旧表或已有数据。

2026-10-26 的只读生产检查确认：线上 D1 仍未执行 `0005_footprints.sql`，因此旧页面出现“Footprints 数据表尚未初始化”。`0005` 与 `0006` 已在全新的本地 D1 连续执行并通过；生产 D1 必须在确认备份、影响范围并获得用户明确同意后执行。

## 外部资源和费用

当前方案不需要 Mapbox Token、付费项目、R2 或新账户。Mapbox Geocoding 的永久结果存储涉及计费条件，不适合当前“不得使用付费项目”的约束，因此没有接入。OpenFreeMap、Mapterhorn 和公共 Nominatim 适合当前小型私人站点，但它们不是带 SLA 的商业服务。若未来流量明显增加，需要重新评估自托管或服务商方案，涉及费用前必须先取得确认。

## 本地验收

1. 应用迁移：`npm run db:local`
2. 启动 Worker：`npm run dev -- --port 45454`
3. 运行静态检查和单元测试：`npm run check && npm test`
4. 运行第二阶段回归：`npm run test:personal-space`
5. 运行 Footprints 隔离、规范化地理字段、私人照片与持久化测试：`npm run test:footprints`

地点搜索需要联网；自动化测试不向公共 Nominatim 发送真实查询。浏览器手动验收覆盖：真实球形地球、柔和地图、地形模式、日本/Japan、巴黎/Paris、地图定位及响应式布局。
