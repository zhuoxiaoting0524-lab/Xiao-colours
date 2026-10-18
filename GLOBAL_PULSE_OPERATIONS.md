# GLOBAL PULSE 数据运维

## 数据链路

`Cloudflare Cron → Worker → GDELT → 数据校验 → GLOBAL_PULSE_CACHE KV → /api/news → 浏览器`

USGS 地震数据仍由浏览器单独读取；它失败时不会清空新闻缓存。

## 健康接口

- `GET /api/news/health`：最近成功、最近失败、错误类型、24 小时/7 天缓存数量与过期状态。
- `GET /api/news?time=1d`：24 小时新闻；返回 `live`、`cache`、`stale` 或 HTTP 503 `unavailable`。
- `GET /api/news?time=1w`：7 天新闻。
- `GET /api/news?time=1d&refresh=1`：人工请求一次上游刷新；一分钟冷却期内不会重复请求。

## 状态含义

- `live`：快照最近 30 分钟内更新。
- `cache`：实时刷新失败或尚未到下一次刷新，但快照仍在 24 小时内。
- `stale`：快照超过 24 小时；只允许进入历史区域。
- `unavailable`：服务器没有任何有效快照，API 返回 503。

TOP 5 与普通新闻分别计算。`TOP 5 = 0` 可能表示没有事件通过重大事件门槛，并不等于普通新闻为空；健康面板会分别显示有效新闻和重大事件数量。

## 失败保护

上游请求具备 25 秒超时和有上限的退避重试。只有响应为合法 JSON、文章 URL/标题/时间有效且有效文章不少于 5 条时才写入缓存。失败、空响应或格式变化只更新失败健康记录，绝不覆盖最后成功快照。

结构化日志事件：

- `news_refresh_success`
- `news_refresh_failed`
- `scheduled_refresh_complete`
- `cache_read_failed`

## 上线检查

1. `GLOBAL_PULSE_CACHE` 显示为 KV binding，而不是 `edge-cache`。
2. `/api/news/health` 的 `storage` 为 `kv`。
3. Cloudflare Cron Triggers 中存在 `*/15 * * * *`。
4. 最近一次 `scheduled_refresh_complete` 至少一个窗口成功。
5. 人工制造上游失败后，`/api/news` 仍返回已有缓存且 `lastFailureAt` 更新。
6. 超过 24 小时的快照只显示在历史区域。
