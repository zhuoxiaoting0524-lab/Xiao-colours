# 开源与数据来源说明

## World Monitor

“GLOBAL PULSE 全球脉搏”页面的产品思路与信息架构参考了 [World Monitor](https://github.com/koala73/worldmonitor)。World Monitor 源代码采用 **AGPL-3.0-only** 许可证，版权归原作者及贡献者所有。

当前实现没有复制或打包 World Monitor 的源代码，也没有使用其官方商标、标识、付费 API 或需要授权的密钥。页面底部保留了项目名称、源码链接和许可证背景说明。如果未来直接合并、修改或网络提供 World Monitor 的 AGPL 源码，应按适用的 AGPL-3.0 要求向用户提供对应源代码。

## 实时新闻：GDELT Project

- 接口：GDELT DOC 2.0 API
- 用途：检索和展示全球公开新闻标题、来源媒体、发布时间、媒体来源国、语言与原始链接
- 官方网站：https://www.gdeltproject.org/
- 接口文档：https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

页面不会把 GDELT 的“媒体来源国”描述为“事件发生地”。搜索关键词会发送给 GDELT 公共接口。

浏览器通过 GDELT 官方支持 CORS 的 JSON 接口读取数据。请求之间至少间隔 5.5 秒，避免对公共服务重复施压。点击新闻后直接在新标签页打开媒体原始报道；本站不抓取、绕过付费墙或转载第三方新闻全文。

## 自然事件：USGS

- 接口：USGS Earthquake Hazards Program GeoJSON Summary Feeds
- 用途：展示最近 1 小时、24 小时或 7 天内 M4.5+ 地震
- 官方文档：https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

## 地图

- 交互组件：Leaflet 1.9.4（BSD-2-Clause）
- 底图与地图数据：© OpenStreetMap contributors
- 版权说明：https://www.openstreetmap.org/copyright

GLOBAL PULSE 继续使用上述 Leaflet 实现，不受私人空间改版影响。

### Footprints 私人足迹地图

- 交互组件：MapLibre GL JS 6.16.0（BSD-3-Clause）
- 地图样式与瓦片：OpenFreeMap 公共实例（Liberty / Positron）
- 地形高程：Mapterhorn 公共 `raster-dem` 服务
- 地图数据：© OpenStreetMap contributors
- 地点搜索：OpenStreetMap Foundation 的 Nominatim 公共服务
- MapLibre：https://maplibre.org/maplibre-gl-js/docs/
- OpenFreeMap：https://openfreemap.org/
- Nominatim 使用政策：https://operations.osmfoundation.org/policies/nominatim/

Footprints 不需要 API Key，也没有接入 Mapbox 或其他付费地图服务。常见中英文地点别名的候选在本地完成；公共 Nominatim 查询只在已登录用户主动提交时发起，不做逐键远程自动补全。Worker 将规范化查询散列后缓存结果，并以全站最多约每秒一次的频率访问公共 Nominatim 服务。搜索词会发送给 OpenStreetMap Foundation 的服务，因此不应在地点搜索框输入私密文字。界面保留地图署名；若访问量增长，应迁移到自托管或具有明确服务保障的地理编码服务。

## AI 分析

当前项目没有服务端模型接口，因此 AI 摘要功能保持关闭。页面中的“态势概览”仅对已获取的新闻数量、媒体数量、来源国和规则分类进行统计，不冒充 AI 分析或事实核验。
