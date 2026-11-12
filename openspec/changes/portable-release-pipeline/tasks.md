# Tasks

## 1. 服务端同源静态托管与 CSP 分层

- [x] 1.1 `types.ts` 增 `AppOptions.webDir?: string`，`app.ts` 在 `webDir` 存在时注册 `@hono/node-server/serve-static`：`/api/*` 保持既有中间件链，其余路径命中静态文件则返回，未命中且路径无扩展名时回落 `webDir/index.html`，未命中的资源路径返回 404；验证方式：集成测试覆盖根路径 200、`/assets/<file>` 200、未知资源 404、`/api/unknown` 仍为 problem+json
- [x] 1.2 改写 `app.ts` 现有的 `app.use('*')` 响应头中间件（不叠加新中间件）：`/api/*` 维持 `default-src 'none'` 与 `Cache-Control: no-store`，页面响应改为只许可同源脚本/样式（`style-src 'self' 'unsafe-inline'`）、同源请求与 `data:` 图片，并设 `Cache-Control: no-cache`；验证方式：单测断言两类路径的 CSP 与缓存头不同，且页面策略不含任何外部主机
- [x] 1.3 `main.ts` 解析 `--web-dir` / `LEDGER_WEB_DIR` 并传入 `AppOptions.webDir`，缺省不启用静态托管（开发态行为不变）；验证方式：现有服务端测试全绿 + 新增一条「未配置 webDir 时根路径仍为 problem+json 404」断言
- [x] 1.4 更新 `docs/security.md`：新增静态托管条目（同源、仅构建产物、页面 CSP 与 `unsafe-inline` 的最小化理由、`/api/*` 不受影响），每条断言对应到 1.1/1.2 的测试；验证方式：文档条目与测试文件可互相追溯

## 2. 版本标识贯通

- [x] 2.1 `AppOptions` 增 `version?: string`，`app.ts` 的健康端点改用 `options.version ?? resolveBuildInfo().version`，`main.ts` 新增 `--version`（打印版本后以 0 退出，不启动服务）；验证方式：单测断言自定义 version 出现在健康端点响应中，e2e 断言 `--version` 输出与退出码 0
- [x] 2.2 新增 `packages/server/src/build-info.ts`：按 工作区根 `package.json`（含 workspaces，开发态）→ 同目录 `build-info.json`（载荷）→ `SERVER_VERSION` 顺序解析版本，非法 JSON 或字段缺失时回落且不抛错；验证方式：单测覆盖三种回落路径与损坏 JSON
- [x] 2.3 `main.ts` 启动时校验运行时版本（`MIN_NODE_VERSION` 常量或 `engines.node`），过低时中文报错并退出码 1；**不得 import `scripts/check-runtime.mjs`**（`packages/server` 的 `rootDir` 为 `src`、该文件是包外 `.mjs`，`tsc -b` 会失败）；验证方式：单测用伪造版本断言抛错文案，正常路径不干扰既有启动测试

## 3. 迁移版本可读与降级保护

- [x] 3.1 `migrate.ts` 新增导出 `latestMigrationVersion(dir: string): number`（目录内 `*.sql` 的最大编号，无文件返回 0），`defaultMigrationsDir()` 支持 `LEDGER_MIGRATIONS_DIR` 覆盖且缺省不变；验证方式：单测覆盖空目录、单文件、多文件与环境变量覆盖
- [x] 3.2 `main.ts` 在 `migrateDatabase` 之前比较 `currentSchemaVersion(db)` 与 `latestMigrationVersion(dir)`，库版本更高时关闭连接并抛中文错误（含两侧版本与 `<data>\backups` 路径），进程退出码 1；不新增 `ERROR_CATALOG` 条目；验证方式：集成测试把 `schemaversion` 置为 `999` 后启动被拒且数据库未被修改
- [x] 3.3 在 `docs/distribution.md` 写下迁移不可变规则（已发布迁移不得修改，`validateChecksums` 会在启动时拒绝）与降级保护的用户可见行为；验证方式：文档中的命令与错误文案与 3.1/3.2 实现一致

## 4. 载荷打包（payload）

- [x] 4.1 新增 `scripts/fetch-node.mjs`：解析目标平台的官方 Node 版本包，支持 `--node-exe <path>` 直取本地文件与缓存复用，下载路径强制校验官方 `SHASUMS256.txt`；验证方式：单测覆盖「本地直取」「缓存命中」「哈希不匹配时报错」三条路径（网络调用注入桩）
- [x] 4.2 新增 `scripts/package-payload.mjs`：前置校验 `packages/*/dist`、`packages/web/dist`、迁移目录、Go 工具链版本与 `go.mod` 声明一致；在临时目录生成**运行时白名单 `package.json`**（hono / @hono/node-server / zod / kysely / postgrator / better-sqlite3 / commander）并以 `npm install --omit=dev --ignore-scripts --no-audit --no-fund` 安装；验证方式：单测覆盖白名单内容、路径映射与「缺前置条件给出中文错误」
- [x] 4.3 软链消解：把 `packages/{core,storage-sqlite,server,cli}` 的 `dist` + `package.json` 复制进 `node_modules/@ledger/*` 为**真实目录**并断言不是 symlink；`storage-sqlite` 另复制 `migrations` 到 `node_modules/@ledger/storage-sqlite/migrations`；`better-sqlite3` 按实际安装位置整层保留（实测白名单安装提升到根 `node_modules/`），`prebuilds/` 只保留 `<platform>-<arch>.node`；验证方式：单测覆盖复制清单与 prebuilds 裁剪结果，组装后实机 `node.exe` 能加载 `better-sqlite3` 并读到迁移目录
- [x] 4.4 组装**产物**到 `build/`：`build/payload/`（可运行包）+ `build/ledger-payload-<version>-<platform>-<arch>.zip` 与其 sha256，并写出 `VERSION` 与 `node_modules/@ledger/server/dist/build-info.json`（同一份数据）；验证方式：`npm run package` 产出后可运行包内 `node.exe node_modules/@ledger/server/dist/bin.js --version` 直接可跑
- [x] 4.5 `package.json` 增 `package` / `package:payload` / `package:exe` 脚本，`.gitignore` 忽略 `build/` 与 `release/`；验证方式：`npm run package` 连续两次产出相同分发包 sha256（可复现），`git status` 干净

## 5. Go 入口（zip 内含可运行树）

- [x] 5.1 新增 `launcher/`（`go.mod` 固定 `go 1.27`）：**不再嵌入载荷**，`start` 先做同目录运行时自检（`node.exe` / `VERSION` / server+cli 入口 / `packages/web/dist/index.html` / 迁移），缺失时中文列出缺项 + 退出码 3 且不落任何目录；版本读 `VERSION` 纯文本；验证方式：`go test` 覆盖运行时自检、版本读取与参数解析
- [x] 5.2 进程生命周期：`run\ledger.pid` 读写 + `/api/health` 校验 version 与 pid 一致（避免 PID 复用误杀）→ `taskkill /PID <pid> /T /F`；`stop` / `status` 子命令；单实例（已在运行则只打开浏览器并退出码 0）；端口被其他程序占用时中文提示 + 退出码 4；验证方式：`go test` 覆盖 pid 复用校验与参数解析，手工验证二次双击不重复起服
- [x] 5.3 起服：隐藏窗口 spawn `node.exe node_modules\@ledger\server\dist\bin.js --data <data> --web-dir <程序目录>\packages\web\dist --port <port>`，stdout/stderr 追加写 `logs\server-<version>-<YYYYMMDD>.log`，detach；轮询 `/api/health` 至就绪（上限 30s）后打开默认浏览器；验证方式：手工验证日志落盘、关闭启动器后服务仍存活
- [x] 5.4 配对码：`/api/auth/session` 返回 401 时从本次日志提取「一次性配对码」，用 MessageBox 展示（含配对页说明）；已配对则只打开浏览器；验证方式：干净用户目录下首次双击能看到配对码并完成配对
- [x] 5.5 CLI 双角色：`cli <args>` / `server <args>` 转发到同目录入口，继承调用方 stdout/stderr（控制台经 `WriteConsoleW`、管道保持 UTF-8 字节；句柄无效时 `AttachConsole(ATTACH_PARENT_PROCESS)` 兜底），透传退出码（`0/1/2/4`）；启动器选项与子命令顺序无关；验证方式：`go test` 覆盖参数分派与退出码映射，手工验证 `ledger.exe cli contract list --json` 在 cmd / PowerShell / Git Bash 下均有输出
- [x] 5.6 升级即换目录（无子命令）：启动时比较包内 `VERSION` 与状态根 `current.json`，不同且 `data\ledger.db` 存在则先用运行时内 CLI 做一致性备份（失败中止，退出码 6），再停旧服、起新版、写 `current.json`；就地覆盖同样触发；旧目录不自动删除；验证方式：Go 单测覆盖 `current.json` 读写与备份改名，实机解压 1.0.1 到并列目录启动后旧目录仍在、备份一份、数据完好
- [x] 5.7 卸载即删目录（无子命令）：`stop` 后由用户删除程序目录，需要时再删状态根；文档写明「先停服再删、数据与程序分离」与「当前目录不能自删」的限制；验证方式：手工 `stop` → 删目录 → 用另一份分发包启动，数据仍在
- [x] 5.9 状态根持久化：新增 `ledger.conf.json`（`installDir` / `dataDir`），解析链 `--install-dir` > `LEDGER_HOME` > exe 旁配置 > exe 目录便携布局（含 `data\` / `run\` / `current.json`）> `%LOCALAPPDATA%\ledger`；`start` 与 `cli`/`server` 成功后写回状态根，exe 不在状态根内时补旁挂配置（默认状态根不写，避免污染下载目录）；`--portable` 等价于「状态根 = exe 目录」；`status` 打印解析来源，卸载清理配置；验证方式：`go test` 覆盖解析优先级、配置读写与清理，手工验证「首次带 `--install-dir`，后续不带参数仍指向同一目录」
- [x] 5.8 `scripts/build-launcher.mjs`：构建入口 exe（`go build -trimpath -ldflags "-s -w -X main.version=<v>"`，控制台子系统、不嵌载荷，~7MB）→ 组装 `build/dist/ledger-<version>-win-x64/`（payload + exe + README + 内层 SHA256SUMS）→ 以 deflate 打成 `release/ledger-<version>-win-x64.zip`（zip 内套一层版本目录）+ `.sha256` + `SHA256SUMS`；不再单独发布 exe；验证方式：解压后 `ledger.exe --version` / `status` / `start` 直接可用，连续两次打包 zip sha256 相同

## 6. 备份与手工升级兜底

- [x] 6.1 备份复用既有 CLI（`ledger backup` → `backupDatabase` / `VACUUM INTO` + 完整性检查），启动器只负责调用并改名为 `<data>/backups/upgrade-<旧版本>-<时间戳>.db`，不新增备份脚本（AGENTS §2）；验证方式：Go 单测覆盖改名与备份列表，实机升级后 `cli validate` 通过
- [x] 6.2 更新 `docs/distribution.md`：交付物结构、解压即用、状态根与 `ledger.conf.json`、升级（换目录）、回滚（旧目录 + 备份覆盖）、卸载（删目录）、发版清单；验证方式：按文档步骤在一份测试数据上完成一次升级与一次回滚

## 7. 发版流程

- [ ] 7.1 新增 `scripts/release.mjs`：`validate` 失败即中止 → `npm version <type> --no-git-tag-version` → 由 Conventional Commits 生成 `CHANGELOG.md` 顶部条目（新增/修复/变更/安全）→ `git commit` + annotated tag `vX.Y.Z` → 出分发包 zip → 打印人工推送与 Gitee 上传步骤，**不执行任何 push**；验证方式：单测覆盖提交前缀到分段的映射与版本号递增，`--dry-run` 下仓库与 tag 均无变化
- [ ] 7.2 首次生成 `CHANGELOG.md`（含 `v1.0.0` 条目）并在 `docs/distribution.md` 记录发版清单（tag、附件、校验值、Gitee Release 说明）；验证方式：`npm run release -- --dry-run patch` 输出的段落与 CHANGELOG 结构一致

## 8. 集成验收

- [ ] 8.1 手工冒烟全流程（**干净用户、未安装 Node**）：解压 zip → `ledger.exe --version` → 双击（配对码弹窗）→ 完成配对并建合同/登记流水 → 再次双击（单实例，只开浏览器）→ 解压新版本到并列目录并启动（停旧服、自动备份、旧目录保留、数据仍在）→ 用旧目录 exe 启动被降级保护拦下 → `ledger.exe cli contract list --json` 可用 → `stop` 后删程序目录，`data\` 仍在；验证方式：把每一步的实际输出与截图/日志记录到本变更的 `changelog.md`
- [ ] 8.2 全量门槛：`npm run typecheck`、`npm test`、`go vet ./... && go test ./...`、`npm run build -w @ledger/web`、`npm run package` 全部通过，且 `openspec validate portable-release-pipeline --strict` 无告警

## 9. 文档与决策

- [x] 9.1 `DECISIONS.md` 记录「发布期工具链例外」：Go 仅用于构建入口 exe（控制台子系统、不嵌载荷），不入运行时、不改变后端 TypeScript/前端 JavaScript 约定（AGENTS §3.11），并写明 zip 内含可运行树、目录级升级与 `go.mod` 版本下限
- [x] 9.2 `README.md` 补「下载 zip → 解压 → 双击 → 配对 → 建合同」一节与 `status/stop/cli/upgrade/rollback/uninstall` 用法；验证方式：README 中命令逐条可执行

## Workflow follow-up

- 变更完成并验收后归档（`openspec archive`），`changelog.md` 随变更整体移入 `changes/archive/`。
- 归档后确认 `docs/distribution.md`、`docs/security.md` 与 `DECISIONS.md` 已包含本变更的全部结论。
