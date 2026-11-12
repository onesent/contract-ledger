# Proposal

## Why

当前只能从源码目录以 `node packages/server/dist/bin.js` 运行：没有版本标识、没有发布标签、没有升级路径，用户拿到仓库也不知道该跑哪一步。同时 `packages/server` 不托管前端，而 `guards.ts` 的 Host/Origin 白名单按服务端口精确匹配（Cookie 写请求还校验精确 `Origin`），所以「另起一个静态服务器托管 `packages/web/dist`」会让所有写操作被拒 —— 要能分发给最终用户，前端必须由服务同源托管。

交付目标是**「用户拿一个文件就能跑」**：一个 zip，解压即用，客户机不需要 Node、不需要安装步骤。zip 里直接放可运行内容（`node.exe` + 各包产物 + 迁移 + 前端），`ledger.exe` 只做入口——不自解压、不往用户目录复制程序，交付物内容与运行时目录一一对应，排障时程序与数据一目了然。

本变更补齐「可打包、可分发、可升级」的最小闭环，并守住既有硬约束：运行时零外部网络请求、只监听回环、写操作只经命令分发。

## What Changes

- 新增 `npm run package`：先把**产物**写到 `build/`（`payload/` 可运行包 + 载荷归档 zip），再用 Go 构建入口 `ledger.exe`（~7MB，不嵌载荷），组装 `build/dist/ledger-<version>-win-x64/` 并打成**唯一交付物** `release/ledger-<version>-win-x64.zip`（zip 内套一层版本目录，含入口 exe、`VERSION`、`build-info.json`、`node.exe`、各包产物、迁移、前端产物、`README.txt`、`SHA256SUMS`）。不再单独发布 exe。
- 启动器（`launcher/`，纯 Go、`CGO_ENABLED=0`、控制台子系统）承担：同目录运行时完整性自检、状态根与数据目录解析（`ledger.conf.json` 持久化、`--portable` 便携模式）、单实例与端口占用检测、停旧服（含按映像路径清理残留进程）、跨版本升级前备份、隐藏窗口启动服务、日志落盘、未配对时展示一次性配对码并打开浏览器、`cli` 命令转发（透传退出码）。升级/回滚/卸载不设子命令：升级就是解压新目录再启动（自动备份），卸载就是删目录。
- 新增 `npm run release -- patch|minor|major`：`validate` 全绿 → 升根版本号 → 由 Conventional Commits 生成 `CHANGELOG.md` → annotated tag `vX.Y.Z` → 出单文件 exe → 生成校验清单；**不自动 push**（AGENTS §8）。
- 服务新增同源静态托管：`/api/*` 走原认证链，其余路径返回前端构建产物，非资源路径回落 `index.html`；CSP 从「一刀切 `default-src 'none'`」改为按路径分层（API 保持最严，页面放开到 `'self'`）。
- 版本号单一来源为根 `package.json`：构建期写入 `packages/server/dist/build-info.json` 与载荷 `VERSION`，供 `/api/health.version`、`ledger.exe version` 与新增 `--version` 共用；`SERVER_VERSION` 硬编码值退化为开发态回落。
- 新增启动期降级保护：主库 `schemaversion` 高于本程序内置的最新迁移版本时拒绝启动，并给出可执行的恢复提示（含升级前备份路径）。
- 数据目录与程序目录分离：启动器固定传 `--data <home>\data`（`<home>` 默认 `%LOCALAPPDATA%\ledger`）；代码默认值不变。
- 明确非目标：Node SEA / pkg 单文件、在线自动更新、安装器（注册表/开机自启/系统服务）、代码签名、Docker 镜像、MCP 入包、自动回滚。
- 无 **BREAKING**：命令名与信封、DB schema、`/api/*` 端点语义均不变。

## Capabilities

### New Capabilities

- `app-distribution`: 自包含分发包、运行时完整性自检、目录级升级（同级版本目录并存）、单实例、日志、配对码、CLI 双角色、卸载保留数据、版本标识、离线升级与回滚流程、程序与数据目录分离、状态根可持久化、启动期降级保护。

### Modified Capabilities

- `ledger-service-api`: 新增「同源托管前端构建产物」与「CSP 按路径分层」两条要求；其余端点与错误映射不变。

## Impact

- 代码：
  - `packages/server/src/app.ts`（静态托管 + CSP 分路径 + 版本注入）、`main.ts`（`--version`、`--web-dir`、降级保护、`assertRuntime`）、`types.ts`（`AppOptions.version` / `webDir`）
  - `packages/storage-sqlite/src/migrate.ts`（新增 `latestMigrationVersion`，`defaultMigrationsDir` 支持 `LEDGER_MIGRATIONS_DIR`）
  - 新增 `launcher/`（`go.mod`、`main.go`、`home.go`、`runtime.go`、`archive.go`、`upgrade.go`、`commands.go`、`proc.go`、`console.go`、`pairing.go`、`process_scan.go`、`config.go` 与 Go 单测）
  - 新增 `scripts/package-payload.mjs`、`scripts/build-launcher.mjs`、`scripts/release.mjs`、`scripts/fetch-node.mjs`、`scripts/backup-data.mjs`
  - 新增 `docs/distribution.md`；`docs/security.md` 补静态托管 CSP 断言；`DECISIONS.md` 记录发布期工具链例外（Go 仅构建期，不入运行时）
  - `package.json`（`package` / `package:payload` / `package:exe` / `release` 脚本）、`.gitignore`（`build/`、`release/`）、`CHANGELOG.md`
- 不改动：`packages/core`（18 条命令契约与错误码目录）、`packages/web` 源码、DB schema（仍为单一迁移 `001_init.sql`，`schemaversion` 表沿用 Postgrator）。
- 依赖：运行期不新增依赖；构建期新增 **Go 工具链**（发布机已具备 1.27.4，`CGO_ENABLED=0`）并从 Node 官方分发下载 `node.exe` 并校验官方 `SHASUMS256.txt`（或 `--node-exe` 指向本地文件，供内网/离线构建）。
- 分发通道：Gitee Release 附件（`gitee.com/sentone/contract-ledger`，当前无 CI）。分发包实测 ~45MB（deflate 压缩后；`node.exe` 本身已压缩，其余为 JS/文本）。
- 风险面：静态托管放宽 CSP 影响 `docs/security.md` 既有断言；降级保护与启动器属新增启动失败路径，需要测试覆盖；未签名 exe 会触发 SmartScreen；升级与备份逻辑必须保证「备份失败即中止」。
