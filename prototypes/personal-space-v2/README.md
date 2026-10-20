# XiaoColour Personal Space V2 · Phase 1

独立视觉原型，不连接生产数据库，也不会替换正式网站入口。

## 预览内容

- Home：四界面切换、三个模块入口、保留账户和 Global Pulse 入口。
- Little Notes：搜索、新增、展开、编辑、改色、删除（仅浏览器内存）。
- My Days：周/月切换、日期切换、任务新增、完成、编辑、删除（仅浏览器内存）。
- Footprints：MapLibre GL JS + OpenFreeMap 真实矢量地图、世界/街道视角、搜索、筛选、标记详情及添加演示地点（仅浏览器内存）。
- 响应式桌面和手机布局，支持 `prefers-reduced-motion`。

## 第二阶段数据建议

- 保留现有账号、邀请和 `user_id` 隔离逻辑。
- 新增 `notes`、`tasks`、`important_dates`、`places` 表；旧表先只读保留用于迁移与回滚。
- 当前原型使用 MapLibre GL JS + OpenFreeMap Liberty 样式；正式数据接入时，经纬度必须来自真实地理编码结果。
- 上线前补充 CSRF、所有权约束、限流、D1 迁移及双用户隔离测试。

从项目根目录启动静态服务器后访问 `/prototypes/personal-space-v2/`。
