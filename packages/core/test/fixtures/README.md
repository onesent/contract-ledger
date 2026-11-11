# 旧版备份 Fixtures

这些文件冻结自旧版单文件应用（`app: "contract-ledger"`）的备份结构，供导入迁移与派生视图测试复用。

## 预期记录数

| Fixture | contracts | payments | deliveries | personnel | dicts | schemaVersion |
|---|---|---|---|---|---|---|
| `backup-v2.json` | 3 | 4 | 3 | 3 | 13 | 2 |
| `backup-v1.json` | 3 | 4 | 0（无 `deliveries` 数组） | 3 | 13 | 1 |

字典共 13 项：`contractType` 3 项、`contractStatus` 5 项、`payMethod` 2 项、`department` 3 项。

## 故意保留的旧数据不一致

- **合同 `c...001`（销售，全额已收但零流水）**：`receivedAmount = 480000`，但没有任何 payment 行。导入时必须归档为 `opening_paid_cents = 480000`，视图的 `paidCents = openingPaidCents + 流水合计`，不得伪造流水。
- **合同 `c...002`（采购，已交付金额高于明细合计）**：`deliveredAmount = 180000`，3 条交付明细合计 150000。导入时必须归档为 `opening_delivered_cents = 30000`，视图的 `deliveredCents = openingDeliveredCents + 非 rejected 明细合计`。
- **合同 `c...002`（采购，4 笔付款）**：4 笔付款合计 200000，与 `receivedAmount = 200000` 相等，`opening_paid_cents = 0`。
- **合同 `c...003`（零金额，日期倒置）**：`startDate = 2026-02-01` 晚于 `dueDate = 2026-01-31`。这是旧数据质量异常，导入流程必须原样保留并能在 `validate` 中定位，不得在导入时静默修正。
- **人员 `王强`（`active = false`）**：已离职，用于验证 `OWNER_INACTIVE` 校验与历史姓名快照。
- **`settings.ai` 含敏感值**：`apiKey`、`baseUrl`、`enabled` 均为非空/开启状态，用于证明导出备份时会被强制剔除。
- **v1 缺失字段**：`backup-v1.json` 的合同没有 `direction` / `deliveredAmount` / `lastDeliveryDate`，且没有 `deliveries` 数组；合同 `c...002` 的 `typeCode = "purchase"`，导入时据此推断为采购方向，其余默认为销售。

金额单位与旧版一致：**元**（导入时半进位转换为整数分）。业务日期为 `YYYY-MM-DD`，时间戳为 ISO-8601。
