# MCP 宿主兼容矩阵（agent-native-ledger）

本文件记录 `packages/mcp` stdio MCP server 在常见 agent 宿主下的握手与调用结果，对应 OpenSpec 变更 `agent-native-ledger` 任务 6.4。

## 1. 协议版本与开关

- 默认走 `@modelcontextprotocol/server@2.4.0`（v2 路径）。设计文档 `design.md` D11 假定对应 2026-07-28 规范，但实测握手协商返回的 `protocolVersion` 为 `2025-11-25`（见第 5 节）。
- `--legacy` 走 `@modelcontextprotocol/sdk@1.32.2`（v1 路径），握手协商返回 `2025-06-18`。
- 两条路径共享同一 `dispatch` 与工具目录，`tools/list`、注解、幂等与错误信封完全一致；差异仅在传输层握手。

## 2. 支持矩阵

| 宿主 | 默认（v2） | `--legacy`（v1） | 传输 | 说明 |
| --- | --- | --- | --- | --- |
| Claude Code | 待实测 | 待实测 | stdio | 本机未安装 `claude`，未做端到端集成 |
| Codex | 待实测 | 待实测 | stdio | 本机未安装 `codex`，未做端到端集成 |
| Cursor | 待实测 | 待实测 | stdio | 本机未安装 `cursor`/`cursor-agent`，未做端到端集成 |
| 裸 stdio 驱动（协议层） | 已实测通过 | 已实测通过 | stdio | 本机用 JSON-RPC over stdio 脚本验证握手、`tools/list`、读、写、幂等重放 |

「待实测」表示该宿主的客户端集成（配置加载、工具发现 UI、调用回路）尚未在本环境跑通，仅协议层由裸 stdio 驱动验证。第 6 节给出每个宿主的复现配置与命令。

## 3. 启动命令

可执行入口为 `packages/mcp/dist/bin.js`（包内 `bin` 名为 `ledger-mcp`）。数据库路径用 `--db` 指定（缺省 `data/ledger.db`，也可用环境变量 `LEDGER_DB`）。构建产物后启动：

```bash
# 先构建（tsc -b 会编译 core / storage-sqlite / server / cli / mcp 全部引用项目）
npm run typecheck

# v2（默认）
node packages/mcp/dist/bin.js --db ./data/ledger.db

# v1（回退）
node packages/mcp/dist/bin.js --db ./data/ledger.db --legacy
```

注意：MCP 入口只接受 `--db`（数据库文件路径），不接受 `--data`（数据目录）。`--data` 是 server 与 CLI 的选项。MCP 启动时会执行迁移并写入默认字典与设置（与 server/CLI 相同的幂等种子）。

## 4. 握手与调用步骤（协议层）

stdio 采用换行分隔的 JSON-RPC 2.0。步骤：

1. 客户端发 `initialize` 请求（带 `protocolVersion`、`capabilities`、`clientInfo`）。
2. 服务端回 `result`（含协商后的 `protocolVersion`、`capabilities.tools`、`serverInfo`）。
3. 客户端发 `notifications/initialized` 通知。
4. `tools/list` 请求 → `result.tools`（18 个工具，含 `annotations` 与 `inputSchema`）。
5. 读调用：`tools/call` 一个只读工具 → `result.structuredContent` 为统一信封。
6. 写调用：`tools/call` 一个写工具（带 `idempotency_key`）→ 成功信封含 `version`。

### 4.1 期望 JSON 形状

`tools/list` 首个工具（`contract_upsert`）的注解与必填项：

```json
{
  "name": "contract_upsert",
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  },
  "inputSchema": {
    "required": ["no", "direction", "counterparty", "typeCode", "statusCode", "ownerId", "amountCents", "signDate", "startDate", "dueDate", "idempotency_key"]
  }
}
```

工具调用结果（`tools/call` 的 `result`）：

```json
{
  "content": [{ "type": "text", "text": "<信封的 JSON 字符串>" }],
  "structuredContent": { "ok": true, "data": { "contract": { "no": "HT-COMPAT-001", "amountCents": 1234500 } }, "version": 5, "meta": { "actor": "mcp:stdio", "transport": "mcp" } },
  "isError": false
}
```

失败信封（如写命令缺 `idempotency_key`）：`structuredContent` 为 `{ "ok": false, "code": "IDEMPOTENCY_KEY_REQUIRED", ... }`，且 `isError: true`。

## 5. 实测结果（裸 stdio 驱动）

驱动脚本对 `packages/mcp/dist/bin.js` 走完整流程：握手 → `tools/list` → 建 2 个字典分类 + 2 个字典项（`dict.upsert`）→ 写 1 份合同（`contract_upsert`）→ 读列表（`contract_list`）→ 用相同 `idempotency_key` 重放写。每条命令都是真实进程调用，非人工构造。

| 检查项 | v2（默认） | v1（`--legacy`） |
| --- | --- | --- |
| 协商 `protocolVersion` | `2025-11-25` | `2025-06-18` |
| `serverInfo` | `{ name: "ledger-mcp", version: "0.0.0" }` | `{ name: "ledger-mcp", version: "0.0.0" }` |
| `tools/list` 工具数 | 18 | 18 |
| 首个工具注解 | `readOnlyHint:false, idempotentHint:true` | 同左 |
| 写命令 `required` 含 `idempotency_key` | 是 | 是 |
| 读调用 `contract_list`（空库） | `ok:true, total:0, version:0, isError:false` | 同左 |
| 写调用 `contract_upsert`（先建字典后） | `ok:true, version:5, no:"HT-COMPAT-001", amountCents:1234500` | 同左 |
| 写后读 `contract_list` | `ok:true, total:1` | 同左 |
| 相同 `idempotency_key` 重放写 | `ok:true, version:5`（版本不增，幂等成立） | 同左 |
| 缺 `idempotency_key` 写 | `ok:false, code:"IDEMPOTENCY_KEY_REQUIRED", isError:true` | 同左 |

版本单调说明：4 次 `dict.upsert` + 1 次 `contract_upsert` = 5 次成功写入，`version` 递增到 5；重放同一幂等键不再递增，仍返回 5。

## 6. 各宿主复现配置

以下配置供在装有对应宿主的机器上复跑。命令路径按仓库根目录 `C:\workspace\workbuddy\code\workspace-contract` 为例，跨机器请替换为绝对路径。协议层已由第 5 节验证，本节验证的是宿主客户端集成。

### 6.1 Claude Code

MCP 配置（`~/.claude` 的 MCP 设置，或项目 `.mcp.json`）：

```json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["C:/workspace/workbuddy/code/workspace-contract/packages/mcp/dist/bin.js", "--db", "C:/workspace/workbuddy/code/workspace-contract/data/ledger.db"]
    }
  }
}
```

v1 回退：在 `args` 追加 `"--legacy"`。复现步骤：启动 Claude Code，确认 `ledger` server 状态为已连接，`tools` 列表出现 18 个工具，让模型调用 `contract_list`（读）与 `contract_upsert`（写，需先备好 `contractType`/`contractStatus` 字典项）。

### 6.2 Codex

MCP 配置（`~/.codex/config.toml`）：

```toml
[mcp_servers.ledger]
command = "node"
args = ["C:/workspace/workbuddy/code/workspace-contract/packages/mcp/dist/bin.js", "--db", "C:/workspace/workbuddy/code/workspace-contract/data/ledger.db"]
```

v1 回退：`args` 末尾加 `"--legacy"`。复现步骤：启动 `codex`，确认 MCP server 已注册，调用 `contract_list` 与 `contract_upsert` 各一次。

### 6.3 Cursor

MCP 配置（`.cursor/mcp.json` 或全局设置）：

```json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["packages/mcp/dist/bin.js", "--db", "data/ledger.db"],
      "cwd": "C:/workspace/workbuddy/code/workspace-contract"
    }
  }
}
```

v1 回退：`args` 追加 `"--legacy"`。复现步骤：在 Cursor 的 MCP 面板确认 `ledger` 连接成功并列出工具，执行一次读与一次写。

### 6.4 协议层裸驱动（无需宿主，可本机复跑）

用 Node 直接 spawn `bin.js` 并按换行 JSON-RPC 收发即可复现第 5 节全部结果，不依赖任何宿主。最小验证：向进程 stdin 依次写入 `initialize` 请求、`notifications/initialized` 通知、`tools/list` 请求，观察 stdout 的对应响应行。

## 7. 已知限制与不一致

- MCP 入口 `bin.ts` 在迁移后调用 `seedDefaultDictionaries`，空库会得到 4 个分类 / 17 个字典项与默认设置，可直接 `contract_upsert`。第 5 节实测仍显式先建字典，用于验证 `dict.upsert` 路径与版本递增。
- 默认协议版本与设计假设不一致：`design.md` 写 2026-07-28，`@modelcontextprotocol/server@2.4.0` 实测协商为 `2025-11-25`。
- 三个真实宿主（Claude Code / Codex / Cursor）在本环境未安装，端到端客户端集成为「待实测」；本文件未伪造其结果，仅给出配置与复现命令。
