# Design

## Context

动机见 `proposal.md`，行为契约见 `specs/contract-direction`、`specs/contract-execution`、`specs/ledger-persistence`。

当前实现的关键事实：

- 单集合 `contracts`，销售语义写死在派生层：`derive.js` 的 `unpaidAmount` / `paymentPercent` / `paymentState` / `computeStats` / `monthlyTrend` 全部假设「合同金额 - 已收金额」。
- 资金流水 `payments` 与合同 `receivedAmount` 通过 `applyChanges()` 单事务维护，是本项目已验证过的「明细 + 汇总」模式，交付执行可以直接复用同一套不变量。
- 所有写入必须经 `store.applyChanges()`；派生字段实时计算、不落库；`CONTRACT_COLUMNS` 的 `prop` 同时是 `settings.columnVisibility` 的键。
- 硬约束：单文件产物、零网络、无 TypeScript、无新增依赖、`npm run build && npm run check` 必须通过。
- `SCHEMA_VERSION = 1`，`migrateDataset()` 已在每次加载时执行，天然是迁移入口。
- 当前没有主 spec，`openspec/specs/` 为空。

## Goals / Non-Goals

**Goals:**

- 用最小数据变更引入方向语义，保持「单集合 + 单事务 + 单备份」的既有优点。
- 让两条执行轴在派生层结构对称：同一分母、同一汇总模式、同一回滚规则。
- 迁移与备份兼容在实现层可验证（v1 备份导入、幂等迁移、双击执行结果不变）。

**Non-Goals:**

- 不做执行计划（付款计划 / 交付计划节点），本期只记实际发生。
- 不做交付记录与资金流水的一对一核销。
- 不引入供应商主数据，采购对方仍是自由文本 + 历史联想。
- 不自动流转合同状态。
- 不重构 `receivedAmount` 的手工可编辑现状（见 Risks）。

## Decisions

### D1. 单集合 + `direction` 字段，而不是拆成两个集合

`contracts` 保持单集合，新增 `direction: 'sale' | 'purchase'`。

- 备选：`salesContracts[]` + `purchaseContracts[]`。否决原因：schema、校验、迁移、备份、统计、提醒全部要写两份，且跨方向汇总（如应收 + 应付）必须手工拼接，违反「多集合操作必须同一次 `applyChanges`」的简化前提。
- 代价：所有派生函数需要接受方向或按方向分组，必须逐个改造，不能靠集合隔离自然获得正确性。

### D2. `deliveries` 独立集合，不与 `payments` 合表

增设 `deliveries` 集合，字段为 `id / contractId / date / amount / quantity / unit / status / note / createdAt / updatedAt`。

- 备选：单集合 `executions` + `kind` 字段。否决原因：资金流水有 `methodCode`，交付记录有 `quantity / unit / status`，合表后一半字段长期为空，表单与校验都要写分支，且无法用集合级校验约束「交付金额 > 0」。
- `status` 取 `delivered | accepted | rejected`；`deliveredAmount` 累计 `delivered + accepted`，`rejected` 不计入，但保留在明细中供追溯。

### D3. 汇总字段落库，且只由明细维护

合同新增 `deliveredAmount` 与 `lastDeliveryDate`，与 `receivedAmount` / `paymentDate` 完全同构：只能由 `registerDelivery` / `deleteDelivery` 在同一事务内更新，表单中只读。

- 理由：`computeStats` 与列表排序若每次都遍历 `deliveries` 聚合，会让派生层依赖集合扫描；而现有 `receivedAmount` 已是落库汇总，保持对称比「全部实时聚合」更小的改动面。
- 交付是纯金额计量（见 proposal），`quantity` / `unit` 仅为描述，不参与任何计算与校验。

### D4. 两条进度共用合同金额作为分母

`fundingPercent = receivedAmount / amount`，`deliveryPercent = deliveredAmount / amount`，`amount <= 0` 时两者返回 `null`（UI 显示「—」）。

- 这是纯金额计量口径的直接结果，也使 `executionGap = receivedAmount - deliveredAmount` 有意义。
- 派生层改造：`paymentPercent` 更名为 `fundingPercent`，`enrich()` 中的 `percent` 更名为 `fundingPercent` 并新增 `deliveryPercent`、`executionGap`、`gapState`。都是内存派生字段，不改备份结构。

### D5. 方向锁定在领域层，不在 UI 层

`buildContractRecord()` 中校验：若 `existing` 存在、方向发生变化、且该合同已有 `payments` 或 `deliveries`，返回 `{ ok: false, code: 'DIRECTION_LOCKED' }`。表单只把方向控件置灰并给 tooltip，真正拦截在 `applyChanges` 之前。

- 理由：UI 可以被绕过（批量操作、导入合并），领域层是唯一可靠拦截点；与现有 `OWNER_INACTIVE` 的处理方式一致。

### D6. 列定义保持静态，label 运行时解析

`CONTRACT_COLUMNS` 的 `prop / width / align / fixed` 不变，新增 `deliveryProgress` 列；新增 `contractColumns(direction)` 返回补齐 label 的数组。

- 理由：`settings.columnVisibility` 以 `prop` 为键，保持 `prop` 不变就不需要迁移设置，也不必给 `columnVisibility` 加方向维度。
- 文案映射集中在 `schema.js` 一处，避免列名散落在模板里。

### D7. 路由拆分 + 兼容旧链接

新增 `/contracts/sale` 与 `/contracts/purchase`，`/contracts` 保留为重定向入口并把 `query` 透传。`ContractsView` 通过 `route.meta.direction` 决定模式。

- 理由：`HomeView` 目前用 `/contracts?quick=...` 跳转，详情页跳转也带 `detail` 参数；保留重定向可以一次改完调用方而不破坏书签。
- 导航：`App.vue` 的 `el-menu` 增加两项，`合同管理` 项移除。

### D8. 首页按方向切换，不做合并总数

`ledger.statsByDirection` 暴露 `{ sale, purchase }`，`HomeView` 用 `el-radio-group` 选择方向，卡片、趋势图、类型饼图、状态分布全部基于选中方向。

- 理由：把销售与采购相加在业务上没有意义，而做「净额」需要额外定义（是否含税、是否同期），超出本期范围。
- 提醒清单同样按方向过滤，但保留一个「全部」视图用于集中处理待办（只展示条数，不合并金额）。

### D9. 备份校验按 `payload.schemaVersion` 分版本

`validateBackup()` 增加 `version` 分支：`version >= 2` 时校验 `direction` / `deliveredAmount` / `deliveries`；`version === 1` 时这些字段缺失只记 `warning`。

- 理由：`validateBackup()` 在 `applyChanges({ replace })` 之前执行，若对新字段一律必填，所有历史备份都会导入失败；迁移发生在写入之后，救不了校验阶段。

### D10. `contractType` 字典停用两项，不删除

迁移时把 `contractType` 中 `sales` / `purchase` 两项 `enabled` 置为 `false`，不删除。

- 理由：删除会被字典引用计数拦截（`referenceCountForDict` 统计 `typeCode` 命中数），而迁移阶段逐条弹窗确认不可接受；停用后不出现在录入下拉，但历史合同仍能正确显示类型名。
- 方向不再由字典驱动：方向会影响统计与校验，必须是不受用户编辑的固定枚举；字典只承担展示性分类。

### D11. 新增提醒分组，复用既有提醒管线

`computeReminders()` 增加三组：`overdueDelivery`（超期未交付）、`deliveredUnpaid`（已交付未收/未付超过 `overdueDays`）、`prepaidUndelivered`（预付/预收未交付）。键名沿用 `<group>:<contractId>`，`ignoredReminders` 机制无需改动。

## Risks / Trade-offs

- **`receivedAmount` 仍可手工编辑，`deliveredAmount` 只读** → 两条轴的维护方式不一致，用户可能手改已收金额制造「已收 > 交付」的假象。缓解：本次不改现状（改动会波及表单、校验、README 与用户习惯），但把「合同金额不得低于已收/已交付」列入保存校验；README 明确「建议始终用登记流水维护」。后续可单独发起只读化变更。
- **方向迁移可能误判** → 一份实际是采购、但 `typeCode` 填成「服务合同」的历史合同会被推断为销售，且不会报错。缓解：迁移后若发生推断，在 `meta.opLogs` 记一条汇总日志，并在设置页显示一次「N 份合同按类型推断为采购，请核对」的提示。
- **方向锁定与导入合并冲突** → 合并导入时若备份中同一 id 合同方向不同且本机已有流水，`updatedAt` 较新的会覆盖。缓解：合并导入前按 id 预检方向冲突，冲突项以本机方向为准并计入「保留条数」，不静默翻转。
- **提醒组增多导致首页拥挤** → 缓解：新提醒复用 `ReminderList` 的折叠与忽略机制，并默认只在对应方向视图展示。
- **窄屏双进度条挤压** → 缓解：卡片布局下两条进度条纵向堆叠，375px 实测无横向溢出（列入任务验收）。
- **单文件体积增长** → 新增一个集合与少量 UI，预计增量远低于 1 MB 余量。缓解：构建后仍执行 `npm run check`。

## Migration Plan

1. `SCHEMA_VERSION` 升为 2，`COLLECTIONS` 增加 `deliveries`，`emptyDataset()` 增加空数组。
2. `migrateDataset()` 补齐：`direction`（按 `typeCode` 推断）、`deliveredAmount = 0`、`lastDeliveryDate = ''`、`deliveries = []`；停用 `contractType` 的 `sales` / `purchase`；结果写入 `meta.opLogs` 一条迁移摘要。
3. `validateBackup()` 按版本分支校验；`backup.js` 的快照与导出按集合遍历，自动带上 `deliveries`。
4. `derive.js` 增加 `fundingPercent` / `deliveryPercent` / `executionGap` / `gapState`，`computeStats`、`computeReminders`、`monthlyTrend`、`groupByDict` 接受方向过滤。
5. `useLedger` 增加 `registerDelivery` / `deleteDelivery` / `statsByDirection`，`deleteContracts` 级联删除 `deliveries`，`buildContractRecord` 增加方向锁与金额下限校验。
6. UI 层：路由与导航、`contractColumns(direction)`、双进度条、登记交付弹窗、首页方向切换。
7. 演示数据：补充采购合同与交付记录，保证任意日期下两条进度都有非零与非满值样本。

回滚策略：本次为纯前端本机应用，回滚即回退代码；但 v2 数据被 v1 代码读取时新字段会被 `migrateDataset()` 原样保留（只补不删），不会丢数据。因此回滚前应先导出 v2 备份，回滚后如需回到 v1 结构，按备份文件手工移除新字段。

## Open Questions

- 交付验收是否需要「验收人」字段。当前用合同负责人 + `operatorName` 兜底，若后续需要独立验收人签名，可在 `deliveries` 增加 `acceptedBy`，不影响既有结构。
- 是否把 `overdueDelivery` 的判定阈值做成独立设置项（当前复用 `overdueDays`）。可在观察实际使用后再决定，不影响本期实现。
