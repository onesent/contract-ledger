# 分发、升级与回滚

面向最终用户与发版人。构建细节见 `openspec/changes/portable-release-pipeline/design.md`；安全断言见 `docs/security.md`。

## 1. 交付物

每次发版只发一个可执行包：

| 文件 | 说明 |
| --- | --- |
| `ledger-<version>-win-x64.zip` | **分发包**。解压即得一个自包含目录 |
| `ledger-<version>-win-x64.zip.sha256` | 分发包校验值 |
| `SHA256SUMS` | 校验清单（当前只列分发包一行） |
| `ledger-<version>-winget-manifests.zip` | winget 清单（`channels/winget/**` 的打包，供 winget-pkgs PR 使用） |

发布渠道：

| 渠道 | 地址 | 说明 |
| --- | --- | --- |
| **GitHub Releases（主）** | `https://github.com/onesent/contract-ledger/releases` | 由 `.github/workflows/release.yml` 在 tag 推送时自动构建并发布 |
| Gitee Release（镜像） | `https://gitee.com/sentone/contract-ledger/releases` | 手工上传**同一份**产物，sha256 不变（不重新打包） |
| winget | `winget install Onesent.Ledger` | `InstallerUrl` 指向 GitHub Release 资产；清单见 §8 |

解压后：

```text
ledger-<version>-win-x64\
  ledger.exe          入口（~7MB，控制台子系统）：校验、起服、停服、升级、卸载
  VERSION             纯文本版本号（`--version` 与健康端点都以此为准）
  node.exe            Node 运行时 v24.9.0（客户机不需要装 Node）
  node_modules\       各包产物 + 运行时依赖 + better-sqlite3 原生模块 + 迁移
  packages\web\dist\  前端静态产物（由服务同源托管）
  build-info.json     版本/提交/构建时间/平台/Node 门槛
  README.txt          使用说明
  SHA256SUMS          ledger.exe / node.exe / VERSION 的校验值
```

**zip 里就是可运行内容**，`ledger.exe` 只是入口，不解压到别处、不写 `%LOCALAPPDATA%\ledger\app\`。把整个目录放到任意可写位置（例如 `D:\ledger-1.0.0-win-x64\`）即可运行；放在只读位置（如 `Program Files`）也能跑，因为数据默认不在程序目录里。

客户机要求：Windows x64。**不需要**安装 Node、npm、Go、7-Zip 或任何脚本宿主。

## 2. 首次使用

1. 从 GitHub Releases 下载分发包（`https://github.com/onesent/contract-ledger/releases/download/v<version>/ledger-<version>-win-x64.zip`；大陆网络可用 Gitee 镜像的同一文件），解压到任意可写目录。
2. 双击 `ledger.exe`：启动本地服务并打开浏览器。
3. 未配对时会弹出**一次性配对码**（120 秒有效）；在页面输入即可完成配对。过期则执行 `ledger.exe stop` 后重新双击。

关于控制台：`ledger.exe` 是**控制台子系统**程序，解压后在 cmd / PowerShell / Git Bash 里都能直接跑 `ledger.exe --help`、`status`、`cli …` 并看到输出（GUI 子系统在 mintty 这类纯 pty 终端下拿不到 stdout，会静默无输出，因此不用）。双击时 Windows 会开一个控制台窗口显示启动信息；该窗口随启动器退出而关闭，所以一次性配对码**同时用消息框展示**（判定依据：`GetConsoleProcessList` 发现控制台只有本进程）。服务是独立后台进程，关闭窗口不影响它。

### 程序与数据分离

程序 = 解压目录（只读即可）；状态根默认在用户目录：

```text
%LOCALAPPDATA%\ledger\
  data\ledger.db      业务数据（唯一真相源，WAL 模式）
  data\backups\       备份（升级前自动备份 + ledger backup 产物）
  logs\               服务与启动器日志
  run\ledger.pid      运行状态（pid/端口/版本）
  current.json        上次成功启动的版本与程序目录
  ledger.conf.json    生效目录配置（首次 start / cli 后写入）
```

想把数据也放进程序目录（整个文件夹随 U 盘携带）：`ledger.exe --portable start`。

### 状态根与配置文件

状态根按以下顺序解析（先命中先用）：

1. `--install-dir DIR`
2. 环境变量 `LEDGER_HOME`
3. **exe 同目录的 `ledger.conf.json`** 里的 `installDir`
4. exe 所在目录——当它已经带有便携布局（含 `data\`、`run\` 或 `current.json`）时
5. `%LOCALAPPDATA%\ledger`（默认）

因此**不需要每次都传 `--install-dir`**：自定义状态根启动过一次后，启动器会把它写进该目录的 `ledger.conf.json`，并在 exe 不在状态根内时于 exe 旁补一份；之后 `ledger.exe status` / `stop` / `cli …` 都自动指向同一目录（`status` 会打印「状态目录 …（来源：…）」便于核对）。

配置文件格式（手改也有效，字段可省）：

```json
{
  "installDir": "D:\\ledger-state",
  "dataDir": "D:\\ledger-data"
}
```

- `installDir`：状态根；省略时按上面的顺序继续回退。
- `dataDir`：仅当数据目录不是 `<installDir>\data` 时才写入（`--data` 传过一次就会被记住）。

## 3. 命令行

| 命令 | 说明 |
| --- | --- |
| `ledger.exe` / `ledger.exe start` | 校验运行时 → 起服 → 等健康检查 → 打开浏览器（已配对则只开浏览器）；跨版本启动时自动备份数据库 |
| `ledger.exe stop` | 停止后台服务（幂等；pid 丢失时按映像路径兜底清理同目录残留进程） |
| `ledger.exe status` | 版本、程序目录、状态目录（含来源）、数据目录、日志目录、配置文件、上次运行（版本不同时）、运行时完整性、运行状态 |
| `ledger.exe cli <参数...>` | 转发到同目录的 ledger CLI，透传退出码（自动注入 `--data`） |
| `ledger.exe server <参数...>` | 前台启动服务入口（高级用法） |
| `ledger.exe version` / `--version` | 打印版本 |
| `ledger.exe help` | 帮助 |

启动器只做「起服 / 停服 / 状态 / 转发」。升级、回滚、卸载都是**文件操作**（见 §4、§5、§7），不额外提供子命令。

启动器自身选项（`--install-dir`、`--data`、`--port`、`--no-browser`、`--portable`）与子命令**顺序无关**，也支持 `--install-dir=D:\state`。唯一例外是 `cli` / `server`：**该子命令之后的参数原样转发**，所以启动器选项要写在它前面（`ledger.exe --install-dir D:\state cli contract list --json`）。

未初始化（从未运行过）时也有确定行为：`status` 报「未初始化（尚未运行过）」并指出首次 `start` 会在状态根下创建 `data/logs/run`；`stop` 报「台账未在运行」；`cli` / `server` 直接可用（运行时就地存在）。

退出码：`0` 成功、`1` 运行失败、`2` 用法错误、`3` 运行时校验失败、`4` 端口被占用、`6` 跨版本启动前备份失败。

## 4. 升级

程序是「一个自包含目录」，升级就是**换一个目录**：

```bat
:: 1. 下载新版本 zip，解压到任意位置（可与旧目录并列）
::    得到 ledger-1.1.0-win-x64\
:: 2. 先停掉旧版本服务
ledger-1.0.0-win-x64\ledger.exe stop
:: 3. 用新目录的入口启动
ledger-1.1.0-win-x64\ledger.exe
```

启动时自动完成这些事：

1. 读同目录 `VERSION`，与状态根 `current.json` 里记录的版本比较；不同且 `data\ledger.db` 存在时，用运行时内的 CLI 做一致性备份：`data\backups\upgrade-<旧版本>-<时间戳>.db`。**备份失败即中止**（退出码 6），不启动新版本、数据库不动。
2. 若旧版本服务仍在跑（pid 记录存在），先停掉它；再按映像路径兜底清理同目录残留进程。
3. 用新目录的运行时起服、等健康检查、打开浏览器。
4. 把新版本与新目录写进 `current.json`。

旧目录不会被自动删除：确认新版本无误后直接删掉它即可；需要回滚时它还在。

数据默认在 `%LOCALAPPDATA%\ledger\data`，所以换目录不影响数据。也支持「就地覆盖」：把新 zip 解压覆盖旧目录后启动，同样按 `VERSION` 差异触发备份。

设计取自成熟开源实现：syncthing 升级时先校验再替换、保留旧二进制以便回退；VS Code 便携模式把程序与数据分开、升级即替换程序目录；rclone `selfupdate` 保留「回到旧版本」的能力。本仓库**运行期不发任何网络请求**（AGENTS §3.4），因此不做自动下载：新版本 zip 由用户/发版人提供。

## 5. 回滚

```bat
:: 1. 停服
ledger-1.1.0-win-x64\ledger.exe stop
:: 2. 需要回到旧数据时，用升级前备份覆盖数据库（并清掉 WAL 残留）
copy "%LOCALAPPDATA%\ledger\data\backups\upgrade-1.0.0-<时间戳>.db" "%LOCALAPPDATA%\ledger\data\ledger.db"
del "%LOCALAPPDATA%\ledger\data\ledger.db-wal" "%LOCALAPPDATA%\ledger\data\ledger.db-shm"
:: 3. 用旧目录的入口启动
ledger-1.0.0-win-x64\ledger.exe
```

`ledger.exe status` 会显示「上次运行」的版本与目录，`data\backups` 里能查到所有升级前备份，用来确认该用哪一份。程序不会自动改数据：覆盖数据库必须由人显式执行。若旧版本提示「数据库结构版本过高」，说明备份与旧版本不匹配，换更接近的备份（见 §6）。

## 6. 迁移不可变与降级保护

迁移文件随程序目录走（`node_modules/@ledger/storage-sqlite/migrations`），已发布的迁移不可修改。启动时若数据库结构版本**高于**当前程序支持的最新版本，直接拒绝启动并提示改用更新版本或升级前备份恢复（退出码 1），避免旧程序写坏新数据。备份目录路径会写进错误提示。

## 7. 卸载

卸载 = 删文件夹，没有卸载程序：

```bat
:: 1. 先停服
ledger-1.0.0-win-x64\ledger.exe stop
:: 2. 删除程序目录（整个解压出来的文件夹）
rmdir /s /q ledger-1.0.0-win-x64
:: 3. 需要时再删状态根（含数据库与备份，不可恢复）
rmdir /s /q "%LOCALAPPDATA%\ledger"
```

- 只删程序目录时数据仍在：之后用任一分发包解压启动，数据照常加载。
- 状态根里除 `data\` 还有 `logs\`、`run\`、`current.json`、`ledger.conf.json`，删掉整个状态根即全部清理。
- 若在程序目录内执行 `rmdir`，Windows 会因「目录是当前工作目录」而失败：先 `cd` 到别处再删。
- 服务是独立后台进程，`stop` 之前直接删目录会导致进程残留（文件被占用），请先停服。

## 8. 安装渠道与 winget 清单

渠道只是**托管**，不改运行期行为：程序仍是一个自包含目录，运行期零外部网络请求（`AGENTS.md` §3.4）。升级语义仍是「换一个程序目录 + 跨版本启动时自动备份数据库」。

### 8.1 GitHub Releases（主渠道）

推 `v*` tag 触发 `.github/workflows/release.yml`，在 `windows-latest` 上重跑本地同一条命令链：

```text
npm ci → typecheck → test → build → package:payload → package:exe
       → package:channels → release-guard → 冒烟(解压后跑 --version/help) → gh release create
```

产物：`ledger-<version>-win-x64.zip`、`.sha256`、`SHA256SUMS`、`ledger-<version>-winget-manifests.zip`。断网或工作流失效时可 `workflow_dispatch` 指定版本重跑；也可本地 `npm run package` 后手工 upload。

### 8.2 Gitee 镜像

把 GitHub Release 的**同一批文件**上传到 Gitee Release（标题同为 `v<version>`）。不要重新打包：镜像的意义是同一个 sha256，用户在哪边下都能用 `SHA256SUMS` 校验。

### 8.3 winget

清单由 `npm run package:channels` 从真实分发包生成（`channels/channels.json` + `channels/winget/manifests/**`），字段间的一致性由 `scripts/channels-drift.test.mjs` 与 `scripts/release-guard.mjs` 守护。

```yaml
InstallerType: zip                 # 整个归档解压到包目录
NestedInstallerType: portable      # 再为嵌套 exe 建命令别名 ledger
NestedInstallerFiles:
  - RelativeFilePath: 'ledger-<version>-win-x64\ledger.exe'
    PortableCommandAlias: ledger
Scope: user                        # 数据在 %LOCALAPPDATA%\ledger，不需要管理员权限
```

提交/更新：

```bash
winget install Microsoft.WingetCreate
wingetcreate update Onesent.Ledger --version <version> \
  --urls https://github.com/onesent/contract-ledger/releases/download/v<version>/ledger-<version>-win-x64.zip
```

要点：

- **符号链接安装**：winget 只给 exe 建链接，链接落在 `%LOCALAPPDATA%\Microsoft\WinGet\Links`。启动器的 `exeDir()` 会解析符号链接（`launcher/config.go` 的 `resolveExeDir`），否则会去链接所在目录找 `node.exe` 而误报「运行时文件不完整」。
- **升级**：`winget upgrade Onesent.Ledger` 换掉程序目录；新版本首次启动按 `VERSION` 差异自动备份数据库。
- **卸载**：`winget uninstall Onesent.Ledger` 只删程序，`%LOCALAPPDATA%\ledger` 保留；要清数据需手工删。
- **审核**：winget-pkgs 是人工审核 + 干净机校验，`InstallerUrl` 必须匿名可达。未签名的 `ledger.exe` + 内置 `node.exe` 可能被静态扫描误报，正式提交前建议先做 Authenticode 签名。

## 9. 发版清单（发版人）

1. `npm run validate` 全绿。
2. 改过启动器子命令/选项时先跑 `npm run spec:launcher`（刷新 `launcher/spec.json`），否则 `go test` 与文档漂移检查会失败。
3. `npm run package`：产出 `build/dist/ledger-<version>-win-x64/`（可运行目录，排障用）、`release/ledger-<version>-win-x64.zip` 与渠道清单（`channels/`）；包内 `README.txt` 由 `docs/distribution-readme.txt` 渲染（`{{version}}` 占位）。
4. `node scripts/release-guard.mjs --tag v<version>`：校验 tag / `package.json` 版本 / zip / `.sha256` / `SHA256SUMS` / `channels/channels.json` 互相对齐（CI 同一个脚本）。
5. 冒烟：解压 zip 到干净目录 → `ledger.exe --version` → 双击/`start` → 配对 → 建合同 → `stop` → 解压上一版 zip 到并列目录并用它启动，确认自动生成 `data\backups\upgrade-*.db` 且数据完整。
6. 提交并打 tag：`git commit` → `git tag -a v<version> -m "v<version>"` → `git push github master:main --follow-tags`（本地分支 `master`，GitHub 仓库默认分支是 `main`）与 `git push origin master --follow-tags`（Gitee 保留为镜像仓库）。**首次以源码覆盖 GitHub 仓库时**需 `--force-with-lease`（仓库建库时只有自动生成的 LICENSE，先把需要的文件带到本地）。
7. GitHub Actions 自动出包并发布 Release；发布后在 Gitee Release 手工上传**同一批文件**（zip / `.sha256` / `SHA256SUMS` / `-winget-manifests.zip`）。
8. winget：用 Release 附件里的清单提交 `wingetcreate submit`（首次）或 `wingetcreate update`（后续）。若 CI 产物的 sha256 与仓库内 `channels/` 不同，把 Release 附件的 `channels.json` 与清单回填提交，保持「仓库快照 = 已发布字节」。
9. 分发包文件名带版本、`ledger.exe` 不带版本：升级即换目录，不需要改文件名。
