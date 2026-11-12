# Tasks

## 1. 工作区与工具链

- [x] 1.1 建立 npm workspaces：`packages/{core,storage-sqlite,cli,server,mcp,web}` 与根 `tsconfig`、`vitest.config`；`npm install` 成功且 `npm run typecheck` 以 0 退出
- [x] 1.2 增加 `scripts/check-runtime.mjs`：启动时断言 Node ≥ 24.18 且 `SELECT sqlite_version()` ≥ 3.51.3；用低于门槛的模拟值跑单测，断言抛出可读错误
- [x] 1.3 根脚本提供 `typecheck` / `test` / `validate` / `build`；在干净克隆上依次执行四个脚本，全部以 0 退出
- [x] 1.4 引入 `better-sqlite3@13.0.3`、`kysely@0.29.8`、`kysely-codegen@0.20.0`、`postgrator@8.0.1`、`zod@4.6.7`、`hono@4.13.18`、`@hono/node-server@2.1.7`、`commander@15.1.0`、`@modelcontextprotocol/server@2.4.0`、`vitest@5.1.0`；`npm ls --depth=0` 无 extraneous、无 peer 警告

## 2. 领域内核（core）

- [x] 2.1 用 Zod 定义 Contract / Payment / Delivery / Personnel / Dict 的输入与输出 schema，并导出 `z.toJSONSchema()`；单测覆盖必填、枚举、日期格式、长度上限与未知字段拒绝
- [x] 2.2 实现金额工具：元字符串 → 整数分、half-up 舍入、负数处理、展示格式化；单测覆盖 `0.005`、负数、超两位小数与超大金额，断言无浮点误差
- [x] 2.3 实现领域不变量：合同金额 ≥ 已付/已交付、方向锁定、负责人须在职、合同编号唯一、到期日 ≥ 开始日；每条不变量一个失败用例，断言返回对应错误码
- [x] 2.4 实现派生查询：已付、未付、资金进度、交付进度、逾期/临期、按方向统计；用固定 fixture 断言与 SQL 视图结果一致（金额为 0 时进度返回 `null`）
- [x] 2.5 建立错误码目录（code、HTTP 状态、修复建议）与 `describe()` 输出；单测断言每个错误码都有状态映射与提示，且 JSON Schema 可序列化

## 3. SQLite 存储层

- [x] 3.1 编写 `001_init.sql`：合同/流水/交付/人员/字典/状态日志/审计/幂等表，含外键、CHECK、索引、`v_contract_finance` 视图与金额守卫触发器；在临时库执行迁移后断言 `PRAGMA foreign_keys`、`integrity_check` 与 `sqlite_version()`
- [x] 3.2 封装 Postgrator 运行器：`BEGIN IMMEDIATE` → 迁移 → `COMMIT`，失败 `ROLLBACK`，迁移前 `VACUUM INTO` 备份；单测覆盖重复执行幂等、篡改已应用脚本被校验和拒绝、脚本中途失败整体回滚
- [x] 3.3 用 `kysely-codegen` 从迁移后的库生成类型，封装 repository：合同/流水/交付/人员/字典的读写；集成测试覆盖外键拒绝、唯一键冲突与视图读数
- [x] 3.4 实现付款/交付事务：写事实 + 重算视图 + 校验金额上限；单测覆盖超付被拒、合同降额低于已付被拒、删除流水后派生值回退
- [x] 3.5 实现幂等表与审计写入：同一事务内写 `idempotency_keys` 与 `audit_log`；单测覆盖相同键相同指纹返回旧结果、相同键不同指纹被拒、审计含 actor 与前后版本
- [x] 3.6 实现备份与恢复：`VACUUM INTO` 生成备份、`PRAGMA integrity_check` 校验、从备份恢复；集成测试断言恢复后各表记录数与版本号一致

## 4. 命令注册表与 CLI

- [x] 4.1 实现命令注册表与分发：统一入参校验、`dryRun` diff、`expectedVersion`、幂等与错误映射；单测覆盖 dry-run 不写库、版本冲突 `STALE_WRITE`、批量原子回滚
- [x] 4.2 搭建 Commander CLI：全局 `--json`、`--dry-run`、`--yes`、`--idempotency-key`，统一 JSON 信封与退出码 0/1/2/4；用 execa 跑 e2e 断言成功/用法错误/未认证的输出结构
- [x] 4.3 实现 `contract`（list/get/upsert/delete）、`payment`、`delivery`、`personnel`、`dict` 子命令；e2e 覆盖新增合同 + 3 笔付款 + 查询详情，断言派生金额正确
- [x] 4.4 实现 `ledger describe --json` 与 `ledger validate`：输出命令、字段、枚举、错误码；`validate` 执行 `integrity_check` 与业务不变量扫描，测试库零错误、注入坏数据后能定位
- [x] 4.5 实现 `ledger query --readonly --sql`：仅允许 `SELECT/WITH/EXPLAIN`、强制行数上限、超时与 `query_only`；单测断言 INSERT/UPDATE/DDL 被拒
- [x] 4.6 实现 `ledger import --backup <v2.json>`：迁移前快照、字段映射、记录数报告；用一份 v2 fixture 导入后断言合同/流水/交付/字典数量一致且 `validate` 通过
- [x] 4.7 实现 `ledger backup` 与 `ledger export --json`：导出剔除 `apiKey`/`baseUrl`/`ai.enabled`；测试断言字段不存在且备份可被 `integrity_check`

## 5. 认证与本地服务

- [x] 5.1 建 `auth_sessions` / `auth_tokens` 表与令牌工具：256 位随机、SHA-256 存储、`timingSafeEqual` 比较；单测覆盖哈希不落明文、过期与吊销判定
- [x] 5.2 实现配对流程：启动打印一次性配对码（8 位、TTL 120 秒、最多 5 次尝试）；单测覆盖成功、过期、重复使用、超限返回 `PAIR_CODE_INVALID` / `RATE_LIMITED`
- [x] 5.3 实现回环与 Host/Origin 中间件：仅 `127.0.0.1`/`::1`、Host 白名单、精确 Origin；测试伪造 Host、`Origin: null`、其他 localhost 端口均被拒绝
- [x] 5.4 实现 Cookie 会话与 Bearer 双平面：Cookie 写请求校验 CSRF 头，Bearer 豁免；测试两类主体执行同一命令结果一致、吊销后立即 401
- [x] 5.5 实现 Hono 读端点：合同/流水/交付/人员/字典列表与详情，服务端分页、筛选、排序；接口测试断言第 2 页与总数正确、派生字段与视图一致
- [x] 5.6 实现命令端点：映射 `Idempotency-Key`、`If-Match`/`ETag` 与 problem+json；测试 400 缺键、409 并发、412 版本、422 校验、200 成功并返回新 ETag
- [x] 5.7 实现 `rotate` / `revoke` / `logout` 与 CLI `ledger auth token|rotate|revoke|sessions`；测试轮换后旧令牌 401、会话列表可读
- [x] 5.8 实现导出/导入端点与只读模式：写失败后转只读、读与导出仍可用；测试返回 `READONLY` 且可导出
- [x] 5.9 在 `docs/security.md` 记录威胁模型：受保护项（CSRF、DNS rebinding、令牌泄漏）与不受保护项（同 OS 用户进程）；核对文档中的每条断言都有对应测试

## 6. MCP 与能力发现

- [x] 6.1 实现 stdio MCP server：由命令注册表生成 `tools/list`，带 annotations、`inputSchema`/`outputSchema` 与 `structuredContent`；测试断言工具数量、注解与注册表一致
- [x] 6.2 增加协议版本开关：默认 v2（2026-07-28），`--legacy` 使用 v1 SDK；用 MCP Inspector 或裸 stdio 脚本各跑一次 `tools/list` 与一次调用
- [x] 6.3 生成发现产物：`schema/commands.json`、`AGENTS.md` 片段、`llms.txt`；测试断言 `describe` 输出与 JSON 文件内容一致
- [x] 6.4 在 `docs/mcp-compat.md` 记录 Claude Code / Codex / Cursor 的握手与调用结果；按文档步骤复跑一次，结果与记录一致

## 7. 前端迁移

- [x] 7.1 新增 `web/src/api/client.js` 与 `useAuth`：同源 Cookie、CSRF 头、401 跳转配对页；单测 mock fetch 断言错误映射
- [x] 7.2 新增 `/pair` 页面与路由守卫：输入配对码、展示过期/限流/无效状态；手工冒烟：未认证访问任意页面被引导到配对页
- [x] 7.3 用 API 客户端替换 `src/data/store.js` 与 `useLedger` 数据层；应用启动后首页、合同、人员、字典、设置均能加载数据，控制台无报错
- [x] 7.4 合同/人员/字典列表改为服务端分页、筛选、排序；手工验证 375px 与桌面布局无横向溢出，翻页与筛选结果与接口一致
- [x] 7.5 `BackupPanel` 接入导出/导入端点，保留二次确认与只读禁用；手工验证导出文件不含密钥、导入后列表刷新
- [x] 7.6 删除 IndexedDB/localStorage 数据层与单文件构建脚本；`npm run build` 产物不再声称单文件，仓库中无残留 `store.js` 引用
- [x] 7.7 重写 `README.md` 与更新 `AGENTS.md`：新架构、命令、认证、迁移与回滚步骤；按 README 从零启动一次并跑通示例命令

## 8. 集成验收

- [x] 8.1 端到端：CLI、HTTP、MCP 各创建一份合同并登记同一笔付款（同一幂等键），断言只产生一条流水且三者查询结果一致
- [x] 8.2 并发：CLI 与 server 同时更新同一合同，断言无部分写入、无 `SQLITE_BUSY` 泄漏到用户层、最终版本单调递增
- [x] 8.3 恢复演练：备份 → 删除主库 → 从备份恢复 → `validate` 零错误，合同与流水数量一致
- [x] 8.4 性能抽查：生成 1 万份合同，列表分页与按方向统计走索引（`EXPLAIN QUERY PLAN` 无全表扫描），响应在本机可接受
- [x] 8.5 安全清单：回环绑定、Host 白名单、Origin 校验、CSRF、限流、令牌吊销、CSP、`nosniff` 逐项手工验证并记录结果

## Workflow follow-up

- 变更评审通过后执行 `/openspec-archive-change` 归档，并确认主 spec 合并结果。
- 归档后复核 `openspec/specs/` 中新增能力与 `ledger-persistence` 的合并文本。
