# Proposal

## Why

当前台账是纯前端应用，真相源是浏览器私有的 IndexedDB/localStorage。外部 agent（有文件与 shell 权限、但无法访问浏览器存储）既读不到当前状态，也没有可靠的写入通道；所有自动化只能退化为“导出备份 → 改 JSON → 人工导入”，或者依赖脆弱的 UI 自动化。这与“台账应由 agent 原生操作”的目标直接冲突。

同时，现有架构把领域校验分散在 Vue 组件、composable 与备份校验器三处，缺少命令级幂等、并发控制与机器可读错误码；金额以浮点存储、汇总字段与流水分离维护，也留下了不一致的隐患。

## What Changes

- **BREAKING**：真相源从浏览器存储迁移到本地 SQLite 文件，由本地 HTTP 服务独占管理；IndexedDB/localStorage 不再是数据源。
- **BREAKING**：取消“单文件 `dist/index.html` + 运行期零网络”的交付形态；改为本地服务 + 静态前端 + CLI，服务仅绑定 `127.0.0.1`。
- 引入 TypeScript 领域内核 `packages/core`，作为唯一校验与业务真相；CLI、HTTP、MCP 三个适配器共用同一份命令注册表，不重复实现业务逻辑。
- 引入统一命令契约：显式 `idempotencyKey`、乐观并发 `expectedVersion`、`dryRun` 差异预览、稳定错误码与修复建议、单事务原子提交。
- 引入本地服务认证（只认证、不授权）：终端配对码换取浏览器 HttpOnly 会话，CLI/agent 使用 bearer token 文件；Origin/Host 精确校验防 CSRF 与 DNS rebinding；所有请求记录 `actor`。
- 存储层改用 SQLite（WAL）：外键、CHECK、触发器、视图；金额统一为整数分；已付/未付/进度/逾期等派生值由视图实时计算，不再落库。
- 提供 schema 自描述能力（`describe` / JSON Schema / `AGENTS.md` 片段）与工具注解（只读、破坏性、幂等提示），让 agent 能发现能力而不是猜。
- 提供备份与恢复：SQLite 热备份（`VACUUM INTO`）+ 与现有 v2 备份格式的双向导入导出，保证历史数据可迁移。
- 现有 Vue 前端保留页面与交互，数据层改为 API 客户端；列表筛选、排序、分页改为服务端查询。
- 采购专用字段（采购项目/类别/方式/服务期约定/计划支付月份）不在本次变更范围，另立变更。

## Capabilities

### New Capabilities

- `agent-command-interface`: 命令注册表与三通道适配——命令/查询契约、dry-run、幂等、乐观并发、错误码、审计字段，以及 CLI/MCP/HTTP 的一致行为与能力自描述。
- `local-service-auth`: 本地服务认证——配对码、浏览器会话 Cookie、agent bearer token、Origin/Host/CSRF 校验、令牌轮换与吊销、actor 审计；明确不做授权与角色。
- `ledger-sqlite-store`: SQLite 存储契约——表结构约束、金额与日期表示、派生视图、支付/交付不变量触发器、迁移与校验、热备份与恢复。
- `ledger-service-api`: 面向前端与外部调用方的只读查询与命令端点——合同/流水/交付/人员/字典的读模型、分页筛选排序、统计与提醒、导出导入。

### Modified Capabilities

- `ledger-persistence`: 持久化介质与版本语义改变——从“浏览器三态存储 + 备份 JSON 迁移”改为“SQLite 主库 + 迁移 + 备份导入导出”；保留并按新介质重述版本升级、幂等迁移、旧备份兼容、导出剔除密钥等既有保证。

## Impact

- 仓库结构：新增 npm workspaces（`packages/core`、`storage-sqlite`、`cli`、`server`、`mcp`、`web`），现有 `src/` 逐步迁入 `packages/web`。
- 删除：`src/data/store.js` 的 IndexedDB/localStorage 实现、`src/data/backup.js` 的浏览器下载路径、运行期单文件构建与零网络约束。
- 迁入：`src/utils/derive.js` → `core/queries`；`src/data/schema.js` 字段与迁移 → `core/schema` + SQLite 迁移；`src/utils/validate.js` 表单规则 → `core` 不变量。
- 前端：`src/composables/useLedger.js` 改为 API 客户端；`ContractsView` 等列表页改用服务端分页；`BackupPanel` 改用导出/导入端点；新增配对页与认证守卫。
- 依赖：`node:sqlite`（Node 24 内置）、`hono` + `@hono/node-server`、`zod`、`@modelcontextprotocol/server`、`commander`、`vitest`。
- 数据：新增 `data/ledger.db`（WAL）、`data/.secret`、`data/.token`；现有浏览器数据通过一次性备份导入迁移。
- 运维：服务绑定 `127.0.0.1`；数据目录可配置；备份策略由“手工导出 JSON”变为“定时 SQLite 热备份 + 可选 JSON 导出”。
- 验收：从 `npm run build && npm run check` 改为 `typecheck + vitest + ledger validate`，并保留前端冒烟。
