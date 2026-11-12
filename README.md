# 合同台账 Ledger（agent-native-ledger）

本地运行的合同管理台账：真相源是本地 SQLite 文件，由一个只监听回环地址的本地服务独占管理。同一套领域命令经三个适配器对外暴露：HTTP（浏览器与远程 agent）、CLI（`ledger`）、MCP（stdio，供 agent 宿主调用）。没有云端、没有外部网络请求，数据只在本机。

> 当前实现状态：后端与前端均已完成迁移。`packages/web` 是 Vue 3 界面，数据层经 API 客户端访问本地服务；旧的浏览器 IndexedDB 数据层、`src/` 遗留应用与单文件构建已移除。

## 1. 这是什么

- 本地服务：Hono 应用，绑定 `127.0.0.1`（可配 `::1` / `localhost`），拒绝对外网卡。
- 存储：SQLite（WAL），金额一律整数分，派生值（已付/未付/进度/逾期/错位差额）由视图实时计算、不落库。
- 命令契约：18 条领域命令，统一结果信封与稳定错误码；写命令要求幂等键，支持乐观并发（`expectedVersion`）与 dry-run 差异预览。CLI / HTTP / MCP 复用同一 `dispatch`，行为一致。
- 认证：浏览器经一次性配对码换取 `HttpOnly; SameSite=Strict` 会话 Cookie；CLI / agent 用 bearer 令牌。只认证、不授权，任意已认证主体能力相同。
- 备份：SQLite 热备份（`VACUUM INTO`）+ 与旧版 v2 备份格式的双向导入导出。

## 2. 快速开始

前置：Node.js ≥ 24.18.0（`scripts/check-runtime.mjs` 会断言，SQLite 需 ≥ 3.51.3）。

```bash
npm install            # 安装 workspaces 依赖
npm run typecheck      # tsc -b 编译全部 TS 包，并类型检查 test/integration
```

### 2.1 启动本地服务

```bash
node packages/server/dist/bin.js --data ./data --port 4517
```

启动后终端打印服务地址与一次性配对码（有效期 120 秒）：

```text
ledger-server 已启动：http://127.0.0.1:4517
一次性配对码：3YRUKG44（有效期 120 秒，过期时间 2026-11-12T01:59:46.869Z）
```

浏览器打开 `http://localhost:5173`（开发模式）或托管 `packages/web/dist` 的静态地址，首次访问会跳转 `/#/pair`，粘贴终端配对码即可。开发模式由 Vite 代理 `/api` 并把出站 `Origin` 改写为服务地址。脚本化配对也可直接调用端点：

```bash
curl -s -c cookies.txt -H 'Host: 127.0.0.1:4517' -H 'content-type: application/json' \
  -d '{"code":"3YRUKG44"}' \
  http://127.0.0.1:4517/api/auth/pair
# → { "ok": true, "actor": "browser", "csrfToken": "...", "expiresAt": "..." }
# 同时下发 HttpOnly 会话 Cookie（ledger_sid）与可读 CSRF Cookie（ledger_csrf）
```

之后浏览器写请求需带会话 Cookie、精确 `Origin` 与 `X-CSRF-Token`（值取自 `ledger_csrf`）。

### 2.2 CLI

CLI 可执行文件为 `packages/cli/dist/bin.js`（包内 `bin` 名 `ledger`）。全局选项：`--json`（机器可读信封）、`--dry-run`、`--yes`、`--idempotency-key <key>`、`--data <dir>`、`--server <url>`。

```bash
# 能力自描述（18 条命令 + 错误码目录）
node packages/cli/dist/bin.js describe --json

# 新增合同（写命令必须带幂等键；金额单位为分）
node packages/cli/dist/bin.js contract upsert --idempotency-key "$(uuidgen)" \
  --input '{"no":"HT-2026-001","direction":"sale","counterparty":"星海科技","typeCode":"sales","statusCode":"executing","ownerId":null,"amountCents":48000000,"signDate":"2026-01-01","startDate":"2026-01-01","dueDate":"2026-12-31"}'

# 登记一笔收款
node packages/cli/dist/bin.js payment record --idempotency-key "$(uuidgen)" \
  --input '{"contractId":"<合同 id>","date":"2026-02-01","amountCents":1000000}'

# 分页查询
node packages/cli/dist/bin.js contract list --input '{"page":1,"pageSize":20,"sortBy":"updatedAt","sortOrder":"desc"}'
```

### 2.3 MCP（stdio）

供 agent 宿主（Claude Code / Codex / Cursor 等）以 stdio 方式挂载。数据库路径用 `--db`（不是 `--data`）。

```json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["packages/mcp/dist/bin.js", "--db", "data/ledger.db"]
    }
  }
}
```

默认 v2 协议，`--legacy` 回退 v1。握手、`tools/list`、读写与幂等重放的实测结果与宿主配置见 `packages/mcp/docs/mcp-compat.md`。

## 3. 架构与目录

```text
packages/
  core/            TypeScript 领域内核：Zod schema、18 条命令、派生查询、错误码目录、审计模型（零 IO）
  storage-sqlite/  better-sqlite3 + Kysely + Postgrator 迁移 + 视图 + 触发器 + 备份 + 导入导出
  server/          Hono HTTP 服务：认证中间件链、只读模型端点、命令端点、导出/导入端点
  cli/             `ledger` 命令行：领域命令 + describe/validate/query/backup/export/import/auth
  mcp/             stdio MCP server + 能力发现产物（schema/commands.json、docs/AGENTS.ledger.md、llms.txt）
  web/             Vue 3 前端：API 客户端、配对页、合同/人员/字典/设置页面
data/
  ledger.db        WAL 主库（伴随 ledger.db-wal / ledger.db-shm）
  backups/         VACUUM INTO 一致性备份
scripts/           check-runtime.mjs（运行时断言）、check-runtime.test.mjs
```

数据流：`CLI / HTTP / MCP → core.dispatch（校验 + 幂等 + 乐观并发 + 审计）→ storage-sqlite（单事务）→ SQLite 视图 → 读模型`。

## 4. 命令目录（18 条）

完整字段与 JSON Schema 见 `packages/mcp/schema/commands.json` 与 `ledger describe --schema`。命令名用点号（`contract.upsert`），CLI 拆成 `ledger contract upsert`，MCP 工具名转 snake_case（`contract_upsert`）。

| 组 | 命令 | 类型 | 作用 |
| --- | --- | --- | --- |
| contract | `contract.upsert` | 写 | 新增或更新合同（编号唯一、日期先后、负责人在职、方向与金额锁定校验） |
| contract | `contract.get` | 只读 | 按 id 或编号读取合同详情（含流水、交付、状态日志） |
| contract | `contract.list` | 只读 | 分页查询合同（方向、状态、负责人筛选与多字段排序） |
| contract | `contract.delete` | 破坏性写 | 删除合同并级联删除其流水、交付、状态日志 |
| contract | `contract.statusLogs` | 只读 | 读取合同状态变更日志 |
| payment | `payment.record` | 写 | 登记一笔资金流水（累计不得超过合同金额） |
| payment | `payment.list` | 只读 | 按合同查询全部资金流水 |
| payment | `payment.delete` | 破坏性写 | 删除一笔流水（已付金额与进度自动回退） |
| delivery | `delivery.record` | 写 | 登记一条交付明细（验收驳回不计入已交付金额） |
| delivery | `delivery.list` | 只读 | 按合同查询全部交付明细 |
| delivery | `delivery.delete` | 破坏性写 | 删除一条交付明细（已交付金额与最后交付日重算） |
| personnel | `personnel.upsert` | 写 | 新增或更新人员档案（编号忽略大小写唯一） |
| personnel | `personnel.list` | 只读 | 查询人员档案（可含离职人员） |
| personnel | `personnel.delete` | 破坏性写 | 删除人员档案（仍被引用时拒绝） |
| personnel | `personnel.transfer` | 破坏性写 | 把某人员名下全部合同批量转交给另一在职人员 |
| dict | `dict.upsert` | 写 | 新增或更新字典分类或字典项（同分类下编码唯一） |
| dict | `dict.list` | 只读 | 列出字典分类与字典项 |
| dict | `dict.delete` | 破坏性写 | 删除字典分类或字典项（仍有引用时拒绝） |

写命令都必须带 `idempotency_key`；相同键+相同入参重放首次结果，相同键+不同入参返回 `IDEMPOTENCY_KEY_REUSED`。可选 `expected_version`（乐观并发，不符返回 `STALE_WRITE`）与 `dry_run`（只返回 `diff`，不写入）。

### 4.1 认证令牌管理

```bash
# 签发 agent 令牌（明文仅此一次输出，库中只存 SHA-256 哈希）
node packages/cli/dist/bin.js auth token create --actor "agent:codex" --label "笔记本" --json

# 列出令牌元信息（不含明文与哈希）
node packages/cli/dist/bin.js auth token list --json

# 吊销令牌（立即生效）
node packages/cli/dist/bin.js auth token revoke --id <tokenId> --json

# 浏览器会话：列出 / 吊销
node packages/cli/dist/bin.js auth session list --json
node packages/cli/dist/bin.js auth session revoke --id <sessionId> --json
```

令牌轮换走 HTTP：`POST /api/auth/tokens/:id/rotate`（吊销旧令牌并签发新令牌）。CLI 暂无 `rotate` 子命令，可先 `revoke` 再 `create`，或调用 HTTP 端点。

### 4.2 备份、导出与导入

```bash
# 一致性热备份（VACUUM INTO + 完整性检查），默认写入 <data>/backups
node packages/cli/dist/bin.js backup --json

# 导出数据集为 JSON（settings 已剔除 apiKey / baseUrl / ai.enabled）
node packages/cli/dist/bin.js export --out ./backup.json --json

# 从备份导入（单事务，失败整体回滚）；mode 默认 replace，可选 merge
node packages/cli/dist/bin.js import --backup ./backup.json --mode replace --json
```

HTTP 侧对应 `GET /api/export` 与 `POST /api/import`。

### 4.3 校验与只读查询

```bash
# 结构完整性 + 外键 + 业务不变量扫描（金额越界、重复编号、离职负责人引用、孤立驳回交付）
node packages/cli/dist/bin.js validate --json

# 只读 SQL：仅 SELECT / WITH / EXPLAIN 单语句，默认 200 行、最大 1000，强制 query_only
node packages/cli/dist/bin.js query --sql "SELECT no, amount_cents FROM v_contract_full ORDER BY no" --json
```

`validate` 对历史数据里「到期日早于开始日」这类刻意保留的异常会报 `integrity_check` 的 `CHECK constraint failed`，但判定结构仍健康（`ok` 取决于业务 `violations` 是否为空）。

## 5. 从旧浏览器应用迁移

旧版是纯前端应用，数据在浏览器 IndexedDB/localStorage，导出为 v2 备份 JSON。迁移用 CLI 一次性导入：

```bash
node packages/cli/dist/bin.js import --backup ./合同台账备份_YYYYMMDD_HHmm.json --json
```

导入过程：

- 元 → 整数分（half-up 舍入）。
- 旧版非 UUID 主键（如 `pay-0001`）确定性改写为 UUID，并同步改绑外键（同一旧 id 永远得到同一新 id，merge 不产生重复）。
- `typeCode` 解析为 `dict_items`（分类 `contractType`），缺失项按需创建。
- 旧合同的 `receivedAmount` / `deliveredAmount` 若超过导入的流水/明细之和，保留为 `opening_paid_cents` / `opening_delivered_cents`（开账余额），视图按「开账余额 + 明细」求和，绝不伪造流水。
- 方向 `direction`、状态日志（`statusLogs`）一并迁入 `contract_status_logs`。

导入后校验：

```bash
node packages/cli/dist/bin.js validate --json     # violations 应为空
node packages/cli/dist/bin.js contract list --input '{"page":1,"pageSize":1}' --json   # total 与旧库合同数一致
```

回滚：旧浏览器应用已从仓库移除；如需回退，请在旧版本应用中恢复迁移前的 v2 JSON 备份。新库异常时用 `ledger backup` 快照恢复，或 `ledger import --mode replace` 重新导入。`import` 前建议先 `backup` 生成 SQLite 快照。

## 6. 开发

```bash
npm run typecheck    # tsc -b：编译 core/storage-sqlite/cli/server/mcp（含类型检查）
npm test             # vitest run：全部后端包测试（含 CLI e2e、MCP stdio、HTTP 集成）
npm run validate     # check-runtime + typecheck + test 的组合校验
```

按包运行测试：

```bash
npm run test -w @ledger/server
npm run test -w @ledger/cli
npm run test -w @ledger/mcp
```

重新生成能力发现产物（改命令后）：

```bash
npm run build -w @ledger/mcp          # tsc -b 产出 dist
npm run discovery -w @ledger/mcp      # 写 schema/commands.json、docs/AGENTS.ledger.md、llms.txt
```

前端：先启动本地服务，再运行 `npm run dev -w @ledger/web`（Vite，5173，代理 `/api` 到 4517）；`npm run build` 产出 `packages/web/dist` 多文件资源；`npx vitest run packages/web` 跑 API 客户端单测。

## 7. 安全说明与限制

- 只监听回环，Host/Origin 精确校验、CSRF 双提交、认证限流、令牌哈希存储与轮换吊销。完整威胁模型与逐条测试证据见 `docs/security.md`。
- 单用户本地台账：无角色、无授权、无多租户；任意已认证主体能力相同。
- 不防御同一操作系统用户下的其他进程：同用户进程可直接读取 `data/ledger.db`。需要更强隔离时用独立系统用户或容器。
- 未启用 TLS（纯 `http://` 回环）。
- MCP 默认协议实测协商为 `2025-11-25`（与设计假设 2026-07-28 不一致）；老宿主用 `--legacy` 回退 v1。
- 暂无 settings 写命令：业务设置（提醒天数、自动编号等）当前无 `settings.upsert` 类命令，仅可经导入或后续变更补齐。
- 令牌/主密钥不落 `data/.token` / `data/.secret` 文件（设计文档提及但代码未实现）；令牌由 `auth token create` 一次性输出，由调用方自行保管。
