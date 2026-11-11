# Spec Delta

## Purpose

以 SQLite 作为唯一真相源，保证金额、引用与执行不变量在数据库层不可破坏，并让迁移、备份与恢复可验证。

## ADDED Requirements

### Requirement: 单一真相源

业务数据 MUST 只存于 SQLite 主库；浏览器存储 MUST NOT 作为读取或写入来源，界面与服务 MUST 通过同一库读写。

#### Scenario: 浏览器残留数据

- **WHEN** 浏览器中仍存在旧版 IndexedDB 数据而主库已启用
- **THEN** 系统忽略旧数据，只读取 SQLite 主库

### Requirement: 金额整数分

所有金额字段 MUST 以整数分存储与传输；MUST NOT 使用浮点列或浮点累加计算金额。

#### Scenario: 金额入库

- **WHEN** 录入合同金额 38400.00 元
- **THEN** 主库存储 3840000 分，读数与展示精确还原为 38400.00 元

### Requirement: 派生值不落库

已付/未付金额、资金进度、交付进度、逾期与统计 MUST 由查询或视图实时计算，MUST NOT 存为可写列。

#### Scenario: 登记一笔付款

- **WHEN** 新增一条 3200 元付款流水
- **THEN** 合同的已付、未付与付款进度随之变化，且没有更新任何汇总列

### Requirement: 引用完整性

合同对字典项、人员的引用，以及流水、交付对合同的引用 MUST 由外键约束；删除被引用的字典项或人员 MUST 被拒绝。

#### Scenario: 删除被引用字典项

- **WHEN** 尝试删除已被合同引用的采购方式字典项
- **THEN** 数据库拒绝删除，接口返回 `DICT_IN_USE`

### Requirement: 执行金额不变量

付款累计 MUST NOT 超过合同金额；合同金额 MUST NOT 下调到低于已付或已交付金额；违反时 MUST 回滚整个事务。

#### Scenario: 超付

- **WHEN** 对合同新增一笔会使用户付款累计超过合同金额的流水
- **THEN** 事务回滚并返回 `PAYMENT_EXCEEDS_CONTRACT_AMOUNT`

### Requirement: 状态日志

合同状态变更 MUST 写入状态日志，记录旧状态、新状态、变更时间与操作人，并与状态更新在同一事务内提交。

#### Scenario: 状态改为已完结

- **WHEN** 合同状态从执行中改为已完结
- **THEN** 状态日志新增一条记录，包含前后状态、时间与操作者

### Requirement: 带校验和的迁移

数据结构变更 MUST 通过带版本号与校验和的迁移脚本执行；迁移 MUST 幂等，执行失败 MUST 整体回滚且不留下半完成状态。

#### Scenario: 迁移中途失败

- **WHEN** 某条迁移脚本执行出错
- **THEN** 本次迁移整体回滚，版本号保持迁移前的值

#### Scenario: 重复执行迁移

- **WHEN** 对同一数据库连续执行两次迁移
- **THEN** 第二次不产生任何结构或数据变化

### Requirement: 一致性备份

系统 MUST 提供不中断写入的一致性备份，并 MUST 能在备份副本上执行完整性检查。

#### Scenario: 运行中备份

- **WHEN** 服务运行且有写入时执行备份
- **THEN** 生成的备份可独立打开且完整性检查通过

### Requirement: 多进程写入安全

同一数据库被服务与 CLI 同时写入时 MUST 串行化，MUST NOT 产生部分写入或读到自己未提交的数据。

#### Scenario: CLI 与服务并发写

- **WHEN** CLI 与服务几乎同时写入同一合同
- **THEN** 两次写入按序完成，最终数据一致且无中间态

### Requirement: 旧数据迁移

系统 MUST 支持从 v2 备份迁移到新库，保留合同方向、资金流水、交付明细、人员与字典，并明确报告迁移前后的记录数。

#### Scenario: 导入旧备份

- **WHEN** 导入一份 v2 JSON 备份
- **THEN** 各集合记录数与备份一致，派生字段可正确重算
