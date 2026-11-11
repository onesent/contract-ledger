# 变更记录：split-sales-purchase-contracts

- **影响能力**：`contract-direction`、`contract-execution`、`ledger-persistence`
- **归档日期**：2026-11-12
- **数据契约**：`SCHEMA_VERSION` 1 → 2；新增集合 `deliveries`；合同新增 `direction`、`deliveredAmount`、`lastDeliveryDate`

本文件随本次变更归档，只记录这一次方案的决策与影响；后续变更各自在自己的变更目录内维护 `changelog.md`，不写入 `openspec/specs/`。

## 背景

原台账只有销售语义（客户 / 已收 / 未收），采购业务只能借用销售字段，称谓与统计口径都是错的；同时合同只跟踪资金，无法反映「货到没到、验没验收」，采购场景缺可逐批录入的执行记录。

## 关键决策

### 合同方向（contract-direction）

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 方向载体 | 单个 `contracts` 集合 + `direction: 'sale' \| 'purchase'` 作为唯一方向真相 | 拆成 `sales` / `purchase` 两个集合：统计、备份、提醒、迁移都要双写，长期必然漂移 |
| 方向可变性 | 已有资金流水或交付明细时锁定，保存返回 `DIRECTION_LOCKED` | 允许随时改方向：历史流水会被重新解释为「已付/已收」，等同篡改账目 |
| 称谓与金额标签 | 由方向决定：客户/供应商、已收/已付、未收/未付、收款进度/付款进度、收款流水/付款流水 | 页面上提供称谓切换：同一份数据两套叫法，报表无法对账 |
| 入口 | 独立路由 `/contracts/sale`、`/contracts/purchase`，共用同一视图按 `route.meta.direction` 过滤 | 单页面内 tab 切换：书签无法直达，前进后退语义模糊 |
| 旧链接 | `/contracts` 函数重定向到销售入口并透传 `query` | 直接 404 或忽略 query：旧书签、`?quick=`、`?detail=` 失效 |
| 表格列定义 | `CONTRACT_COLUMNS` 的 `prop` 不变，仅按方向替换 label（`contractColumns(direction)`） | 按方向维护两套列：老用户的列显隐偏好全部失效 |
| 缺失方向的历史数据 | 读取与迁移时一律视为 `sale` | 报错或不显示：历史数据直接不可用 |

### 合同执行（contract-execution）

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| 交付记录 | 新增 `deliveries` 集合，与 `payments` 同构：明细 + 同事务维护合同汇总 | 只在合同上放 `deliveredAmount` 手填：无法撤销、无法追溯、无法按批验收 |
| 进度分母 | 资金进度与交付进度共用合同金额 | 交付另设「交付金额」作分母：两套金额体系，口径无法对齐 |
| 错位提示 | `executionGap = receivedAmount − deliveredAmount`，派生预收 / 预付 / 已交付未收款 / 已到货未付款四态 | 只展示两条进度：用户看不出差额的方向和金额 |
| 验收语义 | `status` 取 `delivered` / `accepted` / `rejected`；`rejected` 不计入已交付但保留供追溯 | 只保留「已交付」一态：验收驳回无法留痕，删除记录又丢失历史 |
| 数量与单位 | `quantity` / `unit` 仅作描述，不参与任何计算 | 用数量作进度分母：与合同金额无法换算，出现第二套计量体系 |
| 超交付 | 界面 `:max` 夹紧 + 领域层校验拒绝 | 允许超交付再在报表中特殊处理：口径不可解释 |
| 金额下限 | 合同金额不得改到低于已收/已付或已交付金额 | 允许改小金额：进度溢出 100%，历史数据自相矛盾 |

### 台账持久化（ledger-persistence）

| 决策点 | 选择 | 被否决方案与理由 |
|---|---|---|
| schema 版本 | `SCHEMA_VERSION` 1 → 2；`store.js` 的 `DB_VERSION` 同步 | 不升版本靠字段探测：无法区分「用户故意留空」与「老数据缺失」 |
| 迁移方式 | `migrateDataset()` 幂等补齐，连续迁移两次结果一致 | 一次性脚本迁移：中断后无法重入，无法在 localStorage 降级路径复用 |
| 备份校验 | `validateBackup()` 按 `payload.schemaVersion` 分版本，v1 备份缺新字段只警告 | 统一按 v2 严格校验：用户手上的历史备份全部不可导入 |
| 合并导入冲突 | 同 `id` 方向不一致且本机已有执行记录时以本机为准，计入「保留条数」 | 无条件以备份覆盖：静默翻转方向，历史流水语义被改写 |
| 字典处理 | 停用（不删除）`contractType` 的「销售合同 / 采购合同」两项 | 直接删除：被合同引用时触发引用保护，迁移失败或数据悬空 |

## 影响面

- **数据**：`COLLECTIONS` 增加 `deliveries`；`cloneDataset` / `countsOf` / `mergeDatasets` 同步支持（曾因漏改导致交付明细被静默丢弃，已修复）；导出、快照、导入、导入前快照全链路覆盖。
- **领域层**：新增 `registerDelivery` / `deleteDelivery`；错误码 `DIRECTION_LOCKED`、`DIRECTION_INVALID`、`AMOUNT_BELOW_RECEIVED`、`AMOUNT_BELOW_DELIVERED`；`buildContractRecord` 做方向锁与金额下限校验。
- **派生层**：`percent` 拆为 `fundingPercent` / `deliveryPercent`，新增 `executionGap` / `gapState`；统计、提醒、趋势、分类按方向分组，销售与采购不得相加；合同金额为 0 时进度返回 `null`（显示 `—`）。
- **界面**：菜单与路由拆双入口；列表双进度列；详情双进度条 + 错位差额 + 交付明细（`el-timeline`）；首页方向切换；登记交付弹窗。
- **一致性**：删除合同在同一次事务中级联删除资金流水与交付明细；删除交付明细后按剩余明细重算汇总（`rejected` 不计入），`lastDeliveryDate` 取剩余最大值。
- **文档**：README 回归使用文档，变更记录移出 README。

## 兼容与回滚

- 旧数据启动即幂等迁移；`typeCode === 'purchase'` 推断为采购，其余默认销售；补 `deliveredAmount = 0`、`lastDeliveryDate = ''`、`deliveries = []`，并写一条 `meta.opLogs` 迁移摘要。
- v1 备份可导入（缺失字段只告警）；v2 备份不能被旧版本导入（版本校验拒绝），跨版本回退需先导出当前数据。
- 只读模式与 `file://` 便携模式语义不变；写入失败区分 `QUOTA` / `SECURITY` / `WRITE_FAILED`，明确报错并停止写入，不谎报成功。
- 回退代码需同时回退数据（重新导入归档前备份）：`direction` 会被忽略而采购合同按销售语义展示，`receivedAmount` 已按新流程变动。

## 遗留问题

- 超交付仅由界面 `:max` 夹紧 + 领域层校验拦截，未对「界面强行提交超限」做自动化实测（领域层拒绝分支已覆盖）。
- `rejected` 暂无「驳回后重新提交」的界面入口。
- 采购对方仍是自由文本 + 历史联想，没有供应商主数据档案（无唯一性、引用保护、转交语义）。
- 只记录实际发生的流水与交付，不含计划节点，也不做流水与交付的一对一核销；交付明细暂无独立「验收人」字段。
- 备份体积随交付明细增长，暂无分片导出；localStorage 降级档位按整库单键写入，更容易触达配额。
