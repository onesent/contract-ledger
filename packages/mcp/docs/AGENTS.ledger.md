# 台账 Agent 操作指南

本文件由 `npm run discovery -w @ledger/mcp` 自动生成，请勿手工编辑。

## 调用方式

- CLI：`ledger <command> --json`，例如 `ledger contract list --json`。
- MCP：stdio 启动 `ledger-mcp`（默认 2026-07-28 协议），`--legacy` 切到 v1 协议。
- HTTP：`Authorization: Bearer <token>`，命令名与 CLI 相同。

## 幂等与并发

1. 所有写命令都必须携带 `idempotency_key`；建议每次业务操作生成一个新的 UUID。
2. 相同 `idempotency_key` 与相同入参重放首次结果，不会重复写入。
3. 相同 `idempotency_key` 用于不同内容会返回 `IDEMPOTENCY_KEY_REUSED`。
4. 需要防止覆盖他人写入时传 `expected_version`；版本不一致返回 `STALE_WRITE` 与当前版本。
5. `dry_run: true` 只返回将发生的 `diff`，不写入、不递增版本。

## 错误处理

所有通道共享同一信封：成功 `{ ok: true, data, version, diff?, meta }`，失败 `{ ok: false, code, message, hint, details?, retryable, meta }`。
按 `code` 分支处理，不要解析 `message`；`hint` 给出可执行的下一步。

## 命令一览

| 命令 | MCP 工具 | 类型 | 摘要 |
| --- | --- | --- | --- |
| `contract.upsert` | `contract_upsert` | 写 | 新增或更新合同（编号唯一、日期先后、负责人在职、方向与金额锁定校验） |
| `contract.get` | `contract_get` | 只读 | 按 id 或合同编号读取合同详情（含资金流水、交付明细与状态日志） |
| `contract.list` | `contract_list` | 只读 | 分页查询合同列表（支持方向、状态、负责人筛选与多字段排序） |
| `contract.delete` | `contract_delete` | 破坏性写 | 删除合同（同事务级联删除其资金流水、交付明细与状态日志） |
| `contract.statusLogs` | `contract_status_logs` | 只读 | 读取指定合同的状态变更日志 |
| `payment.record` | `payment_record` | 写 | 为合同登记一笔资金流水（累计不得超过合同金额） |
| `payment.list` | `payment_list` | 只读 | 按合同查询全部资金流水 |
| `payment.delete` | `payment_delete` | 破坏性写 | 删除一笔资金流水（合同已付金额与进度自动回退） |
| `delivery.record` | `delivery_record` | 写 | 为合同登记一条交付明细（验收驳回不计入已交付金额） |
| `delivery.list` | `delivery_list` | 只读 | 按合同查询全部交付明细（含验收驳回记录） |
| `delivery.delete` | `delivery_delete` | 破坏性写 | 删除一条交付明细（已交付金额与最后交付日自动重算） |
| `personnel.upsert` | `personnel_upsert` | 写 | 新增或更新人员档案（人员编号忽略大小写唯一） |
| `personnel.list` | `personnel_list` | 只读 | 查询人员档案（可含离职人员，按姓名/编号/联系方式搜索） |
| `personnel.delete` | `personnel_delete` | 破坏性写 | 删除人员档案（仍被合同引用时拒绝删除） |
| `personnel.transfer` | `personnel_transfer` | 破坏性写 | 把离职/在岗人员名下的全部合同批量转交给另一位在职人员 |
| `dict.upsert` | `dict_upsert` | 写 | 新增或更新字典分类或字典项（同分类下编码唯一） |
| `dict.list` | `dict_list` | 只读 | 列出字典分类与字典项（可按分类编码过滤字典项） |
| `dict.delete` | `dict_delete` | 破坏性写 | 删除字典分类或字典项（仍有字典项或合同引用时拒绝） |
