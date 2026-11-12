# Design

## Context

见 `proposal.md`。当前实现是纯前端 Vue 应用，数据在 IndexedDB/localStorage，领域规则分散在 `src/composables/useLedger.js`、`src/utils/validate.js` 与各 `.vue` 组件中；派生字段部分落库、部分实时算，金额用浮点。改造目标是让 agent 可以不依赖 UI 直接操作台账，因此把真相源移出浏览器，并让 CLI / HTTP / MCP 共用一套领域内核。

本设计不再受“单文件产物、运行期零网络、浏览器存储为真相”约束；这些约束已由用户明确解除。

## Goals / Non-Goals

**Goals:**

- 一个 TypeScript 领域内核，作为校验、派生与写入的唯一真相。
- 一个命令注册表，生成 CLI、HTTP、MCP 三种适配器，行为一致。
- SQLite 主库承载事务、外键、CHECK、视图与迁移；金额整数分。
- 本地服务只做认证、不做授权；浏览器与 agent 均可安全访问。
- 现有 Vue 页面保留，数据层替换为 API 客户端。
- 旧 v2 备份可无损导入新库。

**Non-Goals:**

- 多用户、角色、租户、云同步。
- 采购专用字段（采购项目/类别/方式/服务期/计划支付月份）——另立变更。
- 离线多端冲突合并（CRDT）、附件二进制存储、审批流引擎。
- 保留原单文件 `dist/index.html` 分发形态（只读快照导出作为可选项，不在本期）。

## Decisions

### D1 真相源：SQLite + 本地服务

浏览器私有存储对 agent 不可寻址，粘贴补丁或 Playwright 都只是绕路。改为本地服务持有 SQLite 主库，所有客户端走同一 API/CLI。

**替代方案与否决理由**

- 浏览器 IndexedDB + 补丁导入：agent 无法读当前状态，只能“导出—改—导入”，且存在双源。
- File System Access API：仅 Chromium、`file://` 不可用、权限手势多，仍然把 UI 变成写通道。
- Playwright 驱动 UI：脆弱、重复实现、无法作为生产写路径。

### D2 领域内核：TypeScript + Zod 4.6.7

Zod schema 同时产出运行时校验、TS 类型与 JSON Schema（`z.toJSONSchema()`），供 CLI/HTTP/MCP 共用。日期用 `z.iso.date()`/`z.iso.datetime()`，金额用 `z.int().min(0)`（分）。

**替代方案**：TypeBox（JSON Schema 优先，但 Zod 生态与表单复用更好）；Valibot（体积小，工具链弱）；继续用 JS + JSDoc（无法从 schema 生成 agent 可读契约）。

### D3 SQLite 驱动：better-sqlite3 13.0.3

MIT；内置 SQLite 3.53.4；13.x 使用 N-API 预编译，Node 24 无需本地编译；提供 `transaction()`、`pragma()`、`backup()`、`function()`、`safeIntegers()`。可用性优先于“零原生依赖”。

**替代方案**：`node:sqlite`（Node 24 内置，但 Stability 1.2 RC；无 `transaction()`/`pragma()` helper，`busy_timeout` 默认 0 ms，Node 26 将重命名 `DatabaseSync`）；`sqlite3@6.0.1`（停止维护）；`libsql`（衍生分支 + 远程同步，超出需求）。

**兜底**：若目标机器无法使用原生模块，整体切换到 `node:sqlite` + Drizzle 1.0 RC，不做混搭。

### D4 查询层：Kysely 0.29.8 + kysely-codegen 0.20.0

SQL 优先：手写 DDL（含视图、触发器、FTS5）是唯一 schema 真相，由 `kysely-codegen` 从库生成 TS 类型；Kysely 提供类型安全查询与 raw SQL 逃生口。契约台账的 schema 大量使用 CHECK/触发器/视图，ORM 的 schema DSL 反而是负担。

**替代方案**：Drizzle 0.45.4（视图可建模，但触发器/FTS5 必须裸 SQL；`drizzle-kit` 迁移只按 `MAX(created_at)` 应用、存 hash 却不校验，存在跳号与漂移风险；`node:sqlite` 驱动仅在 1.0 RC）；Prisma（SQLite 无视图支持，CHECK 不可表达）；TypeORM/Sequelize（模型优先，迁移无校验和）。

### D5 迁移：Postgrator 8.0.1 + `BEGIN IMMEDIATE`

纯 SQL 迁移文件 + MD5 校验和（`validateChecksum` 默认开启），满足“带版本号与校验和、幂等、失败回滚”。SQLite 无 advisory lock，迁移整体包在 `BEGIN IMMEDIATE … COMMIT`，并在迁移前用 `VACUUM INTO` 做一次热备份。

**替代方案**：`drizzle-kit migrate`（不校验已应用迁移内容）；Kysely Migrator（SQLite 迁移锁是空实现、`supportsTransactionalDdl=false`）；Atlas（校验和最好，但引入 Go 二进制且 Pro 非开源）；`@databases/sqlite`（2022 年后停更）。

### D6 金额与派生值：整数分 + SQL 视图

- 所有金额列 `INTEGER`（分），禁用 `REAL`；输入层做精度校验与四舍五入（半进位，显式处理负数）。
- 已付/未付/进度/逾期由视图计算，不落库；写操作只写事实（合同、流水、交付）。
- 数据库层用 CHECK 与外键兜底；付款累计不得超过合同金额、合同降额不得低于已付/已交付，这两条同时由应用层与触发器保证（触发器只做金额守卫，不写审计——触发器拿不到操作者）。

**借鉴而非复用**：Beancount 的整账校验与 hledger 的组合式检查、GnuCash 的复式 schema 思路。均为 GPL，只取思想，不复制代码。

### D7 命令注册表 → 三个适配器

单一 `CommandDef` 定义：`name`、`input`（Zod）、`output`（Zod）、`annotations`（readOnly/destructive/idempotent/openWorld）、`errorCodes`、`handler`。

- CLI：Commander 生成子命令，统一 JSON 信封。
- HTTP：同一 handler，映射 `Idempotency-Key`、`If-Match`、problem+json。
- MCP：`@modelcontextprotocol/server` 的 `registerTool`，`inputSchema`/`outputSchema` 直接来自 Zod，返回 `structuredContent`。

MCP 规范 2026-07-28 已无会话与 `initialize`，因此 `expectedVersion`、`idempotencyKey` MUST 作为显式工具参数，不能依赖传输层状态。

**否决**：把 `xmcp`/`mcp-framework`/FastMCP 当领域层——会复制已有命令层；仅在需要文件路由时考虑。

### D8 认证：自持不透明令牌，不引入会话/JWT 库

- 浏览器：配对码 → 一次性会话，`HttpOnly; SameSite=Strict` Cookie；会话行存哈希，可单独吊销。
- CLI/agent：`ldg_<tokenId>_<secret>` bearer token，明文只落 `data/.token`（0600），库中只存 SHA-256。
- CSRF：**精确 Origin**（scheme+host+port）+ `Sec-Fetch-Site: same-origin`；Cookie 不按端口隔离（RFC 6265 §8.5），因此不能只依赖 SameSite。Bearer 请求无环境凭证，免 CSRF。
- DNS rebinding：仅监听回环 + Host 白名单 + 校验对端地址；不信任 `X-Forwarded-*`。
- 配对码：`crypto.randomInt` 生成 8 位（32 字符表），TTL 120 秒、单次使用、错误次数上限。

**替代方案**：`better-auth`（唯一现成 RFC 8628 实现，但 2.1 MB、需 DB 适配器、附带 telemetry 包，单用户本地服务不划算）；`lucia`/`arctic`/`@oslojs/crypto`（npm 已标记 deprecated）；`iron-session`（无状态封签，无法单条吊销）；`jose` JWT（吊销仍需黑名单）；`csurf`（归档）；`host-validation`（2022 年后停更）。

**待验证**：`__Host-` + `Secure` 在纯 `http://localhost` 的浏览器矩阵；不通过则退回同名 Cookie + `SameSite=Strict`。

### D9 HTTP 框架：Hono 4.13.18 + @hono/node-server 2.1.7

轻量、Web 标准 `Request/Response`、内置 `csrf()` 中间件、MIT。配对、会话、Host/Origin 中间件都可在 30 行内组合。

**替代方案**：Express 5（需额外 `csrf-csrf`、`cookie-parser`）；Fastify（插件矩阵更重）。

### D10 CLI：Commander 15.1.0 + 统一输出信封

采用 `gh` 与 Supabase CLI 的既有约定：`--json` 隐含非交互、成功结果写 stdout、日志写 stderr、稳定退出码 `0/1/2/4`、`--dry-run` 返回 diff、`--yes` 跳过确认。

**替代方案**：`oclif`（内置 `--json` 与插件体系，但依赖与体量大）；`citty`（零依赖但 0.x）；`yargs`（无内置 JSON 信封）；`@effect/cli`（引入 Effect 生态）。

### D11 MCP：`@modelcontextprotocol/server` 2.4.0（stdio）

官方 v2 包，Apache-2.0，对应 2026-07-28 规范：`serveStdio`、`registerTool`、`structuredContent`、工具注解、`resultType`。仅 stdio 暴露；HTTP MCP 暂不提供，避免再引入一套 OAuth。

**兼容**：老宿主可能只支持 v1 协议，保留 `@modelcontextprotocol/sdk@1.32.2`（MIT）构建开关，默认 v2。工具注解只作客户端提示，强制力仍在服务端校验。

**否决**：`@modelcontextprotocol/express` 的 OAuth 资源服务器与 `mcpAuthRouter`（单用户本地场景攻击面过大，且 v2 已冻结/弃用）；`mcporter` 是客户端工具，不适用。

### D12 前端：保留 Vue，替换数据层

页面、Element Plus 组件与样式不动；`src/data/store.js` 删除，新增 `src/api/client.js`；`useLedger` 改为查询/命令封装；列表筛选、排序、分页改服务端参数；`BackupPanel` 改导出/导入端点；新增配对页与路由守卫。

### D13 审计与可追溯

应用层在同一事务内写 `audit_log`（actor、transport、command、幂等键、前后版本、摘要）。MCP 请求透传 `traceparent` 到 `_meta`；HTTP 记录 `request_id`。不使用触发器写审计（无操作者上下文）。

### D14 开源采用矩阵

| 层 | 采用 | 版本 / 许可 | 说明 |
|---|---|---|---|
| HTTP | `hono` + `@hono/node-server` | 4.13.18 / MIT；2.1.7 / MIT | 直接依赖 |
| SQLite 驱动 | `better-sqlite3` | 13.0.3 / MIT | 直接依赖 |
| 查询层 | `kysely` + `kysely-codegen` | 0.29.8 / MIT；0.20.0 / MIT | 由 SQL DDL 生成类型 |
| 迁移 | `postgrator` | 8.0.1 / MIT | 纯 SQL + MD5 校验和 |
| 校验 / JSON Schema | `zod` | 4.6.7 / MIT | 单一 schema 真相 |
| CLI | `commander` | 15.1.0 / MIT | 统一信封自建 |
| MCP | `@modelcontextprotocol/server` | 2.4.0 / Apache-2.0 | 保留 NOTICE |
| 测试 | `vitest` | 5.1.0 / MIT | 临时库 + CLI e2e |
| 日期/格式化 | `dayjs`（既有） | 1.11.23 / MIT | 复用 |

**借鉴模式、不复制代码**：

- `giltotherescue/slashbooks`（Apache-2.0）：CLI 为唯一变更面、`trust-policy`、`review-queue`、tamper-evident 审计、Beancount 作为导出投影。
- `bex-co/beancount-io`（MIT）：`dry_run`、每次调用重新鉴权、机器错误码 + “下一步该调什么”。
- `@bytebase/dbhub`（MIT）：两层只读、行数上限 + `truncated`、渐进式 schema 披露（仅借鉴安全模式，不作为默认 SQL 入口）。
- `ledger`/`hledger`/`beancount`（GPL/BSD）：校验与导入幂等思想；不链接代码。
- `gh` / Supabase CLI：`--json`、stdout/stderr 分离、退出码、`--yes`。

**明确不采用**：local-first 框架（Electric/PowerSync/Jazz/Yjs/Triplit/InstantDB 等）对单写者本地台账过重；Akaunting（BUSL-1.1）、Invoice Ninja（Elastic-2.0）、NocoDB（Sustainable Use）许可不允许直接复用；Emoji/`sqlite3`/`libsql` 不作为驱动。

## 架构

```text
packages/
  core/            # Zod schema、领域命令、派生查询、错误码、审计模型（零 IO）
  storage-sqlite/  # better-sqlite3、Kysely、迁移、事务、备份、视图
  cli/             # `ledger`：describe/list/get/apply/record/query/validate/backup/auth
  server/          # Hono：认证中间件、REST 读模型、命令端点、导出导入
  mcp/             # stdio MCP server，工具由 core 注册表生成
  web/             # 现有 Vue 应用（页面保留，数据层换 API 客户端）
  schema/          # 由 Zod 生成的 JSON Schema + AGENTS.md 片段
data/
  ledger.db        # WAL 主库
  .secret          # 主密钥（0600）
  .token           # agent token（0600）
  backups/         # VACUUM INTO 产物
```

请求路径：

```text
UI ──Cookie──▶ server ─┐
CLI ─Bearer──▶ server ─┼─▶ core.commands ─▶ storage-sqlite ─▶ SQLite
MCP ─stdio───▶ core  ──┘        │
                                └─▶ audit_log / idempotency_keys（同一事务）
```

## 数据模型

连接初始化（每连接）：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

核心表（节选，完整 DDL 在迁移脚本）：

```sql
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('sale','purchase')),
  counterparty TEXT NOT NULL,
  type_item_id TEXT NOT NULL REFERENCES dict_items(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  -- 旧账导入的开账余额：视图按 opening + 明细求和，避免导入时伪造流水
  opening_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_paid_cents >= 0),
  opening_delivered_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_delivered_cents >= 0),
  sign_date TEXT NOT NULL,
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status_item_id TEXT NOT NULL REFERENCES dict_items(id),
  owner_id TEXT REFERENCES personnel(id),
  owner_name_snapshot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (due_date >= start_date)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIEW v_contract_finance AS
SELECT c.id,
       COALESCE(SUM(p.amount_cents), 0) AS paid_cents,
       c.amount_cents - COALESCE(SUM(p.amount_cents), 0) AS unpaid_cents,
       MAX(p.date) AS last_payment_date
FROM contracts c LEFT JOIN payments p ON p.contract_id = c.id
GROUP BY c.id;

CREATE TRIGGER trg_payment_budget BEFORE INSERT ON payments
BEGIN
  SELECT CASE WHEN (SELECT amount_cents FROM contracts WHERE id = NEW.contract_id)
                 < (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE contract_id = NEW.contract_id) + NEW.amount_cents
              THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT') END;
END;
```

其余表：`payments`、`deliveries`、`personnel`、`dict_categories`、`dict_items`、`contract_status_logs`、`audit_log`、`idempotency_keys`、`schema_migrations`、`settings`、`meta`。金额全部 `INTEGER`；业务日期 `TEXT 'YYYY-MM-DD'`；时间戳 `TEXT ISO-8601 UTC`。

## 命令与传输契约

```ts
type CommandDef<I, O> = {
  name: string                       // contract.upsert / payment.record / ...
  summary: string
  input: z.ZodType<I>
  output: z.ZodType<O>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  errorCodes: readonly string[]
  handler: (input: I, ctx: CommandContext) => Promise<CommandResult<O>>
}
```

CLI 输出信封：

```json
{ "schema_version": 1, "ok": true, "command": "contract.list",
  "data": { "items": [], "next_cursor": null },
  "meta": { "request_id": "…", "duration_ms": 12, "dry_run": false } }
```

错误：`{ ok: false, error: { code, message, details, retryable }, meta }`；HTTP 用 `application/problem+json`，并把 `code` 放进扩展字段。退出码：`0` 成功、`1` 业务失败、`2` 用法错误、`4` 未认证。

HTTP 映射：`Idempotency-Key`、`If-Match`/`ETag`（数据集版本）；`400` 缺幂等键、`409` 并发冲突、`412` 版本不匹配、`422` 校验失败、`403` 只读。

## 认证设计

```text
启动 → 生成/读取 data/.secret → 无 token 则生成并写 data/.token(0600)
     → 打印 http://127.0.0.1:4517 与一次性配对码（5 分钟）

浏览器 → /pair 输入配对码 → POST /api/auth/pair
       → 校验 TTL/次数/单次 → 建 session 行 → Set-Cookie(ledger_sid, HttpOnly, SameSite=Strict)
       → 配对码作废

CLI/agent → 读取 data/.token（或 LEDGER_TOKEN）→ Authorization: Bearer
```

表：`auth_sessions(id, secret_hash, actor, created_at, last_seen_at, expires_at, revoked_at, ua)`、`auth_tokens(id, secret_hash, actor, label, created_at, last_used_at, expires_at, revoked_at)`。

中间件顺序：回环对端 → Host 白名单 →（Cookie 请求）精确 Origin → 认证 → 写请求 CSRF 头 → 限流 → 业务。

## 风险 / 权衡

- `better-sqlite3` 是原生模块 → 依赖 N-API 预编译；锁 Node 24 与包版本；若目标环境不可用，按 D3 兜底整体切换，不混搭。
- SQLite WAL 在 3.7.0–3.51.2 存在并发 checkpoint 损坏缺陷 → 启动断言 `sqlite_version() >= 3.51.3`。
- 迁移无 advisory lock → 用 `BEGIN IMMEDIATE` 串行化；迁移前 `VACUUM INTO` 备份；失败整体回滚。
- 触发器无法拿到操作者 → 审计只在应用层写；触发器仅做金额守卫。
- MCP v2 宿主兼容性未知 → 默认 v2，保留 v1 构建开关；发版前跑 Claude Code / Codex / Cursor 矩阵。
- `__Host-`/`Secure` 在 `http://localhost` 的行为因浏览器而异 → 作为上线前 spike，失败则退回非前缀 Cookie。
- 视图与 TS 派生函数可能漂移 → 视图为唯一权威，TS 只做展示格式化；加一致性测试。
- 本地服务是新攻击面 → 仅回环、Host/Origin、限流、CSP；明确不防御同 OS 用户进程。
- 许可：MCP SDK v2 为 Apache-2.0（保留 NOTICE）；GPL 项目只借鉴思想；Akaunting/Invoice Ninja/NocoDB 不复用代码。

## 迁移计划

1. 建立 workspaces 与 `core`：Zod schema、命令、派生查询、错误码；以现有 `derive.js`/`validate.js` 为行为基准写测试。
2. `storage-sqlite`：DDL + 视图 + 触发器 + Postgrator 迁移；`kysely-codegen` 生成类型；启动 PRAGMA 与版本断言。
3. `cli`：`import` 现有 v2 备份 → `validate` 零错误；`contract/payment/list/query/backup` 跑通。
4. `server` + 认证：配对、会话、Bearer、Host/Origin；先只读端点，再命令端点。
5. `web`：删除 `src/data/store.js`，新增 API 客户端；列表改服务端分页；接入配对页。
6. `mcp`：stdio 工具 + `describe`/JSON Schema/AGENTS 片段；跑宿主兼容矩阵。
7. 移除浏览器存储与单文件构建脚本；保留 `ledger export --json` 作为归档。

**回滚**：迁移期间旧应用只读；`ledger backup` 与迁移前 `VACUUM INTO` 双备份；若新库异常，可回到旧应用继续使用 JSON 备份。

## Open Questions

- 采购专用字段与本次 schema 同期落地，还是另立变更后补？
- 是否保留“只读静态快照”分发（内嵌导出数据），用于给无 Node 环境的人查看？
- MCP 默认协议版本是否在宿主矩阵完成前先发 v1？
- 旧浏览器数据的一次性导入是否需要引导页，而非仅 CLI？
