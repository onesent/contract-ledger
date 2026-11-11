# Tasks

## 1. 数据模型与迁移

- [x] 1.1 `src/data/schema.js`：`SCHEMA_VERSION` 改为 2，`COLLECTIONS` 增加 `deliveries`，`emptyDataset()` 增加 `deliveries: []`；`node -e "import('./src/data/schema.js').then(m=>console.log(m.SCHEMA_VERSION, m.COLLECTIONS, Object.keys(m.emptyDataset())))"` 输出 `2`、包含 `deliveries`、空数据集键齐全
- [x] 1.2 `src/data/schema.js`：合同默认字段增加 `direction: 'sale'`、`deliveredAmount: 0`、`lastDeliveryDate: ''`；新增 `contractColumns(direction)` 返回按方向替换 label 的列定义（`prop` 保持不变）；`node -e "import('./src/data/schema.js').then(m=>console.log(m.contractColumns('purchase').map(c=>c.label).join('|')))"` 出现「供应商」「已付金额」「未付金额」且 `prop` 与旧定义一致
- [x] 1.3 `src/data/schema.js`：`migrateDataset()` 补齐四项新字段（`typeCode === 'purchase'` 推断采购，其余销售）、停用 `contractType` 的 `sales`/`purchase` 字典项（`enabled: false`）、写一条 `meta.opLogs` 迁移摘要；对同一份含 v1 合同的样例数据连续执行两次，第二次输出与第一次完全一致
- [x] 1.4 `src/data/schema.js`：演示数据补充至少 3 份采购合同与至少 6 条交付明细（含 `delivered`、`accepted`、`rejected` 三种状态，以及 0 进度、部分进度、满进度各一），日期仍按载入当天相对生成；载入演示数据后两条进度均有非零与非满值样本

## 2. 校验与备份兼容

- [x] 2.1 `src/utils/validate.js`：`validateBackup()` 按 `payload.schemaVersion` 分支——`>= 2` 校验 `direction` 取值、`deliveredAmount` 非负数字、`deliveries` 结构与 `contractId` 引用、交付金额大于 0、日期与时间戳格式；`=== 1` 时新字段缺失只记 `warning`；构造缺失 `direction` 的 v1 payload 校验结果为 `ok: true` 且含 warning
- [x] 2.2 `src/data/backup.js`：导出与导入前快照包含 `deliveries`，`counts` 增加交付条数；导出后检查 JSON 含 `deliveries` 且不含 `apiKey` / `baseUrl` / `ai.enabled`
- [x] 2.3 `src/data/backup.js`：合并导入前按 id 预检方向冲突，本机已有流水或交付记录的合同保留本机方向并计入「保留条数」，不静默翻转；用构造的两份方向冲突备份验证合并结果与统计文案

## 3. 派生层（纯函数）

- [x] 3.1 `src/utils/derive.js`：`paymentPercent` 更名为 `fundingPercent`，新增 `deliveryPercent()`、`executionGap()`、`gapState()`（返回 `prepaid` / `receivable` / `balanced` / `none`）；`amount <= 0` 时两个进度均返回 `null`；用 node 断言金额 120 万、已收 96 万、已交付 90 万时得到 80 / 75 / 差额 6 万 / `prepaid`
- [x] 3.2 `src/utils/derive.js`：`computeStats()` 接受 `direction` 并只统计该方向合同，新增 `deliveredAmount` 与整体交付率；用销售 + 采购混合样例断言两个方向金额不相加
- [x] 3.3 `src/utils/derive.js`：`monthlyTrend()` 与 `groupByDict()` 接受方向过滤；断言销售视图的收款序列不包含采购合同流水
- [x] 3.4 `src/utils/derive.js`：`computeReminders()` 增加 `overdueDelivery`、`deliveredUnpaid`、`prepaidUndelivered` 三组，键名沿用 `<group>:<contractId>`；构造一份已收满但未交付的销售合同，断言出现在 `prepaidUndelivered` 组且忽略键可写入 `ignoredReminders`
- [x] 3.5 `src/utils/derive.js`：`QUICK_FILTERS` / `matchesQuick()` 增加「已交付未收款」「已收款未交付」「已到货未付款」「已付款未到货」；断言销售方向下「已交付未收款」命中交付进度 > 0 且仍有未收金额的合同

## 4. 领域操作

- [x] 4.1 `src/composables/useLedger.js`：`buildContractRecord()` 增加方向校验（缺失默认 `sale`，取值非法拒绝）、方向锁（已有 `payments` 或 `deliveries` 时拒绝修改并返回 `DIRECTION_LOCKED`）、金额下限（`amount` 低于已收/已付或已交付时拒绝并提示差额）；分别构造三种非法输入验证返回 `ok: false`
- [x] 4.2 `src/composables/useLedger.js`：新增 `registerDelivery()` / `deleteDelivery()`，与 `registerPayment()` 同构——单事务写明细与合同汇总、交付金额不得超过剩余可交付金额、删除后回退金额并取剩余记录最大日期；登记后 `deliveredAmount` 与 `lastDeliveryDate` 立即变化，删除后正确回退
- [x] 4.3 `src/composables/useLedger.js`：`deleteContracts()` 级联删除 `deliveries`；`enrich()` 增加 `fundingPercent` / `deliveryPercent` / `executionGap` / `gapState` / `deliveryState`；新增 `statsByDirection` 与方向过滤后的 `reminders`、`trend`、`typeDistribution`；删除一份带交付记录的合同后 `deliveries` 无孤儿记录

## 5. 合同表单与列表

- [x] 5.1 `src/components/ContractForm.vue`：对方标签随方向显示「客户 / 供应商」，金额标签显示「已收 / 已付」，已交付金额只读展示，方向控件仅在无执行记录时可改（否则禁用并给 tooltip）；在采购入口打开表单，标题与字段标签全部为采购语义
- [x] 5.2 `src/components/ContractTable.vue`：新增资金进度与交付进度两列并接受外部 label 映射，`progressColor` 同时适用于两条进度；销售与采购列表分别渲染对应列名，窄屏卡片布局两条进度纵向堆叠
- [x] 5.3 `src/views/ContractsView.vue`：按 `route.meta.direction` 过滤数据与统计，新增交付进度区间筛选与登记交付弹窗，快捷筛选接入新选项，列显隐 `prop` 未变化因此旧设置继续生效；在采购入口无法看到销售合同，登记交付后列表与详情同步更新

## 6. 合同详情

- [x] 6.1 `src/components/ContractDetail.vue`：并列展示资金进度与交付进度两条 `el-progress`，显示错位差额并按方向给出预收/预付/应收/应付文案，双进度满额且状态为执行中时显示「可标记完结」提示（不改写状态）；销售预收与采购预付两种样本文案正确
- [x] 6.2 `src/components/ContractDetail.vue`：新增交付执行明细区块（`el-timeline`，显示金额、验收状态、备注、数量单位）与删除操作（二次确认 + 只读模式下禁用）；减少 10 万交付后金额与最后日期正确回退，今日无删除按钮可用

## 7. 路由、导航与首页

- [x] 7.1 `src/router/index.js` 与 `src/App.vue`：新增 `/contracts/sale`、`/contracts/purchase`，`/contracts` 重定向并透传 `query`；`el-menu` 用两个入口替换「合同管理」；访问 `/contracts?quick=overdue` 落到销售入口且筛选保留，浏览器前进后退不白屏
- [x] 7.2 `src/views/HomeView.vue`：增加方向切换（`el-radio-group`），统计卡、趋势图、类型饼图、状态分布、提醒清单按选中方向重算，新增交付进度相关卡片；销售与采购切换后「合同总金额」不出现两者相加，`/contracts` 跳转带上正确方向路由
- [x] 7.3 `src/components/ReminderList.vue` 与跳转逻辑：新增提醒组可点击跳转到带方向与快捷筛选的列表，忽略/恢复操作沿用既有机制；点击「已交付未收款」提醒后列表筛选条件与标签可见

## 8. 文档

- [x] 8.1 `README.md`：同步更新数据结构（`direction`、`deliveries`、`deliveredAmount`）、能力清单、字段与列说明、备份结构版本、自检清单与已知限制（`receivedAmount` 仍可手工编辑）；按文档中的导入步骤用 v1 备份走一遍能成功

## 9. 集成验收

- [x] 9.1 `npm run build && npm run check` 全部通过，产物 ≤ 5 MB，`dist/` 仅含 `index.html`
- [x] 9.2 手工冒烟：销售/采购两入口、首页方向切换、详情双进度、登记与删除交付、方向锁定、超交付拦截、改小合同金额拦截，控制台零报错
- [x] 9.3 兼容与降级：导入 v1 备份成功并能看到迁移后的方向；只读模式下所有新增写入口禁用并有 tooltip；375px 与 800px 无横向溢出

## Workflow follow-up

- 变更实现完成并通过验收后执行 `openspec archive split-sales-purchase-contracts`，把三个能力写入主 spec。
- 归档后运行 `openspec validate --all` 确认主 spec 无占位内容。
