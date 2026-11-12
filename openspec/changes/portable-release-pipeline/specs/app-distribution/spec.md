# Spec Delta

## Purpose

让台账以**一个自包含 zip**交付：解压即可运行，客户机无需 Node 或任何安装步骤；`ledger.exe` 只是入口，版本可核对，升级与回滚不损伤数据。

## ADDED Requirements

### Requirement: 自包含分发包

发布物 MUST 是单个 zip，解压后得到一个自包含目录，内含运行所需的全部内容：Node 运行时、各包构建产物、数据库迁移脚本、前端构建产物与运行期依赖。目录内的 `ledger.exe` MUST 只作为入口（校验、起服、停服、升级、卸载、CLI 转发），MUST NOT 在运行期把程序内容解压或复制到其他目录。客户机 MUST NOT 需要预装 Node.js、包管理器、解压工具、脚本宿主或任何运行库。

#### Scenario: 无 Node 的机器解压即用

- **WHEN** 用户在一台未安装 Node.js、未安装任何解压或脚本工具的 Windows 机器上解压分发包并双击 `ledger.exe`
- **THEN** 服务使用目录内自带的运行时启动并打开界面，首次访问得到未配对状态，且 `%LOCALAPPDATA%\ledger\app\` 下不会出现程序副本

#### Scenario: 不依赖系统脚本策略

- **WHEN** 客户机的 PowerShell 执行策略为 `Restricted` 或由组策略限制脚本
- **THEN** 分发包仍能正常运行，不因脚本策略失败

### Requirement: 运行时完整性自检

`ledger.exe` MUST 在启动前校验同目录运行时的关键文件（`node.exe`、`VERSION`、服务与 CLI 入口、前端产物、迁移脚本）；缺失时 MUST 中止启动、列出缺失项并提示重新完整解压，且 MUST NOT 修改既有安装或数据。

#### Scenario: 解压不完整

- **WHEN** 用户只复制了 `ledger.exe` 而没有同目录的运行时文件
- **THEN** 启动中止并提示缺少哪些文件、要求完整解压分发包，数据目录未被创建或修改

### Requirement: 升级即换目录（不设升级子命令）

升级 MUST 以「换一个目录」完成：用户把新版本 zip 解压到任意位置，先用旧目录的入口 `stop`，再用新目录的入口启动；入口 MUST NOT 提供 `upgrade` 子命令，也 MUST NOT 覆盖或删除旧版本目录。跨版本启动时入口 MUST 先做一致性备份，备份失败 MUST 中止启动且不修改数据。

#### Scenario: 升级后旧版本仍在

- **WHEN** 用户把 vY 解压到新目录并启动
- **THEN** vY 正常运行，旧目录 vX 仍在磁盘上，数据目录未被清理

#### Scenario: 跨版本启动先备份

- **WHEN** 包内 `VERSION` 与状态根 `current.json` 记录的版本不同且数据库存在
- **THEN** 启动前生成 `data\backups\upgrade-<旧版本>-<时间戳>.db`，随后才启动新版本

#### Scenario: 备份失败不升级

- **WHEN** 跨版本启动前的备份失败
- **THEN** 启动中止、退出码非零，数据库未被修改，旧版本仍可用

### Requirement: 单实例与端口占用

服务已在运行时 MUST NOT 重复启动第二个实例，MUST 直接打开界面并给出「已在运行」提示；目标端口被其他程序占用时 MUST 给出可执行错误提示与非零退出码。

#### Scenario: 二次双击

- **WHEN** 服务已在运行时用户再次双击入口
- **THEN** 不启动第二个服务进程，只打开界面并提示已在运行

#### Scenario: 端口被占用

- **WHEN** 目标端口被其他程序占用
- **THEN** 启动失败并提示端口、更换端口的用法与「去旧目录 stop」的指引，退出码非零

### Requirement: 运行日志落盘

服务与启动器输出 MUST 写入状态根下的日志目录，MUST 足以诊断启动失败（含运行时自检、端口占用、迁移失败、降级保护）。

#### Scenario: 启动失败可诊断

- **WHEN** 服务因降级保护或迁移失败而未能启动
- **THEN** 日志目录中存在含具体错误与恢复建议的日志文件

### Requirement: 首次配对码可获取

未配对状态下，用户 MUST 能在没有终端窗口的前提下获取一次性配对码；配对码 MUST NOT 通过页面或 API 暴露。

#### Scenario: 首次启动展示配对码

- **WHEN** 用户在未配对状态下首次启动
- **THEN** 启动器展示一次性配对码并打开界面，用户可用该码完成配对

#### Scenario: 已配对不重复展示

- **WHEN** 已完成配对后再次启动
- **THEN** 不再展示配对码，直接打开界面

### Requirement: 命令行双角色

同一入口 MUST 既能启动服务，也能转发 CLI 命令并透传其退出码（`0` 成功 / `1` 业务失败 / `2` 用法错误 / `4` 未认证）；`cli` / `server` 之后的参数 MUST 原样转发，且启动器选项与子命令的先后顺序 MUST NOT 影响解析结果。

#### Scenario: 通过入口执行 CLI

- **WHEN** 用户在命令行执行 `ledger.exe cli contract list --json`
- **THEN** 命令输出与退出码与直接调用 CLI 一致

#### Scenario: 选项在子命令之前

- **WHEN** 用户执行 `ledger.exe --install-dir D:\state status`
- **THEN** 与 `ledger.exe status --install-dir D:\state` 行为一致，不报「未知参数」

### Requirement: 卸载即删目录（不设卸载子命令）

卸载 MUST 由用户直接删除程序目录完成，入口 MUST NOT 提供 `uninstall` 子命令、MUST NOT 自行删除程序或数据。文档 MUST 说明「先 `stop` 再删目录」，以及状态根（`data`/`logs`/`run`/`current.json`/`ledger.conf.json`）需要单独删除。

#### Scenario: 删程序目录后数据仍在

- **WHEN** 用户 `stop` 后删除程序目录，再用任一分发包解压启动
- **THEN** 既有合同、流水、交付与设置全部保留

#### Scenario: 不提供自删能力

- **WHEN** 用户查看 `ledger.exe help`
- **THEN** 只列出 `start`/`stop`/`status`/`cli`/`server`/`version`/`help`，没有 `uninstall`/`upgrade`/`rollback`

### Requirement: 分发包自包含且不含敏感数据

分发包 MUST 包含运行所需的全部内容，MUST NOT 包含业务数据库、备份、日志、密钥或任何环境凭证。

#### Scenario: 分发包不含业务数据与密钥

- **WHEN** 检查解压后的目录内容
- **THEN** 不存在数据库文件、备份目录与任何密钥或令牌字段

### Requirement: 版本标识

`VERSION` 文件 MUST 为纯文本版本号，并作为版本单一权威；`build-info.json` MUST 声明 git 提交、构建时间、目标平台与支持的数据结构版本。分发包文件名 MUST 带版本号，其中的 `ledger.exe` MUST NOT 带版本号。`VERSION`、健康端点返回的版本、`ledger.exe --version` 与 `ledger.exe cli --version` MUST 一致。

#### Scenario: 版本一致

- **WHEN** 读取 `VERSION`、请求健康端点、执行 `ledger.exe --version` 与 `ledger.exe cli --version`
- **THEN** 四处报告的版本号相同

#### Scenario: 版本与发布标签对应

- **WHEN** 构建并发布版本 vX.Y.Z
- **THEN** 分发包名为 `ledger-X.Y.Z-win-x64.zip`，且与对应的 git 标签一致

### Requirement: 产物与分发包分离

构建产物（可运行载荷目录、入口 exe、组装后的可运行目录）MUST 与分发包（版本化 zip）分开且职责明确。分发包 MUST NOT 混入载荷归档、缓存、日志或调试产物；MUST NOT 单独发布脱离运行时的 `ledger.exe`。

#### Scenario: 分发包内容固定

- **WHEN** 解开发布用的分发包
- **THEN** 只有一层版本目录，内含入口 exe、运行时、`VERSION`、`build-info.json`、使用说明与校验清单

#### Scenario: 产物可直接运行以便排障

- **WHEN** 需要在构建机上验证
- **THEN** `build/dist/ledger-<version>-win-x64/` 可直接运行，无需先打包

### Requirement: 程序包完整性校验

分发包 MUST 随附 SHA-256 校验值；分发包内 MUST 提供 `SHA256SUMS` 列出关键文件（入口 exe、`node.exe`、`VERSION`）的校验值。升级流程 MUST 在校验通过后才使用解压结果。

#### Scenario: 交付物被篡改时拒绝

- **WHEN** 分发包的 SHA-256 与随附校验值不符，或解压后关键文件校验不符
- **THEN** 升级中止，现有安装与数据保持不变

### Requirement: 程序目录与数据目录分离

业务数据 MUST 默认存放于独立的状态根（`%LOCALAPPDATA%\ledger`），MUST NOT 默认位于程序目录内。替换或新增程序目录 MUST NOT 影响既有数据。用户显式使用便携模式（`--portable`）时数据才落在程序目录内。

#### Scenario: 换程序目录后数据仍在

- **WHEN** 用户用新版本目录启动（或把旧目录删掉）
- **THEN** 合同、流水、交付与设置全部保留

### Requirement: 程序目录可写性无关

服务 MUST 在程序目录只读时可正常运行，所有写入 MUST 落到状态根（主库、WAL、备份、日志、运行状态）。

#### Scenario: 程序放在只读路径

- **WHEN** 程序目录无写权限而状态根可写
- **THEN** 启动、读写与备份均正常

### Requirement: 离线升级

升级 MUST 通过本地分发包完成，MUST NOT 依赖运行期对外网络请求，MUST NOT 由程序自动下载任何内容。

#### Scenario: 用本地 zip 完成升级

- **WHEN** 用户把新版本 zip 解压到新目录并启动其中的 `ledger.exe`
- **THEN** 启动前生成一份可独立打开的备份，启动后数据完整、迁移已应用、旧版本目录保留

### Requirement: 回滚不删除用户数据

系统 MUST 支持用升级前备份与旧版本目录恢复，MUST NOT 自动删除或覆盖用户未指示删除的数据，MUST NOT 提供自动回滚能力。`status` MUST 显示上次运行的版本与目录，便于判断该用哪份备份。

#### Scenario: 回滚到升级前状态

- **WHEN** 用户 `stop` 后用 `data\backups\upgrade-*.db` 覆盖 `ledger.db`（并删除 `-wal`/`-shm`），再用旧目录的 `ledger.exe` 启动
- **THEN** 数据回到升级前内容，服务正常启动

#### Scenario: 回滚不自动执行

- **WHEN** 用户查看 `status` 或文档
- **THEN** 能查到上次运行版本/目录与备份清单，但程序未自动修改任何数据

### Requirement: 状态根可持久化

状态根解析 MUST 依次为 `--install-dir` > `LEDGER_HOME` > exe 旁 `ledger.conf.json` > exe 目录便携布局 > 默认目录；成功启动或转发 CLI 后 MUST 记录生效配置，使后续命令无需重复传参。

#### Scenario: 首次指定后免传参

- **WHEN** 用户首次以 `--install-dir D:\state` 启动，之后直接执行 `ledger.exe status`
- **THEN** `status` 指向 `D:\state` 并打印解析来源

### Requirement: 降级保护

当主库的数据结构版本高于程序支持的最新版本时，服务 MUST 拒绝启动并给出可执行的恢复建议，MUST NOT 以旧版本继续写入。

#### Scenario: 旧程序打开新库被拒

- **WHEN** 用较低版本程序连接由更高版本创建并已迁移的数据库
- **THEN** 启动失败并提示升级程序或使用升级前备份恢复，数据库内容不被修改

### Requirement: 已发布迁移不可变

已发布的数据库迁移脚本 MUST 保持内容不变，程序 MUST 在启动时校验迁移脚本校验和；已发布迁移被修改时 MUST 拒绝继续。

#### Scenario: 修改历史迁移导致启动失败

- **WHEN** 已发布迁移脚本内容被修改后启动
- **THEN** 启动失败并指出校验和不匹配的迁移，不执行任何迁移

### Requirement: 发布版本与变更日志可追溯

每次发布 MUST 产生语义化版本号、与之对应的 git 标签与变更日志条目；变更日志 MUST 与实际变更一致，且不包含尚未交付的内容。

#### Scenario: 发布后核对

- **WHEN** 发布 vX.Y.Z
- **THEN** 存在标签 vX.Y.Z 与变更日志条目，条目描述的内容已包含在该版本分发包中

### Requirement: 发布流程不自动推送

发布流程 MUST NOT 自动推送或发布到远端，远端操作 MUST 由人显式执行。

#### Scenario: 发布后停在本地

- **WHEN** 执行发布命令
- **THEN** 本地生成提交、标签与交付物，并输出人工推送与上传的步骤提示，远端仓库未发生变化
