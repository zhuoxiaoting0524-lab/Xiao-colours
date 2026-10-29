# 开源与数据来源说明

## World Monitor

“GLOBAL PULSE 全球脉搏”页面的产品思路与信息架构参考了 [World Monitor](https://github.com/koala73/worldmonitor)。World Monitor 源代码采用 **AGPL-3.0-only** 许可证，版权归原作者及贡献者所有。

当前实现没有复制或打包 World Monitor 的源代码，也没有使用其官方商标、标识、付费 API 或需要授权的密钥。页面底部保留了项目名称、源码链接和许可证背景说明。如果未来直接合并、修改或网络提供 World Monitor 的 AGPL 源码，应按适用的 AGPL-3.0 要求向用户提供对应源代码。

## 实时新闻：公开 RSS 来源

GLOBAL PULSE 的 Worker 定时读取以下媒体公开提供的 RSS 新闻源：

- BBC World：https://feeds.bbci.co.uk/news/world/rss.xml
- Al Jazeera：https://www.aljazeera.com/xml/rss/all.xml
- The Guardian World：https://www.theguardian.com/world/rss
- NPR World：https://feeds.npr.org/1004/rss.xml

本站仅整理 RSS 中公开提供的标题、摘要、发布时间、媒体名称、封面地址与原始链接，不抓取、绕过付费墙或转载第三方新闻全文。点击新闻后直接在新标签页打开对应媒体的具体原始报道。新闻源暂时失败时，系统继续显示最近一次成功保存的数据，并保留每个来源的健康状态；失败响应不会覆盖有效缓存。

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

## Overview 天气与城市搜索

- 天气预报与城市时区：Open-Meteo Forecast API
- 城市搜索：Open-Meteo Geocoding API（底层地点数据来自 GeoNames）
- 官方文档：https://open-meteo.com/en/docs
- 地理编码文档：https://open-meteo.com/en/docs/geocoding-api

天气仅在 Overview 打开时按约 30 分钟间隔更新，不会随时钟每秒重复请求。浏览器不会自动申请定位；只有用户主动点击“使用当前位置”后才调用设备定位权限。最后选择的城市与短期天气缓存只保存在当前浏览器，不包含账户密钥或会话信息。
