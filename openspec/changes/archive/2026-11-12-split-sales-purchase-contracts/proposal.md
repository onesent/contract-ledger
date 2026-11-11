# Proposal

## Why

现有台账只有一套销售语义：合同金额对应「已收金额」，列名、统计口径与提醒文案全部写死为收款方向。采购合同只能借「合同类型」字典项硬塞进来，结果是采购合同显示「已收 / 未收」、销售合同额与采购合同额被加在同一个「合同总金额」里，报表口径失真。

同时，合同只有资金一条执行线索，无法回答「货交了没有、验收了没有」。资金已收但货未交付、货物已交付但款未收到，这两种错位在当前模型里完全不可见。

## What Changes

- 新增合同方向 `direction`（`sale` / `purchase`），作为唯一的方向真相，决定对方称谓（客户 / 供应商）、金额标签（已收 / 已付）、统计口径与提醒语义。
- 合同功能拆分为「销售合同」与「采购合同」两个入口，共用同一视图、同一 `contracts` 集合，按方向过滤与换文案。
- 新增交付执行明细集合 `deliveries`，与既有的资金执行流水 `payments` 并列，构成两条独立的执行轴。
- 合同新增汇总字段 `deliveredAmount` 与 `lastDeliveryDate`，由 `deliveries` 在同一事务内维护；交付金额超出合同金额、金额被改小到低于已交付额时拦截。
- 列表与详情页提供「资金进度」「交付进度」两条独立进度条，并派生错位差额（预收 / 预付 / 应收 / 应付）。
- 首页统计卡与趋势图按方向分开计算，销售与采购不再相加。
- 新增提醒：超期未交付、已交付未收款、已到货未付款、预付未到货。
- 已有流水或交付记录的合同，方向锁定不可修改。
- 新建交付执行入参只记金额（纯金额计量），数量与单位仅作描述性备注，不参与进度计算。
- **BREAKING**：`SCHEMA_VERSION` 由 1 升至 2；`contracts` 新增方向与交付汇总字段，新增 `deliveries` 集合，备份结构随之变化。
- 兼容：v1 备份仍可导入，缺失的新字段由幂等迁移补齐（按 `typeCode === 'purchase'` 推断采购方向，其余默认销售）。
- 字典 `contractType` 中的「销售合同 / 采购合同」两项停用（不删除，避免引用计数拦截），方向不再由字典表达。

## Capabilities

### New Capabilities

- `contract-direction`: 合同方向的语义分叉——方向字段与取值、方向决定的称谓/金额标签/统计口径/提醒语义、方向锁定规则，以及销售与采购两个列表入口。
- `contract-execution`: 合同执行明细——资金执行流水与交付执行明细两条独立轴、资金进度与交付进度的派生、错位差额、汇总字段的事务不变量与回滚、执行进度筛选与提示。
- `ledger-persistence`: 数据持久化与备份兼容——schema 版本升级、幂等迁移补齐新字段、v1 备份导入兼容、新字段的备份校验规则。

### Modified Capabilities

无。项目当前没有已归档的主 spec，本变更引入的均为新能力。

## Impact

- `src/data/schema.js`：`SCHEMA_VERSION` 升至 2、`COLLECTIONS` 增加 `deliveries`、合同默认字段、`CONTRACT_COLUMNS` 按方向生成、`migrateDataset()` 幂等迁移、演示数据补采购合同与交付记录。
- `src/utils/validate.js`：`validateBackup()` 按 `payload.schemaVersion` 分版本校验新字段；新增交付记录与交付进度相关的表单规则。
- `src/utils/derive.js`：资金进度、交付进度、错位差额、按方向的统计与趋势、新增提醒分组、执行相关快捷筛选。
- `src/composables/useLedger.js`：`enrich()` 增加交付派生字段、`registerDelivery()` / `deleteDelivery()` 领域操作、`registerPayment()` 按方向返回文案、删除合同级联删除交付记录、方向与金额变更的前置校验。
- `src/components/ContractForm.vue`、`ContractTable.vue`、`ContractDetail.vue`：方向相关的标签、双进度条、交付明细区块。
- `src/views/ContractsView.vue`、`HomeView.vue`、`src/router/index.js`、`src/App.vue`：方向路由与导航、方向切换的首页、登记交付弹窗。
- `README.md`：数据结构、字段表、能力清单与自检清单同步更新。
- 备份文件结构向后不兼容（升级），但导入侧兼容 v1。
- 构建产物仍需为单个 `dist/index.html` 且 ≤ 5 MB，不新增依赖。
