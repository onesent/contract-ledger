/**
 * @ledger/core 公共入口：领域契约、schema、金额、不变量、派生查询与能力描述的唯一出口。
 * Wave 1 冻结跨包共享契约；Wave 2A 增加领域内核。
 */
export * from './contracts/index.js'
export * from './describe.js'
export * from './invariants.js'
export * from './money.js'
export * from './queries/derive.js'
export * from './schema/index.js'
