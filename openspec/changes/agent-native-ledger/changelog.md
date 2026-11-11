# 变更记录：agent-native-ledger

- **影响能力**：`agent-command-interface`、`local-service-auth`、`ledger-sqlite-store`、`ledger-service-api`（新增）；`ledger-persistence`（修改）
- **状态**：提案，待实施与归档
- **数据契约**：`schemaVersion` 2 → 3；真相源由浏览器存储迁移到本地 SQLite；导出格式保持可读 JSON

本文件随本次变更归档，只记录这一次方案的决策与影响；后续变更各自在自己的变更目录内维护 `changelog.md`，不写入 `openspec/specs/`。

## 背景

现有台账是纯前端应用，真相源是浏览器私有的 IndexedDB/localStorage。外部 agent 有文件与 shell 权限，但无法寻址浏览器存储，只能"导出备份 → 改 JSON → 人工导入"，或依赖脆弱的 UI 自动化。领域校验同时散落在 Vue 组件、composable 与备份校验器，缺少命令级幂等、并发控制与机器可读错误码；金额用浮点、汇总字段与流水分离维护，也存在一致性隐患。

用户明确解除"单文件产物、运行期零网络、浏览器存储为真相"三项约束，并要求优先采用已有开源实现，避免自造。

## 关键决策

### 架构与真相源

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 真相源 | 本地服务持有的 SQLite 主库 | 保留 IndexedDB + 补丁导入：agent 读不到状态，双源必然漂移；File System Access：仅 Chromium、`file://` 不可用；Playwright 驱动：脆弱且重复实现 |
| 传输 | CLI + 本地 HTTP + MCP 三通道共用命令注册表 | 每通道各写一套：校验漂移、错误码不一致 |
| 前端 | 保留现有 Vue 页面，数据层换 API 客户端 | 重写前端：收益低、风险高；UI 自动化作为写路径：禁止 |
| 部署 | 服务仅绑定 `127.0.0.1` | 局域网开放：无多用户需求，徒增攻击面 |

### 领域内核与命令接口

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 语言与校验 | TypeScript + Zod 4.6.7，`z.toJSONSchema()` 生成 agent 契约 | TypeBox：可行但表单复用弱；继续 JS + JSDoc：无法生成机器可读契约 |
| 命令契约 | `kind` + `idempotencyKey` + `expectedVersion` + `dryRun`，统一 `{ok,code,message,hint,data,diff,version}` | 直接暴露 REST 资源 CRUD：无法表达原子批量与幂等语义 |
| MCP 协议 | `@modelcontextprotocol/server` 2.4.0（stdio，2026-07-28 规范），保留 v1 开关 | 以 MCP 框架充当领域层（`xmcp`/`mcp-framework`/FastMCP）：复制已有命令层；HTTP MCP + 全套 OAuth：单用户本地场景攻击面过大 |
| CLI 约定 | Commander 15.1.0 + 统一 JSON 信封，退出码 0/1/2/4，`--json` 隐含非交互 | `oclif`：内置 `--json` 但依赖体量大；`citty`：0.x；`yargs`：无 JSON 信封；`@effect/cli`：生态绑定 |

### 存储与迁移

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 驱动 | `better-sqlite3` 13.0.3（MIT，SQLite 3.53.4，N-API 预编译） | `node:sqlite`：Node 24 为 Stability 1.2 RC，无 `transaction()`/`pragma()`，`busy_timeout` 默认 0，Node 26 将重命名 API；`sqlite3@6.0.1`：停止维护；`libsql`：衍生分支 + 远程同步 |
| 查询层 | Kysely 0.29.8 + kysely-codegen 0.20.0，SQL DDL 为唯一 schema 真相 | Drizzle 0.45.4：触发器/FTS5 仍需裸 SQL，`drizzle-kit` 迁移按 `MAX(created_at)` 应用且不校验 hash；Prisma：SQLite 视图不支持；TypeORM/Sequelize：模型优先、迁移无校验和 |
| 迁移 | Postgrator 8.0.1（纯 SQL + MD5 校验和）+ `BEGIN IMMEDIATE` 包裹 | `drizzle-kit migrate`：不校验已应用迁移内容；Kysely Migrator：SQLite 迁移锁是空实现；Atlas：校验和更强但引入 Go 二进制且 Pro 非开源；`@databases/sqlite`：2022 年后停更 |
| 金额 | `INTEGER` 分，半进位舍入，禁用 `REAL` | 浮点存储：精度与负数舍入不可控 |
| 派生值 | SQL 视图实时计算，不落库；触发器只做金额守卫 | 汇总字段落库：历史遗留的"汇总与流水不一致"根源；触发器写审计：拿不到操作者上下文 |
| 备份 | `VACUUM INTO` + `integrity_check`；JSON 导出保留 | 直接复制 `.db`：WAL 活跃时会得到不一致副本 |

### 认证

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 会话 | 不透明随机 session + DB 行 + `HttpOnly; SameSite=Strict` Cookie | `iron-session`：无状态封签无法单条吊销；`jose` JWT：吊销仍需黑名单 |
| Agent 凭证 | `ldg_<id>_<secret>` bearer，库中只存 SHA-256 | 复用浏览器会话调用 CLI：无法区分审计主体 |
| 配对 | 终端一次性配对码（8 位、TTL、单次、限次） | `better-auth` 设备授权：唯一完整实现，但 2.1 MB、需 DB 适配器、附带 telemetry；`otpauth`/`speakeasy`：TOTP ≠ 单次配对码 |
| CSRF | 精确 Origin（含端口）+ `Sec-Fetch-Site`，Cookie 请求必校验 | 只靠 SameSite：Cookie 不按端口隔离（RFC 6265 §8.5），其他 localhost 端口属于 same-site |
| DNS rebinding | 回环监听 + Host 白名单 + 对端地址校验 | `host-validation`：2022 年后停更、仅 Express；IP 白名单：重绑定后连接本身就来自 127.0.0.1 |
| 授权 | 不做，所有认证主体能力相同 | RBAC：当前单用户场景无需求，保留 `scopes` 字段预留 |

### 开源采用

| 层 | 采用 | 版本 / 许可 |
|---|---|---|
| HTTP | `hono` + `@hono/node-server` | 4.13.18 / MIT；2.1.7 / MIT |
| 驱动 | `better-sqlite3` | 13.0.3 / MIT |
| 查询 | `kysely` + `kysely-codegen` | 0.29.8 / MIT；0.20.0 / MIT |
| 迁移 | `postgrator` | 8.0.1 / MIT |
| 校验 | `zod` | 4.6.7 / MIT |
| CLI | `commander` | 15.1.0 / MIT |
| MCP | `@modelcontextprotocol/server` | 2.4.0 / Apache-2.0（保留 NOTICE） |
| 测试 | `vitest` | 5.1.0 / MIT |

**仅借鉴模式、不复制代码**：`slashbooks`（Apache-2.0，CLI 为唯一变更面、review queue、tamper-evident 审计）、`beancount-io`（MIT，`dry_run`、机器错误码 + 下一步提示）、`dbhub`（MIT，两层只读、行数上限 + `truncated`、渐进式 schema 披露）、`hledger`/`beancount`（GPL，校验与导入幂等思想）、`gh`/Supabase CLI（JSON 输出约定）。

**明确不采用**：local-first 框架（Electric/PowerSync/Jazz/Yjs/Triplit/InstantDB）对单写者本地台账过重；Akaunting（BUSL-1.1）、Invoice Ninja（Elastic-2.0）、NocoDB（Sustainable Use）许可不允许直接复用；`lucia`/`arctic`/`@oslojs/crypto`/`csurf` 已弃用。

## 影响面

- **仓库**：新增 npm workspaces 六个包；删除 `src/data/store.js` 的浏览器存储实现与单文件构建脚本；`src/utils/derive.js`、`schema.js`、`validate.js` 的行为迁入 `core`。
- **数据**：新增 `data/ledger.db`（WAL）、`.secret`、`.token`、`backups/`；旧 v2 备份通过 `ledger import` 迁移，迁移前自动 `VACUUM INTO` 快照。
- **接口**：新增命令端点与读模型端点；错误映射 400/401/403/409/412/422；导出剔除 `apiKey`、`baseUrl`、`ai.enabled`。
- **前端**：列表改服务端分页/筛选/排序；新增配对页与路由守卫；`BackupPanel` 改端点调用。
- **运维**：服务只绑回环；定时热备份取代手工导出；`typecheck + vitest + ledger validate` 取代 `build + check`。

## 兼容与回滚

- **数据兼容**：`schemaVersion` 1、2 的备份均可导入；缺失字段只告警并由幂等迁移补齐；导入报告新增/更新/保留条数。
- **行为兼容**：合同方向、资金/交付双进度、状态日志、引用保护语义保持不变；派生口径与旧实现一致，由一致性测试锁定。
- **回滚**：迁移期间旧应用保持只读可用；保留迁移前 `VACUUM INTO` 与 JSON 双备份；若新库异常，可回到旧应用继续使用 JSON 备份。代码回退需同时回退数据，否则旧实现会把采购合同按销售语义展示。

## 遗留问题

- 采购专用字段（采购项目/类别/方式/服务期约定/计划支付月份）未纳入本次 schema，需另立变更。
- MCP v2 宿主兼容性（Claude Code / Codex / Cursor）尚未实测，保留 v1 构建开关作为退路。
- `__Host-` + `Secure` 在纯 `http://localhost` 的浏览器矩阵未验证；不通过则退回非前缀 Cookie。
- `better-sqlite3` 为原生模块；若目标环境无法使用预编译产物，需按设计整体切换 `node:sqlite` + Drizzle 1.0 RC，不做混搭。
- 只读静态快照分发、旧浏览器数据引导导入页均未实现，按需再排期。
