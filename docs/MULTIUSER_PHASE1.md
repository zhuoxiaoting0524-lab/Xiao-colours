# 多用户第一阶段

## 密码与会话（明确方案）

- **哈希算法**：Web Crypto `SubtleCrypto` 的 **PBKDF2-HMAC-SHA-256**
- **迭代次数**：100,000（Cloudflare Workers SubtleCrypto 上限；平台强制上限）
- **盐**：每密码 16 字节 CSPRNG 盐
- **不**自行设计加密算法；仅调用平台已验证的 PBKDF2
- **Session**：随机 32 字节令牌，只存 SHA-256 哈希到 **D1 `sessions` 表**
- **Cookie**：`xc_session`，`HttpOnly` + `Secure`（HTTPS）+ `SameSite=Lax`
- **CSRF**：会话内 `csrf_secret`，写操作必须带 `X-CSRF-Token`；并校验 `Origin`
- **登录限流**：D1 `login_attempts`，同 IP+邮箱 15 分钟内失败 ≥ 8 次则 429
- **密码重置**：管理员生成 2 小时一次性链接（本阶段无邮件服务）

## 你需要手动完成（生产）

1. 创建 D1：`xiao-colours-db`
2. 把真实 `database_id` 写入 `wrangler.jsonc`（替换占位 UUID）
3. `wrangler secret put SESSION_SECRET`
4. `wrangler secret put ADMIN_BOOTSTRAP_TOKEN`
5. 确认后执行：`pnpm exec wrangler d1 migrations apply DB --remote`
6. **不要**修改或删除 `GLOBAL_PULSE_CACHE` KV
7. 打开 `/admin.html`，用引导令牌创建首位管理员

R2 本阶段仅预留表 `media_objects` 与 `users/{userId}/` 前缀约定，不创建 bucket。
