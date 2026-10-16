# 开源与数据来源说明

## World Monitor

“全球动态”页面的产品思路与信息架构参考了 [World Monitor](https://github.com/koala73/worldmonitor)。World Monitor 源代码采用 **AGPL-3.0-only** 许可证，版权归原作者及贡献者所有。

当前实现没有复制或打包 World Monitor 的源代码，也没有使用其官方商标、标识、付费 API 或需要授权的密钥。页面底部保留了项目名称、源码链接和许可证背景说明。如果未来直接合并、修改或网络提供 World Monitor 的 AGPL 源码，应按适用的 AGPL-3.0 要求向用户提供对应源代码。

## 实时新闻：GDELT Project

- 接口：GDELT DOC 2.0 API
- 用途：检索和展示全球公开新闻标题、来源媒体、发布时间、媒体来源国、语言和原始链接
- 官方网站：https://www.gdeltproject.org/
- 接口文档：https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

页面不会把 GDELT 的“媒体来源国”描述为“事件发生地”。搜索关键词会发送给 GDELT 公共接口。

浏览器优先通过 GDELT 的 CORS JSON 接口读取数据；若该请求被浏览器或网络环境拦截，会降级到 GDELT 官方支持的 JSONP 输出格式。JSONP 会从 `api.gdeltproject.org` 加载脚本，因此部署方应将该域名视为受信任的数据依赖。

## 自然事件：USGS

- 接口：USGS Earthquake Hazards Program GeoJSON Summary Feeds
- 用途：展示最近 1 小时、24 小时或 7 天内 M4.5+ 地震
- 官方文档：https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

## 地图

- 交互组件：Leaflet 1.9.4（BSD-2-Clause）
- 底图与地图数据：© OpenStreetMap contributors
- 版权说明：https://www.openstreetmap.org/copyright

## AI 分析

当前项目没有服务端模型接口，因此 AI 摘要功能保持关闭。页面中的“态势概览”仅对已获取的新闻数量、媒体数量、来源国和规则分类进行统计，不冒充 AI 分析或事实核验。
