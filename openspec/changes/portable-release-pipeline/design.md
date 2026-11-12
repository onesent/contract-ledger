# Design

## Context

见 `proposal.md` - Why。以下均为实测（Windows 11 / Node v24.9.0 / Go 1.27.4 / 2026-11）。

**依赖与体积（实测）**

- npm workspaces monorepo，`node_modules/@ledger/*` 全是指向 `packages/*` 的**符号链接**，Windows zip 无法承载。
- `better-sqlite3` 13.0.3 嵌套在 `packages/storage-sqlite/node_modules`，`prebuilds/` 含 8 个平台二进制（17MB），`lib/binding.js` 用 `__dirname` 相对路径查找；包内 `gypfile: false`，但 `npm ci` 仍会跑默认的 `node-gyp rebuild` —— 实测无 VS Build Tools 时以 `gyp ERR! find VS` 中止，**必须加 `--ignore-scripts`**。
- 生产依赖：根 workspaces 直接 `npm ci --omit=dev` 得 **225MB**（element-plus 58M、echarts 61M、typescript 23M、@modelcontextprotocol 15M 等 web/mcp 产物依赖）；按运行时白名单（hono / @hono/node-server / zod / kysely / postgrator / better-sqlite3 / commander）安装得 **48MB**，裁掉非目标平台 `prebuilds/` 后约 **33MB**。
- `node.exe`（v24.9.0 win-x64）**89.7MB**（官方 zip 36.4MB）→ 分发包必须压缩：当前 zip 实测 **45MB**（deflate 后），未压缩目录约 130MB，仍低于 Gitee 100MB 附件上限。

**代码现状（实测）**

- 迁移单文件 `001_init.sql`；`migrate.ts` 已实现 `BEGIN IMMEDIATE` 串行化、`validateChecksums: true`、导出 `currentSchemaVersion` / `vacuumInto`；`defaultMigrationsDir()` 基于 `import.meta.url` → 包内解析到 `node_modules/@ledger/storage-sqlite/migrations`（不是 `packages/storage-sqlite/migrations`）。
- `packages/server` 无静态路由；`app.ts` 的 `app.use('*')` 在 `next()` 后统一下发 `default-src 'none'` 与 `Cache-Control: no-store`；`guards.ts` 的 Host/Origin 白名单按 `options.port` 精确构造；`AppOptions.allowedOrigins` 目前**未被 `buildAllowlists` 使用**。
- 版本：根 `package.json` = `1.0.0`，各包 `0.0.0`，`app.ts` 的 `SERVER_VERSION = '0.0.0'`；`scripts/check-runtime.mjs` 的 `MIN_NODE_VERSION = '24.0.0'`。
- 基线：`bin.js --port 4599` 起服成功，`/api/health` 200（`version: "0.0.0"`），`/` 返回 problem+json 404 + 严格 CSP。
- 配对码仅在启动时由 `main.ts` 打印到 stdout（`一次性配对码：XXXXXXXX`），无其他获取渠道。

**发布机现状（实测）**

- Windows，无 CI；Go 1.27.4（`CGO_ENABLED=0`）；无 7-Zip / dotnet / rustc；`iexpress.exe` 与 `tar.exe` 为系统自带。
- `@yao-pkg/pkg` 6.25.0：`--targets node24-win-x64` 无预编译资产；`node22` 被解析为 v22.23.4 而 pkg-fetch v3.6 只有 v22.22.3/v22.23.1 → 两者均回落「从 Node 源码编译」，本机缺 NASM/VS 直接失败。

## Goals / Non-Goals

**Goals:**

- 用户只拿**一个 zip**，解压后即可运行（目录内自带 `node.exe` 与全部依赖，`ledger.exe` 只是入口）：客户机无 Node、无 Go、无安装步骤；命令行下 `ledger.exe --help` / `status` / `cli …` 直接有输出（控制台子系统），双击则由系统打开一个控制台窗口展示启动信息。
- 版本号单一真相：包内 `VERSION`、`build-info.json`、`/api/health.version`、`--version` 四处一致；`ledger.exe` 文件名不带版本号。
- 升级离线完成、程序与数据目录分离、旧版本可回滚、旧程序不得写入新结构数据库。
- 前端由服务同源托管，不引入反向代理或第二个端口。

**Non-Goals:**

- Node SEA / yao-pkg 单 exe（见 Decisions §1）。
- 在线检查或自动更新、自建更新服务器、代码签名、macOS 公证、Docker 镜像。
- 安装器写注册表 / 开机自启 / Windows 服务 / 托盘常驻。
- **自动回滚**：只保留旧版本目录与升级前备份，回滚由人显式执行。
- MCP 入包；`packages/core` 与 18 条命令契约的任何改动。

## Decisions

### 1. 交付形态：zip 内含可运行树，ledger.exe 只是入口

分发包 `ledger-<version>-win-x64.zip` 解压后就是完整程序目录，`ledger.exe`（Go，~7MB）只负责校验、起服、停服、升级、卸载与 CLI 转发，**不嵌入、也不解压载荷**。

- 否决「自解压 exe（`//go:embed` 压缩载荷 → 解压到 `%LOCALAPPDATA%\ledger\app\<version>\`）」：交付语义应是「解压即可运行」，自解压等于把 41MB 载荷再复制一份、把程序藏在用户目录里（排障时分不清程序与数据）、首启多一次解压与校验、升级还要管理版本目录与清理策略。既然分发包本来就是一个 zip，直接放可运行内容更简单、更透明。
- 备选 A：Node SEA 单 exe → 否决：`--experimental-sea-config` 在 24.9.0 仍 experimental；stub 内 node runtime 未压缩，产物 ≥120MB；需 esbuild 打 CJS bundle（全仓 ESM）；`.node` 必须落盘后 `require`，要改 `openDatabase` 签名（与 §2「不改签名」冲突）；迁移与静态资源在快照 FS 中的行为未验证。
- 备选 B：yao-pkg → 否决：文档支持 node22/node24，但 pkg-fetch v3.6 无 node24 资产、node22 版本号错位，实测两目标均回落 Node 源码编译并失败；若降级到可用的 node22 还要下调 `MIN_NODE_VERSION`。
- 备选 C：7-Zip SFX / IExpress → 体积合格，但每次启动先解到 `%TEMP%`（35MB，1–2s）、无 PE 版本资源、逻辑要落到 `.ps1`/`.cmd`（企业 GPO 可能禁脚本）、SFX/AV 噪音更高。
- 备选 D：Electron / NSIS 安装器 → 否决：引入安装器语义（注册表、卸载项、开机项），与「便携、可整体替换」冲突。

Go 入口约束：`CGO_ENABLED=0`（纯静态、无 MSVC）、`-trimpath -ldflags "-s -w"`（**控制台子系统**、可复现）、`go.mod` 固定 `go 1.27` 并记入 `DECISIONS.md`（AGENTS §3.11 的发布期工具例外）。

### 2. 产物与目录布局

```text
build/                                       # 产物（不入库、不发布）
  payload/                                   # 可运行包：node.exe + node_modules + packages + VERSION
  ledger-payload-<version>-win32-x64.zip     # 载荷归档（排障/分发中间物）
  launcher/ledger.exe                        # 入口 exe（~7MB）
  dist/ledger-<version>-win-x64/             # 组装好的可运行目录（= zip 解压结果）
  .cache/                                    # Node 运行时下载缓存

release/                                     # 交付目录
  ledger-<version>-win-x64.zip               # 分发包（唯一交付物）
  ledger-<version>-win-x64.zip.sha256
  SHA256SUMS                                 # 只列分发包
```

分发包内部结构（顶层套一层版本目录，解压不散落文件）：

```text
ledger-<version>-win-x64/
  ledger.exe                                  # 入口，文件名不带版本号
  VERSION                                     # 纯文本版本号（唯一权威）
  build-info.json                             # 版本/提交/构建时间/平台/Node 门槛
  node.exe                                    # Node v24.9.0
  node_modules/…                              # 运行时白名单依赖（真实目录，无符号链接）
  node_modules/@ledger/{core,storage-sqlite,server,cli}/{dist,package.json}
  node_modules/@ledger/storage-sqlite/migrations/  # 迁移（import.meta.url 解析点）
  better-sqlite3/（按实际安装位置保留，prebuilds/ 只留 win32-x64）
  packages/web/dist/                          # 前端产物（--web-dir 指向此处）
  README.txt  SHA256SUMS                      # 说明与关键文件校验值
```

状态根（默认 `%LOCALAPPDATA%\ledger`，可用 `--install-dir` / `LEDGER_HOME` / exe 旁 `ledger.conf.json` / `--portable` 改）：

```text
<state>\
  data\ledger.db  data\backups\                # 业务数据与备份（唯一真相源）
  logs\                                        # 服务与启动器日志
  run\ledger.pid                               # 运行状态（pid/端口/版本）
  current.json                                 # 上次成功启动的版本与程序目录
  ledger.conf.json                             # 生效目录配置
```

关键处理：

- **软链消解**：以运行时白名单 `package.json` 安装生产依赖（`--ignore-scripts`），随后把 `packages/{core,storage-sqlite,server,cli}` 的 `dist` + `package.json`（storage-sqlite 另含 `migrations`）复制为**真实目录**，并断言结果不是符号链接。
- **原生模块**：`better-sqlite3` 的位置**以安装结果为准**（实测白名单安装提升到根 `node_modules/better-sqlite3`，仓库开发态则在 `packages/storage-sqlite/node_modules`），打包脚本按实际路径整层保留并断言 `lib/binding.js` 的相对 `prebuilds/` 可解析；`prebuilds/` 只留 `<platform>-<arch>.node`；`openDatabase` 签名不变。
- **迁移路径**：必须复制到 `node_modules/@ledger/storage-sqlite/migrations`，否则 `defaultMigrationsDir()` 找不到（`LEDGER_MIGRATIONS_DIR` 作为兜底覆盖）。
- **前端**：`packages/web/dist` 原样拷入，`base: '/'` 已满足同源根路径。
- **zip 压缩**：内容是 JS/文本 + 一个已压缩的 `node.exe`，用 deflate（level 6，条目排序 + 固定时间戳，同 commit 可复现）；`node.exe` 压缩后更大时该条目退回 store。
- 数据目录**不入包**；`data/`、`build/`、`release/` 均在 `.gitignore`。

### 3. Go 入口运行模型

```text
ledger.exe                      起服务（等价于 start）
ledger.exe start [--port N] [--data D] [--install-dir D] [--portable] [--no-browser]
ledger.exe stop | status        停服 / 查看版本、程序目录、状态目录（含来源）、运行状态
ledger.exe cli <args...>        转发到 node_modules/@ledger/cli/dist/bin.js，透传退出码
ledger.exe server <args...>     转发到 node_modules/@ledger/server/dist/bin.js（高级用法）
ledger.exe version | help

入口只做「起服 / 停服 / 状态 / 转发」；升级、回滚、卸载都是文件操作（见 §10），
不提供 upgrade / rollback / uninstall 子命令——程序本身就是解压目录，多一层命令
只会与「复制/删除文件夹」重复，还要额外处理自删、半成品清理等边界。
```

启动流程（`start`）：

```text
1 校验同目录运行时：node.exe / VERSION / server+cli 入口 / web dist / migrations
  缺失 → 中文列出缺哪几项 + 退出码 3（提示「把 zip 完整解压后再运行」）
2 解析状态根（--install-dir > LEDGER_HOME > exe 旁 ledger.conf.json > exe 目录便携布局 > 默认）
  与数据目录（--data > 配置文件 > <state>\data）；建 data/logs/run
3 单实例：读 run\ledger.pid → GET /api/health 校验 version 与 pid 存活
  一致 → 视为已在运行：只打开浏览器并退出码 0（不重复起服）
  进程已死/版本不符 → 停旧服后继续；再按映像路径兜底清理同目录残留进程
4 端口占用：目标端口被其他程序占用 → 中文提示（含占用端口、--port 建议、去旧目录 stop）+ 退出码 4
5 跨版本（current.json 的版本 ≠ 本次 VERSION，且 data\ledger.db 存在）：
  用同目录 node.exe 跑 `@ledger/cli backup --data <data> --json`
  → 改名为 data\backups\upgrade-<旧版本>-<UTC>.db；失败即中止（不启动新版本，退出码 6）
6 spawn node.exe node_modules/@ledger/server/dist/bin.js
  --data <data> --web-dir <root>\packages\web\dist --port <port>
  隐藏窗口、stdout/stderr 追加写 logs\server-<version>-<YYYYMMDD>.log、detach；
  写 run\ledger.pid
7 轮询 /api/health 至就绪（上限 30s）→ 打开默认浏览器 http://127.0.0.1:<port>
8 未配对（/api/auth/session 返回 401）时，从本次日志中提取「一次性配对码」并展示
9 写 current.json（版本 + 程序目录）与 ledger.conf.json；清理上次中断留下的 *.new / *.old
```

其它约束：

- `stop`：读 pid → 校验 health.version 与 pid 一致（避免 PID 复用误杀）→ `taskkill /PID <pid> /T /F` → 删 pid 文件；找不到进程时幂等成功。
- **按路径清理残留进程**：`run\ledger.pid` 会被覆盖或丢失，单靠 pid 停不掉残留 `node.exe`（它们锁住 exe/`node_modules`）。`stop`（无 pid 记录时）与 `start`（停旧服后）都按映像路径枚举并结束进程（Toolhelp32 快照 + `QueryFullProcessImageNameW` + `taskkill /T /F`），并等进程真正退出后再继续，避免文件被锁。
- `cli`/`server` 转发：继承调用方 stdout/stderr（控制台用 `WriteConsoleW`、管道用原始字节）；句柄无效时退回 `AttachConsole(ATTACH_PARENT_PROCESS)` 重绑。退出码必须透传（`0/1/2/4`）。
- **子系统选择：控制台子系统**（不用 `-H windowsgui`）。GUI 子系统在 mintty/Git Bash 这类纯 pty 终端下拿不到 stdout 句柄，`ledger.exe --help` / `status` / `cli …` 会静默无输出——「解压后即可运行」的底线被破坏。代价是双击时系统会开一个控制台窗口：用 `GetConsoleProcessList` 判定「控制台只有本进程」（即双击新建的窗口），此时除打印外**同时弹消息框**展示一次性配对码，避免窗口随启动器退出而关闭、用户来不及看。
- 控制台编码：面向用户的输出统一经 `WriteConsoleW`（UTF-16）写入控制台，与代码页无关；写管道/文件时保持 UTF-8 字节（便于 `grep`/`jq`/编辑器识别）。有控制台时额外把输出代码页临时切到 65001（退出时恢复）。
- **安装根可持久化**：`--install-dir` / `LEDGER_HOME` 不持久，每次命令都传极易指错目录。因此引入 `ledger.conf.json`（`installDir` / `dataDir`），解析顺序为 `--install-dir` > `LEDGER_HOME` > exe 旁配置 > exe 目录便携布局 > 默认；`start` 与 `cli`/`server` 成功后写回状态根，exe 不在状态根内时再补一份旁挂配置。默认状态根不写旁挂文件（避免污染下载目录）。`--portable` 是「状态根 = exe 目录」的语法糖。
- **子命令与选项顺序无关**：`parseArgs` 扫描全部参数，第一个非选项词即子命令；`cli` / `server` 之后的参数原样转发。
- **未初始化状态有确定行为**：`status` 报「未初始化（尚未运行过）」并给出首次 `start` 会在状态根下创建 `data/logs/run`，`stop` 幂等成功。
- 包内不含业务数据、备份、日志或密钥（与 spec 一致）。

### 4. 静态托管与 CSP 分层

在 `createApp` 中按路径分叉，不新增依赖（`@hono/node-server/serve-static` 已随依赖安装，实测 2.1.7 导出 `root/path/index/rewriteRequestPath/onFound/onNotFound`，内部用 `statSync` + `createReadStream`）：

```text
/api/*                  → 既有 Host/Origin/认证/CSRF/限流链 → 路由 → JSON 信封
其余路径                → serveStatic(webDir) → 命中则返回文件
未命中且路径无扩展名    → 返回 webDir/index.html（SPA 回落）
未命中的资源路径        → 404（不回退 index.html）
未配置 webDir           → 行为与现状一致（problem+json 404）
```

CSP 与缓存分两档（改 `app.use('*')` 这一个中间件，不叠加新中间件）：

```text
API：   default-src 'none'; frame-ancestors 'none'; base-uri 'none'   Cache-Control: no-store
页面：  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
        img-src 'self' data:; font-src 'self' data:; connect-src 'self';
        frame-ancestors 'none'; base-uri 'none'                        Cache-Control: no-cache
```

`style-src 'unsafe-inline'` 的必要性：Element Plus 运行时注入样式；`img-src data:` 的必要性：`index.html` 内联 SVG favicon。

- 备选：另起静态服务器（`serve` / Vite preview）→ 否决：Cookie 写请求的精确 `Origin` 校验含端口，跨端口必然被拒（且 `allowedOrigins` 尚未实现），等于要加反向代理。

### 5. 版本单一来源与注入

```text
根 package.json version ──build──▶ 包内 VERSION（纯文本版本号，入口据此判版本）
                                  ├─ build-info.json（version/gitSha/builtAt/node/schema/platform/arch/runtime）
                                  ├─ node_modules/@ledger/server/dist/build-info.json（同一份数据）
                                  └─ /api/health.version、ledger-server --version、ledger --version
```

- 解析顺序（`packages/server/src/build-info.ts`）：工作区根 `package.json`（含 `workspaces`，开发态）→ 同目录 `build-info.json`（分发包内）→ `SERVER_VERSION` 常量。分发包内没有工作区根，因此两条路径不互相污染；开发态即使 `dist/build-info.json` 是旧构建也以 package.json 为准。入口侧另读包内 `VERSION`（纯文本）作为 `ledger.exe --version` 的来源。
- `build-info.json` 由打包脚本写进 **staging** 的 `node_modules/@ledger/server/dist/`，不污染源码树的 `packages/*/dist`。
- CLI 与 server 共用 `resolveBuildInfo()`（CLI 从 `@ledger/server` 导入），因此 `ledger --version` 与健康端点同源。
- Node 门槛单一来源是根 `package.json` 的 `engines.node`：`scripts/check-runtime.mjs` 与 `build-info.ts` 都从它派生（`DEFAULT_MIN_NODE_VERSION` 由单测守护与之一致），启动时 `assertNodeSupported(process.versions.node, minNodeVersion)` 校验，失败以中文错误退出码 1 终止。
- `AppOptions.version?: string` 可显式注入（测试与启动器使用），缺省走上述解析链。

### 6. 数据目录解析

```text
--data（server 参数） > LEDGER_DATA_DIR > 启动器传入的 <state>\data
```

启动器默认显式传 `--data <state>\data`（`--data` / `ledger.conf.json` 可改）；`main.ts` 现有缺省 `./data` **保持不变**，开发态与全部现有测试行为不变。

### 7. 降级保护

`main.ts` 在 `migrateDatabase` **之前**执行：

```text
dbSchema      = currentSchemaVersion(db)
programLatest = latestMigrationVersion(migrationsDir)   # 新增导出：目录内 *.sql 最大编号
programLatest > 0 且 dbSchema > programLatest
  → 关闭连接，抛中文错误（含两侧版本与 data\backups 路径），进程退出码 1
```

- 属启动阶段失败，不是命令结果 → **不新增 `ERROR_CATALOG` 条目**，不改 `packages/core`。
- `latestMigrationVersion` 放在 `packages/storage-sqlite/src/migrate.ts`，与 `currentSchemaVersion` 相邻便于单测。
- `defaultMigrationsDir()` 增加 `LEDGER_MIGRATIONS_DIR` 覆盖，缺省行为不变。
- 已发布迁移不可变由既有 `validateChecksums: true` 保证，无需新增代码。
- 备选：`--allow-downgrade` → 否决：旧代码读新表会静默写坏数据。

### 8. 打包（`npm run package`）

`scripts/package-payload.mjs` 步骤：

1. 前置校验：`packages/*/dist`、`packages/web/dist`、迁移目录、Go 工具链（`go version` ≥ `go.mod` 声明）存在；缺失即中文报错并提示先跑 `npm run build` / `npm run build -w @ledger/web`。
2. 解析目标平台：默认当前 `process.platform`/`process.arch`，可 `--platform`/`--arch` 覆盖（本变更只验证 win-x64）。
3. 准备 `node.exe`：`--node-exe` 本地文件 > 缓存 `build/.cache/node-<version>-<platform>-<arch>.zip` > 官方源下载并用官方 `SHASUMS256.txt` 校验（构建期联网属发布机行为，不违反运行期约束）。
4. 在临时目录生成**运行时白名单 `package.json`**（依赖版本从仓库 `packages/*/package.json` 精确复制，不写 `^`/`*`，保证可复现）并安装：`npm install --omit=dev --ignore-scripts --no-audit --no-fund`（避开 workspaces 与 web/mcp 依赖膨胀；`--ignore-scripts` 是硬要求，见 Context）；失败即中止并说明原因。
5. 组装 staging：软链消解（`dist` + `package.json` + `migrations` 复制为真实目录并断言非 symlink）、`prebuilds/` 只留目标平台、拷入 `web/dist`。
6. 写 `VERSION`（**纯文本版本号**，启动器据此判版本）、`build-info.json`（version/gitSha/builtAt/node/schema/platform/arch/runtime）与 staging 内的 `node_modules/@ledger/server/dist/build-info.json`（同一份数据），`node` 字段取自根 `package.json` 的 `engines.node`。
7. 生成载荷 zip `build/ledger-payload-<version>-<platform>-<arch>.zip` 并记录其 sha256。
8. 产物归档到 `build/`：`build/payload/`（可运行包）与 `build/ledger-payload-<version>-<platform>-<arch>.zip`。

`scripts/build-launcher.mjs` 步骤（产出**分发包**）：

1. 构建入口 exe：`go build -trimpath -ldflags "-s -w -X main.version=<v>"`（控制台子系统，不嵌入载荷）→ `build/launcher/ledger.exe`（~7MB）。
2. 组装可运行目录 `build/dist/ledger-<version>-win-x64/`：拷入 `build/payload/` 全部内容 + `ledger.exe` + `README.txt` + `SHA256SUMS`（只列 `ledger.exe` / `node.exe` / `VERSION`，升级时据此自检）。
3. 打 zip：`writeZip` 以 `build/dist` 为根、条目 `ledger-<version>-win-x64`（zip 内套一层版本目录），deflate level 6、条目排序 + 固定时间戳 → `release/ledger-<version>-win-x64.zip`（~45MB）+ `.sha256` + `SHA256SUMS`。
4. 不再产出单独的 `release/ledger.exe`：exe 离开同目录运行时无法运行，单独发布只会误导。

- 备选：只发 zip 让用户自备 Node → 否决（客户机需 Node 与网络，违背目标）。
- 备选：release-please / semantic-release / changesets → 否决（需宿主 CI 与令牌；changesets 面向 npm 多包发布）。

### 9. 发版流程（`npm run release -- patch|minor|major`）

1. `npm run validate` 失败即中止。
2. `npm version <type> --no-git-tag-version`（只改根 `version` 与 lock）。
3. 由 Conventional Commits 生成 `CHANGELOG.md` 顶部条目（新增/修复/变更/安全四段）。
4. `git add` + `git commit -m "chore(release): vX.Y.Z"` + `git tag -a vX.Y.Z`。
5. 调 `package-payload.mjs` + `build-launcher.mjs` → `release/ledger-<version>-win-x64.zip` 与校验清单。
6. **不 push**：打印 `git push origin main --follow-tags` 与 Gitee 发版清单（上传 zip 与 `.sha256`、粘贴 CHANGELOG 段落）。

### 10. 升级与回滚

- **升级 = 换目录**：新 zip 解压到任意位置 → 旧目录 `ledger.exe stop` → 新目录 `ledger.exe`。启动时比较包内 `VERSION` 与 `current.json`，不同且库存在则先备份（失败即中止，退出码 6），再停旧服、起新版、写 `current.json`；旧目录不自动删除。
- **就地覆盖**：把新 zip 解压覆盖旧目录后启动 → 同样按 `VERSION` 差异触发备份。
- **不提供 upgrade / rollback / uninstall 子命令**：程序就是解压目录，`upgrade` 等价于「解压新目录 + 启动」，`uninstall` 等价于「删文件夹」，`rollback` 等价于「用旧目录启动 + 按需用备份覆盖数据库」。加子命令只会与文件操作重复，还要自己处理自删、半成品清理等边界，收益为负。
- **备份复用 CLI**：`ledger backup`（`backupDatabase` → `VACUUM INTO` + `integrity_check`）是既有能力，启动器只负责调用与改名，不新增备份脚本（AGENTS §2「不得重复实现」）。
- **手工兜底**：`ledger.exe cli backup --data <data>` 生成 `<data>/backups/ledger-<UTC>.db`。
- **回滚 = 用旧目录启动**：`status` 显示「上次运行」的版本与目录，`data\backups\upgrade-*.db` 列出所有升级前备份；需要旧数据时由人用备份覆盖 `ledger.db` 并删 `-wal`/`-shm`，再用旧目录的 `ledger.exe` 启动。**程序不自动覆盖数据**。
- **旧版本保留规则**：升级不删除旧目录（位置由用户挑选），确认无误后自行删除。
- **停服等待**：`taskkill` 之后必须等进程真正退出（进程存活或端口仍被占用即继续等，上限 10s），否则 Windows 仍锁定 `node.exe`/文件，删除会 `Access denied`。
- 若旧版本低于数据库 schema，会被 §7 降级保护拦下，提示改用更高版本或对应备份。
- 备选：升级前只拷 `ledger.db` → 否决：WAL 模式下可能丢未 checkpoint 的事务。
- 备选：脚本自动回滚 → 否决：自动覆盖数据风险高于人工确认。
- 备选：目录级原子交换（rename 当前目录为 `.old`、把 `.new` 改名上位）→ 否决：Windows 下重命名含运行中 exe 的目录不稳定，且交换后旧目录名带 `.old` 会让用户困惑；同级并存 + 指针记录更直观。

### 11. 测试策略

- 单测（Node 侧）：CSP 分路径选择、SPA 回落判定、`latestMigrationVersion`、`VERSION`/`build-info.json` 解析与回落链、打包脚本纯函数（路径映射、prebuilds 裁剪清单、运行时依赖白名单）、确定性 zip（条目排序与固定时间戳）。
- 单测（Go 侧，`go test ./...`）：状态根解析优先级与便携布局判定、运行时自检（缺文件清单）、`VERSION` 读取、`current.json` 读写与损坏容错、备份改名与列表、zip 顶层目录/解压/校验清单、同级旧版本目录识别、参数解析与退出码映射、按映像路径清理进程。
- 集成（Node 侧）：`AppOptions.webDir` 指向临时目录 → 根路径 200 含入口标记、`/assets/*` 200、未知资源 404、`/api/nope` 仍 problem+json、未配置 webDir 时根路径 404；降级保护（`schemaversion` 置 999 → 启动被拒且库未被修改）。
- 手工冒烟（每版必做，见 tasks §8）：解压 zip 到干净目录 → `ledger.exe --version` → 双击（配对码弹窗）→ 建合同 → 再次双击（单实例）→ 解压新版本到并列目录并用它启动（自动备份、旧目录保留、数据在）→ 旧目录启动被降级保护拦 → `ledger.exe stop` 后删程序目录，`data\` 仍在。
- 门槛：`npm run typecheck`、`npm test`、`go vet ./... && go test ./...`、`npm run build -w @ledger/web`、`npm run package` 全绿；`docs/security.md` 的受保护断言逐条有测试（AGENTS §5）。

## Risks / Trade-offs

- [Go 成为发布机单点前提] → `go.mod` 固定 `go` 指令版本，构建脚本断言 `go version` 满足要求并给中文安装提示；`DECISIONS.md` 记录「发布期工具、不入运行时」的例外，客户机零依赖。
- [未签名 exe 触发 SmartScreen / AV 误报] → 文档写明首次运行提示与 SHA-256 校验方式；代码签名列为后续变更（不在本次范围）。
- [企业 AppLocker/EDR 禁止从 `%LOCALAPPDATA%` 或可移动介质执行] → 程序目录由用户挑选，`--install-dir` 只影响状态根；文档给出「程序放受信任路径、数据放用户目录」的组合。
- [解压后的目录被随意移动/改名] → `current.json` 记录上次运行目录，`status`/`rollback` 会显示；`upgrade` 以当前 exe 目录为基准找同级目录。
- [双击后服务常驻、用户不知如何停止] → `ledger.exe stop/status` + 首次启动的 MessageBox 文案写明；`uninstall` 先停服。
- [zip 体积 ~45MB（Node 运行时占大头）] → 用 deflate 压缩；`node.exe` 已压缩则退回 store；后续可评估只发 delta 或裁剪 Node 组件（不在本次范围）。
- [放宽页面 CSP 削弱安全断言] → API 路径维持 `default-src 'none'`；页面只许可同源；`docs/security.md` 增补断言与测试。
