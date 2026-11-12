# Spec Delta

## Purpose

为前端与外部调用方提供一致、分页、可筛选的读模型与受控命令端点，避免任何调用方直接接触数据库。

## ADDED Requirements

### Requirement: 读模型端点

服务 MUST 提供合同、资金流水、交付明细、人员与字典的列表与详情读取能力，且详情 MUST 包含关联的执行记录。

#### Scenario: 读取合同详情

- **WHEN** 请求某合同的详情
- **THEN** 返回合同字段、资金流水、交付明细与状态日志

### Requirement: 服务端分页筛选排序

列表查询 MUST 支持分页、筛选与排序参数，并 MUST 返回总数与当前页信息；前端 MUST NOT 依赖全量数据在本地分页。

#### Scenario: 按方向筛选

- **WHEN** 请求采购方向、第 2 页、每页 20 条
- **THEN** 只返回采购合同的第 2 页与采购方向总数

### Requirement: 派生字段随读返回

列表与详情 MUST 返回已付、未付、资金进度、交付进度与逾期状态等派生字段，调用方 MUST NOT 重复实现派生算法。

#### Scenario: 列表进度

- **WHEN** 读取合同列表
- **THEN** 每行都带派生进度与未付金额，与数据库视图一致

### Requirement: 统计与提醒

服务 MUST 提供按方向分组的统计与提醒查询，销售与采购金额 MUST NOT 相加。

#### Scenario: 首页统计

- **WHEN** 请求采购方向的统计
- **THEN** 返回的合同总金额只包含采购合同

### Requirement: 写操作只经命令端点

所有写操作 MUST 通过命令端点执行，MUST NOT 提供直接插入、更新或删除业务表的端点。

#### Scenario: 尝试直写

- **WHEN** 调用方请求直接更新合同表
- **THEN** 该请求不存在或被拒绝，必须改用命令端点

### Requirement: 导出与导入

服务 MUST 提供 JSON 导出与导入；导出 MUST 包含全部业务集合，并 MUST 剔除 `apiKey`、`baseUrl` 与 `ai.enabled`。

#### Scenario: 导出备份

- **WHEN** 调用导出接口
- **THEN** 返回完整 JSON，且不含任何密钥字段

### Requirement: 健康与版本端点

服务 MUST 提供不含业务数据的健康端点，返回版本、数据库大小与可写状态。

#### Scenario: 存活探测

- **WHEN** 请求健康端点
- **THEN** 返回服务状态与版本，不返回任何合同数据

### Requirement: 错误状态映射

业务错误 MUST 映射为稳定 HTTP 状态：参数错误 400、未认证 401、不匹配 409/412、校验失败 422、只读 403。

#### Scenario: 版本冲突

- **WHEN** 命令携带过期的期望版本
- **THEN** 返回 412 与当前版本号

### Requirement: 只读模式

数据库不可写时服务 MUST 进入只读模式，写端点 MUST 返回 `READONLY`，读与导出 MUST 保持可用。

#### Scenario: 磁盘写满

- **WHEN** 写入因配额或权限失败
- **THEN** 服务转为只读，后续写请求被拒绝并提示导出数据
