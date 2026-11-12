# AGENTS.md

面向 AI 编码代理的工程规范。`README.md` 面向用户；冲突时以本文件、`DECISIONS.md` 与 `openspec/changes/agent-native-ledger` 为准。

本仓库是「本地服务 + SQLite + CLI + MCP + Vue UI」的 agent 原生台账（OpenSpec 变更 `agent-native-ledger`）。后端与前端迁移均已完成。

---

## 1. 项目形态

- Monorepo（npm workspaces）。后端包用 TypeScript，前端 `packages/web` 迁移后仍用 Vue 3 + JavaScript。
- 真相源是本地 SQLite（`data/ledger.db`，WAL），由只监听回环的本地服务独占管理。浏览器 IndexedDB/localStorage 不再是数据源。
- 依赖版本以各 `packages/*/package.json` 与根 `package.json` 为准；`design.md` 的选型（better-sqlite3 / Kysely / Postgrator / Zod / Hono / Commander / MCP SDK）为冻结决策，见 `DECISIONS.md`。

## 2. 包布局与归属

| 包 | 名称 | 职责 | 不得做 |
| --- | --- | --- | --- |
| `packages/core` | `@ledger/core` | Zod schema、18 条领域命令、`dispatch`、派生查询、错误码目录、审计模型 | 任何 IO（不碰文件、数据库、网络） |
| `packages/storage-sqlite` | `@ledger/storage-sqlite` | better-sqlite3 连接、Kysely 仓储、Postgrator 迁移、视图、触发器、备份、导入导出 | 感知 HTTP/UI；金额用浮点 |
| `packages/server` | `@ledger/server` | Hono 服务：认证中间件链、只读端点、命令端点、导出/导入端点 | 业务规则（下沉 core）；直接拼 SQL |
| `packages/cli` | `@ledger/cli` | `ledger` 命令行：领域命令 + describe/validate/query/backup/export/import/auth | 重复实现 core 逻辑 |
| `packages/mcp` | `@ledger/mcp` | stdio MCP server + 能力发现产物 | 另写一套命令层（必须复用 core 注册表） |
| `packages/web` | `@ledger/web` | Vue 3 前端：API 客户端、配对页与业务页面 | 直接访问 SQLite/浏览器存储；组件内直接 `fetch` |

旧 `src/` 浏览器应用与单文件构建已移除；不要重新引入 IndexedDB/localStorage 作为真相，也不要恢复单文件构建。

## 3. 硬约束（违反即失败）

1. 所有写操作只经 core 命令 handler → `storage-sqlite` 单事务提交；组件/路由/适配器不得绕过 `dispatch` 自行增删改。
2. 金额一律整数分（`INTEGER`，列名 `*_cents`），禁止 `REAL` 存金额；元↔分转换用 half-up 舍入。
3. 派生值（已付/未付/资金进度/交付进度/逾期/临期/错位差额/统计）只存在于 SQL 视图（`v_contract_finance`、`v_contract_delivery`、`v_contract_full`），不落库、不可手改；写操作只写事实（合同、流水、交付）。
4. 服务只绑定回环（`127.0.0.1` / `::1` / `localhost`），拒绝 `0.0.0.0`；运行期后端零外部网络请求。
5. 密钥（`apiKey`、`baseUrl`、`ai.enabled`）不得进入源码、演示/种子数据、日志或导出备份；导出经 `sanitizeSettingsForExport` 递归剔除。
6. 幂等唯一权威是 `idempotency_keys(actor, command, key)` 表；`payments`/`deliveries` 不设幂等列（`DECISIONS.md`）。
7. 全局数据集版本存 `meta.version`，每次成功写事务 +1；`expectedVersion` 不符返回 `STALE_WRITE`。
8. 审计（`audit_log`）与状态日志（`contract_status_logs`）在写命令同一事务内由应用层写入；触发器只做金额守卫，不写审计。
9. 命令结果统一信封 `{ ok, code?, message?, hint?, details?, retryable?, data?, diff?, version?, meta }`；调用方判断 `ok`。
10. 提交前 `npm run typecheck` 与 `npm test` 必须通过；不得放宽断言或跳过校验来「让它通过」。
11. 不引入约定外技术：后端保持 TypeScript，前端不引入 TypeScript；不新增破坏单库一致性的旁路存储。
12. 备份只由显式入口产生（`ledger backup` / 导出）：迁移与日常打开台账（CLI / server / MCP 每次启动）不得自动写快照，否则 `<data>/backups` 会随命令次数线性膨胀。

## 4. 命令契约

- 命令名点号（`contract.upsert`），CLI 拆 `ledger contract upsert`，MCP 工具名 snake_case（`contract_upsert`，点号在 MCP 非法）。
- 元参数（`idempotency_key`、`expected_version`、`dry_run`）是显式工具/命令参数，不依赖传输层状态（MCP v2 无会话）。
- 写命令必须带 `idempotency_key`；相同键+相同指纹重放首次结果，相同键+不同内容返回 `IDEMPOTENCY_KEY_REUSED`。
- `dry_run` 只返回字段级 `diff`，不写入、不递增版本。
- 错误码、HTTP 状态、可重试性与修复建议在 `core/contracts/error-codes.ts` 的 `ERROR_CATALOG` 集中定义；新增错误码必须同步补全目录与测试。
- CLI 退出码：`0` 成功、`1` 业务失败、`2` 用法/校验错误、`4` 未认证（`cli/src/exit-codes.ts`）。
- 新增/修改命令后必须重新生成发现产物（见 §7），保持 `schema/commands.json`、`docs/AGENTS.ledger.md`、`llms.txt` 与注册表一致。

## 5. 认证与 HTTP

- 双凭证平面：浏览器 `HttpOnly; SameSite=Strict` 会话 Cookie（`ledger_sid`）+ 可读 CSRF Cookie（`ledger_csrf`）；agent 用 `ldg_<tokenId>_<secret>` bearer 令牌。
- 秘密只在签发/配对时明文出现一次，库中只存 SHA-256 哈希；比较用 `timingSafeEqual`（`safeEqualHex` / `constantTimeEqual`），禁止 `===` 比哈希。
- 中间件顺序固定（`server/src/app.ts`）：Host 白名单 → Cookie 写请求精确 Origin → 限流 → 认证 → Cookie 写请求 CSRF 双提交 → 业务。Bearer 请求免 Origin/CSRF（无环境凭证）；限流必须先于认证，否则未认证的暴力尝试在计数前就被 401 短路。
- Cookie 不按端口隔离（RFC 6265 §8.5），故 CSRF 不能只靠 SameSite，必须精确 Origin + 双提交。
- 配对码：8 位、32 字符无歧义字母表、TTL 120 秒、单次使用、错误上限 5；HTTP 配对限流 5 次/分钟，一般认证限流 30 次/分钟。
- 只认证不授权：任意已认证主体能力相同，差异只体现在审计 `actor`。
- 只读模式（`AppOptions.readonly`）拒绝写命令与导入（`403 READONLY`），读与导出保持可用。
- 威胁模型与逐条测试证据见 `docs/security.md`；改动认证/中间件必须同步更新该文档并保证断言有测试支撑。

## 6. 代码风格

- TypeScript：严格类型，无 `any`、无 `@ts-ignore`；`switch` 穷尽；错误用 `LedgerError`（带 `code` + `details`）传递，不解析 message。
- 后端 2 空格缩进、单引号、不写分号、多行尾逗号；导出函数与领域对象用 JSDoc。
- 注释与用户文案（错误 hint、CLI 描述）用中文，标识符用英文。
- 业务日期 `YYYY-MM-DD`，时间戳 ISO-8601 UTC；金额计算前用有限数校验，展示用格式化纯函数。
- 非法/缺失值显示 `—`，绝不出现 `NaN` / `Infinity`；合同金额为 0 时进度返回 `null`。
- `packages/` 内不使用 `console.*`（`bin.ts` 入口的进程输出除外）；错误经返回值、信封或 problem+json 呈现，禁止空 `catch`。
- 前端沿用 Element Plus 复用约定：表格/分页/表单/弹窗/确认/提示/空态/加载/图表一律用 EP 或既有 `ChartPanel`，不手写 UI 基建组件（`Base*`）；图标从 `@element-plus/icons-vue` 显式 import；中文 locale 由 `el-config-provider` 提供。

## 7. 构建、测试与验收

```bash
npm install
npm run typecheck     # tsc -b 编译全部 TS 包 + 类型检查 test/integration
npm test              # vitest run：后端、CLI e2e、MCP stdio、HTTP、集成与前端单测
npm run validate      # check-runtime + typecheck + test
```

按包测试：`npm run test -w @ledger/server`（cli / mcp 同理）。

重新生成能力发现产物（改命令后必跑）：

```bash
npm run build -w @ledger/mcp
npm run discovery -w @ledger/mcp
```

运行：

```bash
node packages/server/dist/bin.js --data ./data --port 4517   # 打印 URL + 一次性配对码
node packages/cli/dist/bin.js <command> ... --json           # CLI（bin 名 ledger）
node packages/mcp/dist/bin.js --db ./data/ledger.db          # MCP stdio（--legacy 回退 v1）
```

改动代码的最低验收：

- `npm run typecheck` 与 `npm test` 全部通过；编辑器诊断无新增错误。
- 改命令/schema：发现产物与注册表一致（`discovery.test.ts`、`describe` 输出）。
- 改认证/中间件：`docs/security.md` 的每条受保护断言仍有测试。
- 涉及导入导出：v2 fixture 导入后 `validate` 业务 `violations` 为空、记录数一致。
- 前端相关：`npm run build -w @ledger/web` 与 `npx vitest run packages/web` 通过；手工冒烟首页/合同/人员/字典/设置经 API 加载无报错，375px 与桌面无横向溢出。

## 8. Git

- 未明确要求时不 commit / push / 开 PR。
- 一个提交只做一件事，Conventional Commits（如 `feat(mcp): 增加 --legacy v1 通道`）。
- 提交前检查 `git status` / `git diff`，不得带密钥、备份 JSON、`data/`、`node_modules/`、`dist/`、`.omo/`、`.codegraph/`。

## 9. 已知不一致（勿据此反向修改代码）

- 设计文档提及 `data/.secret` / `data/.token` 文件，当前代码未实现：令牌经 `auth token create` 一次性输出，`AppOptions.secret` 不参与 Cookie 签名。文档按现状描述。
- `design.md` 假定 MCP 默认协议 2026-07-28，实测 `@modelcontextprotocol/server@2.4.0` 协商为 `2025-11-25`（见 `packages/mcp/docs/mcp-compat.md`）。
- 暂无 settings 写命令；业务设置仅可经导入或后续变更补齐。
