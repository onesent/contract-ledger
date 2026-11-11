# 冻结决策（agent-native-ledger）

来源：`openspec/changes/agent-native-ledger`（design.md D1–D14 + 数据模型）。以下决策在 Wave 1 冻结，后续实现不得单方面改变。

- Version semantics: global dataset version stored in `meta.version`, incremented exactly once per successful write transaction; `expectedVersion` is optional; mismatch → STALE_WRITE 409 with `currentVersion`.
- One envelope for all transports; CLI adds only `schema_version` + `command`.
- MCP tool names are snake_case (contract_upsert, payment_record, ...), args snake_case (idempotency_key, expected_version). Dots are invalid in MCP tool names.
- `idempotency_keys` table is the single authority; payments/deliveries MUST NOT have their own idempotency_key column. Key scope = (actor, command, key); fingerprint = sha256 of canonical JSON input; same key+same fingerprint replays stored result; different fingerprint → IDEMPOTENCY_KEY_REUSED.
- Auth tables live in `001_init.sql`.
- Legacy import: yuan → integer cents half-up; `typeCode` resolved to dict_items(category='contractType', code=typeCode), creating missing items on demand; legacy contract.receivedAmount/deliveredAmount that exceed the sum of imported payment/delivery rows are preserved as `opening_paid_cents` / `opening_delivered_cents` on contracts (views add opening + rows). Never fabricate payment/delivery rows.
- settings stored as key/value JSON rows (`settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`).
- Open-question defaults: procurement-specific fields out of scope (separate change); no static snapshot build; MCP defaults to v2 with `--legacy` v1 switch; browser data migration via one-time `ledger import` (no guide page).
