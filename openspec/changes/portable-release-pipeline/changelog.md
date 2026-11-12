# 变更记录：portable-release-pipeline

## 背景

台账目前只能从源码目录运行（`node packages/server/dist/bin.js`），没有版本标识、没有发布标签、没有升级路径；同时服务不托管前端，而 Host/Origin 白名单按端口精确匹配（Cookie 写请求还校验精确 `Origin`），因此「另起静态服务器托管 `packages/web/dist`」会导致所有写操作被拒。

交付目标是**「用户拿一个文件就能跑」**：一个 exe，双击即用，客户机不需要 Node、不需要安装、不需要控制台。因此本变更同时解决「单文件分发」与「同源托管」两件事。

## 关键决策

| 决策 | 选择 | 否决方案与理由 |
| --- | --- | --- |
| 交付形态 | **一个自包含 zip**：解压即得完整程序目录（`node.exe` + 各包产物 + 迁移 + 前端），`ledger.exe` 只是入口（Go ~7MB，控制台子系统），不自解压、不往用户目录复制程序 | 自解压 exe（`//go:embed` 载荷 → `%LOCALAPPDATA%\ledger\app\<version>\`）：等于把 41MB 再复制一份、程序藏在用户目录、升级要管版本目录；Node SEA：24.9.0 仍 experimental、产物 ≥120MB；yao-pkg：pkg-fetch v3.6 无 node24 资产；7-Zip SFX / IExpress：`%TEMP%` 两段解压、逻辑落 `.ps1`/`.cmd` 受 GPO 影响 |
| 启动器语言 | Go（`CGO_ENABLED=0`、控制台子系统、`-trimpath`） | C#/.NET：需 SDK 且自包含产物 ~15MB；Rust/C++：需工具链且同样要写同样的进程管理逻辑；纯 PowerShell：客户机受执行策略限制 |
| 前端托管 | 服务内 `serveStatic` 同源托管 + SPA 回落 | 另起静态服务器：跨端口必然被 Origin 校验拒绝（`allowedOrigins` 也未实现）；页面沿用 `default-src 'none'`：前端无法渲染 |
| 载荷依赖消解 | 运行时白名单 `package.json` + `npm install --omit=dev --ignore-scripts` + 显式解链复制并断言非符号链接 | 根 workspaces 直接 `--omit=dev`：实测 225MB（element-plus 58M、echarts 61M、typescript 23M、MCP 15M）；不加 `--ignore-scripts`：实测触发 `node-gyp rebuild`，无 VS Build Tools 直接失败 |
| 原生模块 | `better-sqlite3` 整层保留在 `node_modules/@ledger/storage-sqlite/node_modules/`，`prebuilds/` 只留目标平台 | 用 `nativeBinding` 注入外部 `.node`：目录布局与原安装一致，无需额外参数，减少改动面 |
| 迁移落位 | 复制到 `node_modules/@ledger/storage-sqlite/migrations`（`import.meta.url` 解析点），`LEDGER_MIGRATIONS_DIR` 兜底 | 放在 `packages/storage-sqlite/migrations`：`defaultMigrationsDir()` 找不到，启动即失败 |
| 版本来源 | 根 `package.json` → 载荷 `VERSION` / `dist/build-info.json` → `/api/health.version` / `ledger.exe version` / `--version` | 各包独立版本：私有包不发布，只会漂移；`SERVER_VERSION` 硬编码：无注入渠道 |
| 数据位置 | 入口默认传 `--data <状态根>\data`（默认 `%LOCALAPPDATA%\ledger\data`），代码默认值不变 | 改 `main.ts` 默认值：改变开发与测试语义，收益为零 |
| 升级方式 | 换目录：解压新版本 → 旧目录 `stop` → 新目录启动；启动时按 `VERSION` 差异自动备份（参考 syncthing「先校验再替换、保留旧版」与 VS Code 便携模式「程序目录可整体替换」） | `upgrade --from` 子命令：与「解压 + 启动」重复，还要维护解压暂存、校验、自删等边界；目录级原子交换（rename 成 `.old`）：Windows 下重命名含运行中 exe 的目录不稳定；自动下载更新：违反运行期零外部请求 |
| 降级保护 | 启动期比较库 schema 与程序最新迁移，库版本更高即拒绝启动，不入 `ERROR_CATALOG` | `--allow-downgrade`：旧代码读新表会静默写坏数据；新增错误码：该失败不属于命令结果 |
| 配对码展示 | 启动器从未配对时的日志抓取并 MessageBox 展示 + 打开浏览器 | 新增「未配对取码」端点：需改 `/api/auth` 契约与安全断言；保留终端窗口：不像成品软件，且错误一闪而过 |
| 更新机制 | 离线替换 exe + SHA-256 校验 + 升级前自动备份 | 在线检查/自动更新：违反「运行期零外部网络请求」，需改 `DECISIONS.md` 与安全断言 |
| 回滚 | 用旧目录启动 + 按需用备份覆盖数据库（文档给命令） | `rollback` 子命令：只是把文档里的三行命令包一层；自动回滚：自动覆盖数据风险高于人工确认 |
| 发版自动化 | 本地 `scripts/release.mjs`（Conventional Commits → CHANGELOG → tag → 出包） | release-please / semantic-release：需宿主 CI 与令牌，Gitee 支持不完整；changesets：面向多包 npm 发布，本项目不发布包 |

## 影响面

- 启动器安装目录可持久化：新增 `launcher/config.go` 与 `ledger.conf.json`（`installDir` / `dataDir`），解析链为 `--install-dir` > `LEDGER_HOME` > exe 旁配置 > exe 所在目录 > 默认目录，`--portable` 等价于「安装根 = exe 目录」；`status` 打印解析来源。

- 启动器参数解析：子命令不再要求是第一个参数（`ledger.exe --install-dir D:\ledger status` 曾报「未知参数」，等于所有命令在「选项在前」时全部失效），并支持 `--opt=value`；未初始化时 `status` 报「未初始化（尚未运行过）」、`stop` 幂等成功。

- 代码：`packages/server/src/{app,main,types}.ts`、`packages/storage-sqlite/src/migrate.ts`、新增 `launcher/`（Go）、新增 `scripts/{package-payload,build-launcher,release,fetch-node,backup-data}.mjs`、`package.json`、`.gitignore`、`README.md`、`docs/security.md`、新增 `docs/distribution.md`、`CHANGELOG.md`、`DECISIONS.md`（发布期工具链例外）。
- 不涉及：`packages/core`（18 条命令契约与错误码目录）、`packages/web` 源码、数据库 schema（仍为 `001_init.sql`）。
- 安全：页面路径 CSP 由 `default-src 'none'` 放宽为同源（含 `style-src 'self' 'unsafe-inline'`，Element Plus 运行时注入样式所需），API 路径维持最严；`docs/security.md` 需补对应断言与测试。配对码会留在本机日志中（与现状终端打印等价，本机可读）。
- 依赖：运行期零新增；构建期新增 Go 工具链（发布机已装 1.27.4），客户机零依赖。

## 兼容与回滚

- 兼容：命令名/信封、HTTP 端点语义、数据库结构均不变；源码目录运行方式与默认数据目录 `./data` 行为不变（静态托管仅在传入 `--web-dir` 时启用）。
- 数据库：本变更不新增迁移；升级前由启动器用 `VACUUM INTO` 备份。
- 回滚：用 `<data>/backups/upgrade-*.db` 恢复数据库（并删 `-wal`/`-shm`）后改用旧目录的 `ledger.exe` 启动；若旧版本低于数据库 schema，会被降级保护拦截。

## 遗留问题

- Gitee 单附件上限需在上传首包时确认；分发包实测 ~45MB（低于 100MB）。若未来超限，可改为只发 `node.exe` 之外的增量或拆分附件（结构不变）。
- 代码签名（消除 SmartScreen 提示）、Scoop manifest、`ledger.exe mcp` 入口均留待后续变更。
