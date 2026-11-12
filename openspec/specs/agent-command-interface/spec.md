# agent-command-interface Specification

## Purpose
让外部 agent 通过稳定、幂等、可自描述的命令契约读写台账，而不依赖界面、存储实现或人类文案；所有写操作经统一分发、幂等与审计，供 CLI、HTTP 与 MCP 三通道复用。

## Requirements

### Requirement: 统一命令契约

所有写操作 MUST 以命令对象表达，包含 `kind`、`idempotencyKey`、可选 `expectedVersion` 与可选 `dryRun`；执行结果 MUST 统一返回 `ok`、`code`、`message`、`hint`、`data`、`diff`、`version` 字段。

#### Scenario: 成功执行命令

- **WHEN** 调用方提交一条带 `idempotencyKey` 的合同新增命令
- **THEN** 返回 `ok: true`、新版本号与写入后的合同数据

#### Scenario: 缺少幂等键

- **WHEN** 调用方提交写命令但未提供 `idempotencyKey`
- **THEN** 返回 `ok: false` 与稳定错误码 `IDEMPOTENCY_KEY_REQUIRED`，且不写入

### Requirement: 幂等重放

相同 `idempotencyKey` 与相同命令指纹 MUST 返回首次执行结果且 MUST NOT 重复写入；相同键但命令内容不同 MUST 拒绝。

#### Scenario: 重试同一命令

- **WHEN** 同一命令以相同幂等键重复提交两次
- **THEN** 第二次返回首次结果并标记跳过，业务数据只写入一次

#### Scenario: 复用幂等键

- **WHEN** 同一幂等键被用于内容不同的命令
- **THEN** 返回 `IDEMPOTENCY_KEY_REUSED`，且不写入

### Requirement: 乐观并发

命令携带 `expectedVersion` 且与当前数据集版本不一致时 MUST 返回 `STALE_WRITE` 并拒绝写入。

#### Scenario: 版本冲突

- **WHEN** 调用方基于旧版本号提交更新命令
- **THEN** 返回 `STALE_WRITE` 与当前版本号，数据保持不变

### Requirement: Dry-run 差异预览

`dryRun` 为真时 MUST 返回字段级差异（新增、更新、跳过）且 MUST NOT 写入任何数据。

#### Scenario: 预览更新

- **WHEN** 以 `dryRun` 提交一条将合同金额从 100 改为 120 的命令
- **THEN** 返回差异 `amount: { from: 100, to: 120 }`，数据库无变化

### Requirement: 批量命令原子性

批量命令 MUST 先完成全部校验，再以单事务提交；任一操作失败 MUST 整体回滚并返回逐条错误。

#### Scenario: 批量中有一条非法

- **WHEN** 批量命令包含 3 条操作且第 2 条违反金额约束
- **THEN** 3 条全部不写入，返回第 2 条的错误码与位置

### Requirement: 稳定错误码

校验与执行失败 MUST 返回稳定错误码和可执行提示，MUST NOT 仅返回自然语言文案。

#### Scenario: 负责人已离职

- **WHEN** 命令引用的负责人已离职
- **THEN** 返回 `OWNER_INACTIVE` 并提示先转交或复职

### Requirement: 能力自描述

系统 MUST 提供机器可读的能力描述，包含命令、字段、枚举、错误码与业务不变量。

#### Scenario: Agent 读取能力描述

- **WHEN** agent 请求能力描述
- **THEN** 获得包含全部命令与字段约束的 JSON，可据此构造合法命令

### Requirement: 三通道行为一致

CLI、HTTP 与 MCP MUST 复用同一命令定义与执行逻辑；同一命令经任一通道执行 MUST 产生等价的校验、幂等与审计结果。

#### Scenario: 两通道等价

- **WHEN** 同一新增命令分别经 CLI 与 MCP 提交
- **THEN** 两者的校验结果、写入结果与审计字段一致

### Requirement: 命令审计

每条成功执行的命令 MUST 写入审计记录，至少包含操作者、命令类型、幂等键、执行前后版本与变更摘要。

#### Scenario: 审计可追溯

- **WHEN** 一次合同更新成功
- **THEN** 审计记录能定位操作者、命令、幂等键与受影响的合同

### Requirement: 工具安全注解

暴露给 agent 的每个工具 MUST 标注只读、破坏性、幂等与开放世界提示，且注解 MUST 与命令实际行为一致。

#### Scenario: 只读查询标注

- **WHEN** agent 获取工具清单
- **THEN** 查询类工具标记为只读，删除类工具标记为破坏性，幂等写入标记为幂等
