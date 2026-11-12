# 冻结决策（agent-native-ledger）

来源：`openspec/changes/agent-native-ledger`（design.md D1–D14 + 数据模型）。以下决策在 Wave 1 冻结，后续实现不得单方面改变。

- Version semantics: global dataset version stored in `meta.version`, incremented exactly once per successful write transaction; `expectedVersion` is optional; mismatch → STALE_WRITE 409 with `currentVersion`.
- One envelope for all transports; CLI adds only `schema_version` + `command`.
- MCP tool names are snake_case (contract_upsert, payment_record, ...), args snake_case (idempotency_key, expected_version). Dots are invalid in MCP tool names.
- `idempotency_keys` table is the single authority; payments/deliveries MUST NOT have their own idempotency_key column. Key scope = (actor, command, key); fingerprint = sha256 of canonical JSON input; same key+same fingerprint replays stored result; different fingerprint → IDEMPOTENCY_KEY_REUSED.
- Auth tables live in `001_init.sql`.
- Legacy import: yuan → integer cents half-up; `typeCode` resolved to dict_items(category='contractType', code=typeCode), creating missing items on demand; legacy contract.receivedAmount/deliveredAmount that exceed the sum of imported payment/delivery rows are preserved as `opening_paid_cents` / `opening_delivered_cents` on contracts (views add opening + rows). Never fabricate payment/delivery rows.
- settings stored as key/value JSON rows (`settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`).
- Open-question defaults: procurement-specific fields out of scope (separate change); no static snapshot build; MCP defaults to v2 with `--legacy` v1 switch; browser data migration via one-time `ledger import` (no guide page).

## Wave 3 契约补充（实现必需，已回填 store-port）

- `WriteOptions` 增加 `inputFingerprint`（SHA-256 canonical JSON 入参）与可选 `transport`：幂等表需要指纹判定「同键同内容重放」与「同键不同内容误用」，审计需要来源通道。
- 新增 `LedgerError extends Error`（携带 `code` + `details`）：SQLite 与内存实现用同一类型向命令分发器传递 STALE_WRITE / DB_BUSY / 金额守卫等错误，避免解析 message。

## Wave 4 契约补充

- `LedgerStore` 增加 `statusLogs: ContractStatusLogRepository`（只追加）：合同状态变化必须在同一写事务内写 `contract_status_logs`，与 `statusChangedAt` 保持一致。

## 发布期工具链例外（portable-release-pipeline）

交付物是**一个自包含 zip**：解压即得完整程序目录（`node.exe` + 各包产物 + 迁移 + 前端），`ledger.exe` 只是入口（Go，~7MB，控制台子系统，不嵌载荷）。为遵守 AGENTS §3.11「不引入约定外技术」，明确边界：

- **Go 仅用于构建期**：`launcher/` 是入口程序（运行时自检、进程管理、状态根解析、升级备份与目录级升级、CLI 转发），产出 `build/launcher/ledger.exe` 并放进分发包；后端仍是 TypeScript、前端仍是 JavaScript，`packages/*` 不含 Go 代码。
- **运行期零新增依赖**：客户机不需要 Node、Go、npm、7-Zip 或任何脚本宿主；包内 `node.exe` 是 Node 官方分发（构建期下载并校验官方 `SHASUMS256.txt`，或用 `--node-exe` 直取本地文件）。
- **版本下限**：`launcher/go.mod` 声明 `go 1.27.4`，`CGO_ENABLED=0`（纯静态、无 MSVC），构建参数固定 `-trimpath -ldflags "-s -w"`（**控制台子系统**，不用 `-H windowsgui`：GUI 子系统在 mintty 等纯 pty 终端下拿不到 stdout 句柄，所有命令静默无输出）。
- **否决的替代形态**：自解压 exe（`//go:embed` 载荷 → 解压到 `%LOCALAPPDATA%\ledger\app\<version>\`：等于把 41MB 再复制一份、程序藏在用户目录、升级要管版本目录）；Node SEA（24.9.0 仍 experimental，产物 ≥120MB）；yao-pkg（pkg-fetch v3.6 无 node24 资产、node22 版本错位）；7-Zip SFX / IExpress（`%TEMP%` 两段解压、逻辑需落 `.ps1`/`.cmd` 受 GPO 影响、AV 噪音更高）。理由详见 `openspec/changes/portable-release-pipeline/design.md` §1。
- **升级借鉴成熟实现**：参考 syncthing「先校验再替换、保留旧版本」、VS Code 便携模式「程序目录可整体替换、数据在程序附近或独立」、rclone `selfupdate`「保留回到旧版本的能力」。本仓库运行期零外部网络请求（AGENTS §3.4），因此不做自动下载，也不提供升级子命令：升级就是「解压新版本到新目录 → 旧目录 `ledger.exe stop` → 新目录 `ledger.exe`」，跨版本启动时自动备份数据库；回滚用旧目录启动、按需用备份覆盖数据库；卸载就是删目录。
- **可复现**：载荷与分发包 zip 均由仓库内 `scripts/zip.mjs` 写出（条目排序 + 固定时间戳），构建时间取 `SOURCE_DATE_EPOCH` > git 提交时间 > 当前时间，同一 commit 重复打包得到相同 sha256。
- **备份复用既有能力**：升级前备份调用 `ledger backup`（`VACUUM INTO` + 完整性检查），不新增备份脚本。
