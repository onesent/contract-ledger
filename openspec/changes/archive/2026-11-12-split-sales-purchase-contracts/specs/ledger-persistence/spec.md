# Spec Delta

## Purpose

保证数据结构在引入合同方向与交付执行后，既有本机数据与历史备份仍然安全可用，并明确新字段的版本、迁移、校验与导出规则。

## ADDED Requirements

### Requirement: 数据结构版本升级

数据结构版本 MUST 由 1 升级为 2。所有导出备份的 `schemaVersion` MUST 反映当前版本，`meta.schemaVersion` MUST 与实际数据版本一致。

#### Scenario: 导出反映新版本

- **WHEN** 用户在升级后导出备份
- **THEN** 备份文件中 `schemaVersion` 为 2，且包含交付执行明细集合

### Requirement: 幂等迁移补齐新字段

应用启动加载本机数据时 MUST 通过幂等迁移补齐新增字段：缺失的 `direction` 按 `typeCode` 为 `purchase` 推断为采购、其余推断为销售；缺失的 `deliveredAmount` 补 0；缺失的 `lastDeliveryDate` 补空字符串；缺失的 `deliveries` 集合补空数组。迁移 MUST NOT 删除或改写任何既有业务数据。

#### Scenario: 升级既有数据

- **WHEN** 用户带着 v1 数据首次启动升级后的应用
- **THEN** 原有合同全部保留，采购类型合同的 `direction` 为 `purchase`，其余为 `sale`，已交付金额为 0

#### Scenario: 重复迁移结果一致

- **WHEN** 迁移逻辑对同一份数据执行两次
- **THEN** 第二次执行不产生任何字段变化，也不新增或删除记录

### Requirement: v1 备份导入兼容

导入 `schemaVersion` 为 1 的备份 MUST 成功。备份中缺失的 `direction`、`deliveredAmount`、`lastDeliveryDate` 与 `deliveries` 只记警告，交由迁移补齐，MUST NOT 因字段缺失而拒绝整个备份。

#### Scenario: 导入旧备份

- **WHEN** 用户导入一份升级前导出的备份
- **THEN** 导入成功，合同、流水、人员与字典数量与备份一致，新字段由迁移补齐

### Requirement: 新版本备份字段校验

校验 `schemaVersion` 大于等于 2 的备份时，系统 MUST 校验合同方向取值合法、已交付金额为非负数字、交付明细为合法数组且其 `contractId` 指向存在的合同、交付金额大于 0、日期与时间戳格式合法。校验失败 MUST 拒绝导入且不修改现有数据。

#### Scenario: 非法方向取值

- **WHEN** 备份中某合同的 `direction` 为无法识别的值
- **THEN** 校验失败并指出具体记录与字段，现有数据保持不变

#### Scenario: 交付明细指向不存在的合同

- **WHEN** 备份中某条交付明细的 `contractId` 在合同集合中不存在
- **THEN** 校验失败并逐条列出错误路径

### Requirement: 备份包含新增业务数据

方向与交付执行明细属于业务数据，导出备份 MUST 全量包含。原有的密钥剔除规则 MUST 保持不变：导出文件中不得包含 `apiKey`、`baseUrl` 与 `ai.enabled`。

#### Scenario: 导出内容完整

- **WHEN** 用户配置了 AI 密钥后导出备份
- **THEN** 备份中包含全部交付执行明细与合同方向，且不包含任何 AI 密钥或 Base URL
