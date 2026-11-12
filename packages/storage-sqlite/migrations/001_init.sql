-- ============================================================================
-- agent-native-ledger 初始 DDL（版本 001）
--
-- 约定：
--   1. 所有金额列一律 INTEGER（整数分），禁止 REAL 存金额。
--   2. 业务日期为 TEXT 'YYYY-MM-DD'，时间戳为 TEXT ISO-8601 UTC。
--   3. 派生值（已付/未付/进度/错位）只存在于视图，不落库。
--   4. 幂等表 idempotency_keys 是幂等性的唯一权威；payments/deliveries 不设
--      idempotency_key 列（DECISIONS.md 冻结）。
--   5. audit_log 只追加：应用层不得 UPDATE/DELETE；本文件不创建修改触发器，
--      因为审计写入由同一事务内的应用层完成（触发器拿不到操作者上下文）。
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- 元数据 ----
-- 全局数据集版本等系统级键值（DECISIONS：meta.version 每次成功写入 +1）。
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 业务设置按 key/value 存 JSON，避免每新增设置都要迁移表结构。
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------------ 字典 ----
CREATE TABLE dict_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dict_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES dict_categories(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (category_id, code)
);

-- ------------------------------------------------------------------ 人员 ----
-- position / email 用于满足 PersonnelRow 契约；department_code 引用部门字典项 code。
CREATE TABLE personnel (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  department_code TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  hire_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------------ 合同 ----
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('sale', 'purchase')),
  counterparty TEXT NOT NULL,
  type_item_id TEXT NOT NULL REFERENCES dict_items(id),
  status_item_id TEXT NOT NULL REFERENCES dict_items(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  -- 旧账导入的开账余额：视图按 opening + 明细求和，避免导入时伪造流水。
  opening_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_paid_cents >= 0),
  opening_delivered_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_delivered_cents >= 0),
  sign_date TEXT NOT NULL,
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  owner_id TEXT NULL REFERENCES personnel(id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  CHECK (due_date >= start_date)
);

-- ------------------------------------------------------------------ 流水 ----
-- 不设 idempotency_key 列：幂等由 idempotency_keys(actor, command, key) 统一负责。
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method_code TEXT NOT NULL DEFAULT 'transfer',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- -------------------------------------------------------------- 交付明细 ----
-- rejected 不计入已交付金额，但保留以供追溯。
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  quantity REAL NULL CHECK (quantity IS NULL OR quantity > 0),
  unit TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('delivered', 'accepted', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- -------------------------------------------------------------- 状态日志 ----
CREATE TABLE contract_status_logs (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  from_code TEXT,
  to_code TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------------ 审计 ----
-- 只追加表：应用层只 INSERT，不 UPDATE/DELETE（保留完整 before/after 快照）。
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT NOT NULL,
  idempotency_key TEXT,
  entity TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  summary TEXT
);

-- ------------------------------------------------------------------ 幂等 ----
-- 幂等性唯一权威：key 作用域为 (actor, command, key)；fingerprint 为规范化入参哈希。
CREATE TABLE idempotency_keys (
  actor TEXT NOT NULL,
  command TEXT NOT NULL,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor, command, key)
);

-- ------------------------------------------------------------------ 认证 ----
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

-- ------------------------------------------------------------------ 视图 ----
-- 资金视图：已付 = 开账余额 + 全部资金流水之和。
CREATE VIEW v_contract_finance AS
SELECT
  c.id AS contract_id,
  c.opening_paid_cents + COALESCE(SUM(p.amount_cents), 0) AS paid_cents,
  MAX(0, c.amount_cents - (c.opening_paid_cents + COALESCE(SUM(p.amount_cents), 0))) AS unpaid_cents,
  MAX(p.date) AS last_payment_date
FROM contracts c
LEFT JOIN payments p ON p.contract_id = c.id
GROUP BY c.id;

-- 交付视图：已交付 = 开账余额 + 非 rejected 明细之和；最后交付日期同样忽略 rejected。
CREATE VIEW v_contract_delivery AS
SELECT
  c.id AS contract_id,
  c.opening_delivered_cents
    + COALESCE(SUM(CASE WHEN d.status <> 'rejected' THEN d.amount_cents ELSE 0 END), 0) AS delivered_cents,
  MAX(CASE WHEN d.status <> 'rejected' THEN d.date END) AS last_delivery_date
FROM contracts c
LEFT JOIN deliveries d ON d.contract_id = c.id
GROUP BY c.id;

-- 合同全量视图：行字段 + 字典名称 + 负责人 + 资金/交付派生值。
-- 合同金额为 0 时两个进度返回 NULL（展示为「—」），与旧版 derive.js 语义一致。
-- 进度四舍五入到 2 位小数并夹取到 0–100（与旧版 roundMoney(percent, 2) 一致）。
CREATE VIEW v_contract_full AS
SELECT
  c.id AS id,
  c.no AS no,
  c.project_name AS project_name,
  c.direction AS direction,
  c.counterparty AS counterparty,
  c.type_item_id AS type_item_id,
  COALESCE(ti.code, '') AS type_code,
  COALESCE(ti.name, '') AS type_name,
  c.status_item_id AS status_item_id,
  COALESCE(si.code, '') AS status_code,
  COALESCE(si.name, '') AS status_name,
  c.amount_cents AS amount_cents,
  c.opening_paid_cents AS opening_paid_cents,
  f.paid_cents AS paid_cents,
  MAX(0, c.amount_cents - f.paid_cents) AS unpaid_cents,
  c.opening_delivered_cents AS opening_delivered_cents,
  d.delivered_cents AS delivered_cents,
  d.last_delivery_date AS last_delivery_date,
  CASE
    WHEN c.amount_cents > 0 THEN ROUND(MIN(100.0, MAX(0.0, f.paid_cents * 100.0 / c.amount_cents)), 2)
    ELSE NULL
  END AS funding_percent,
  CASE
    WHEN c.amount_cents > 0 THEN ROUND(MIN(100.0, MAX(0.0, d.delivered_cents * 100.0 / c.amount_cents)), 2)
    ELSE NULL
  END AS delivery_percent,
  f.paid_cents - d.delivered_cents AS execution_gap_cents,
  CASE
    WHEN c.amount_cents <= 0 OR (f.paid_cents = 0 AND d.delivered_cents = 0) THEN 'none'
    WHEN f.paid_cents = d.delivered_cents THEN 'balanced'
    WHEN f.paid_cents > d.delivered_cents THEN 'prepaid'
    ELSE 'receivable'
  END AS gap_state,
  c.owner_id AS owner_id,
  c.owner_name AS owner_name,
  c.note AS note,
  c.sign_date AS sign_date,
  c.start_date AS start_date,
  c.due_date AS due_date,
  c.status_changed_at AS status_changed_at,
  c.created_at AS created_at,
  c.updated_at AS updated_at,
  c.attachments_json AS attachments_json
FROM contracts c
LEFT JOIN dict_items ti ON ti.id = c.type_item_id
LEFT JOIN dict_items si ON si.id = c.status_item_id
LEFT JOIN v_contract_finance f ON f.contract_id = c.id
LEFT JOIN v_contract_delivery d ON d.contract_id = c.id;

-- ------------------------------------------------------------------ 触发器 ----
-- 金额守卫：触发器只做金额不变量，不写审计（拿不到操作者）。
-- 失败统一 RAISE(ABORT, '<CODE>')，由应用层映射为稳定错误码。

-- 新增流水：开账余额 + 既有流水 + 本次金额不得超过合同金额。
CREATE TRIGGER trg_payment_insert_budget
BEFORE INSERT ON payments
BEGIN
  SELECT CASE
    WHEN (
      (SELECT amount_cents FROM contracts WHERE id = NEW.contract_id)
      < (SELECT opening_paid_cents FROM contracts WHERE id = NEW.contract_id)
        + (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE contract_id = NEW.contract_id)
        + NEW.amount_cents
    ) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT')
  END;
END;

-- 修改流水：排除自身后重新校验（含开账余额）。
CREATE TRIGGER trg_payment_update_budget
BEFORE UPDATE ON payments
BEGIN
  SELECT CASE
    WHEN (
      (SELECT amount_cents FROM contracts WHERE id = NEW.contract_id)
      < (SELECT opening_paid_cents FROM contracts WHERE id = NEW.contract_id)
        + (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE contract_id = NEW.contract_id AND id <> NEW.id)
        + NEW.amount_cents
    ) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_CONTRACT_AMOUNT')
  END;
END;

-- 新增交付：非 rejected 才计入，含开账余额。
CREATE TRIGGER trg_delivery_insert_budget
BEFORE INSERT ON deliveries
WHEN NEW.status <> 'rejected'
BEGIN
  SELECT CASE
    WHEN (
      (SELECT amount_cents FROM contracts WHERE id = NEW.contract_id)
      < (SELECT opening_delivered_cents FROM contracts WHERE id = NEW.contract_id)
        + (SELECT COALESCE(SUM(amount_cents), 0) FROM deliveries WHERE contract_id = NEW.contract_id AND status <> 'rejected')
        + NEW.amount_cents
    ) THEN RAISE(ABORT, 'DELIVERY_EXCEEDS_CONTRACT_AMOUNT')
  END;
END;

-- 修改交付：排除自身后重新校验；改为 rejected 时不再受金额上限约束。
CREATE TRIGGER trg_delivery_update_budget
BEFORE UPDATE ON deliveries
WHEN NEW.status <> 'rejected'
BEGIN
  SELECT CASE
    WHEN (
      (SELECT amount_cents FROM contracts WHERE id = NEW.contract_id)
      < (SELECT opening_delivered_cents FROM contracts WHERE id = NEW.contract_id)
        + (SELECT COALESCE(SUM(amount_cents), 0) FROM deliveries WHERE contract_id = NEW.contract_id AND id <> NEW.id AND status <> 'rejected')
        + NEW.amount_cents
    ) THEN RAISE(ABORT, 'DELIVERY_EXCEEDS_CONTRACT_AMOUNT')
  END;
END;

-- 合同降额：合同金额不得低于已付（开账 + 流水）或已交付（开账 + 非 rejected 明细）。
CREATE TRIGGER trg_contract_amount_guard
BEFORE UPDATE OF amount_cents ON contracts
BEGIN
  SELECT CASE
    WHEN NEW.amount_cents < (
      NEW.opening_paid_cents
      + (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE contract_id = NEW.id)
    ) THEN RAISE(ABORT, 'AMOUNT_BELOW_PAID')
  END;
  SELECT CASE
    WHEN NEW.amount_cents < (
      NEW.opening_delivered_cents
      + (SELECT COALESCE(SUM(amount_cents), 0) FROM deliveries WHERE contract_id = NEW.id AND status <> 'rejected')
    ) THEN RAISE(ABORT, 'AMOUNT_BELOW_DELIVERED')
  END;
END;

-- 合同删除由 payments/deliveries/contract_status_logs 的 ON DELETE CASCADE 处理。

-- ------------------------------------------------------------------ 索引 ----
CREATE INDEX idx_contracts_direction_status ON contracts(direction, status_item_id);
CREATE INDEX idx_contracts_owner ON contracts(owner_id);
CREATE INDEX idx_payments_contract_date ON payments(contract_id, date);
CREATE INDEX idx_deliveries_contract_date ON deliveries(contract_id, date);
CREATE INDEX idx_status_logs_contract_changed ON contract_status_logs(contract_id, changed_at);
CREATE INDEX idx_audit_log_at ON audit_log(at);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

-- ------------------------------------------------------------------ 种子 ----
-- 全局数据集版本从 0 开始（DECISIONS：每次成功写入 +1）。
INSERT INTO meta (key, value) VALUES ('version', '0');
