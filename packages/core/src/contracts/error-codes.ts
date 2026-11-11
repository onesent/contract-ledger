/**
 * 稳定错误码目录：所有传输层共享同一份 code → HTTP 状态 / 可重试性 / 修复建议。
 * hint 必须是可执行的下一步（中文），不能只重复错误现象。
 */
export interface ErrorDefinition {
  readonly httpStatus: number
  readonly retryable: boolean
  readonly hint: string
}

export const ERROR_CATALOG = {
  VALIDATION_FAILED: {
    httpStatus: 422,
    retryable: false,
    hint: '检查 details.fields 中指出的字段，按提示修正入参后重新提交。',
  },
  NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    hint: '确认资源 id 是否正确；先执行对应的 list 或 get 命令获取有效 id。',
  },
  DUPLICATE_NO: {
    httpStatus: 409,
    retryable: false,
    hint: '合同编号已存在；改用新的编号，或先用 contract get --no <编号> 查询现有合同。',
  },
  STALE_WRITE: {
    httpStatus: 409,
    retryable: false,
    hint: '数据集已被其他写入更新；先重新读取当前数据与 version，再带新的 expected_version 重试。',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    httpStatus: 400,
    retryable: false,
    hint: '写命令必须携带幂等键；生成一个新的 UUID 作为 idempotency_key 后重试。',
  },
  IDEMPOTENCY_KEY_REUSED: {
    httpStatus: 409,
    retryable: false,
    hint: '同一幂等键已用于不同内容；换用新的幂等键，或原样重放首次请求。',
  },
  PAYMENT_EXCEEDS_CONTRACT_AMOUNT: {
    httpStatus: 422,
    retryable: false,
    hint: '本次付款超过合同剩余可付金额；先查询合同未付金额，减少本次金额或先上调合同金额。',
  },
  DELIVERY_EXCEEDS_CONTRACT_AMOUNT: {
    httpStatus: 422,
    retryable: false,
    hint: '本次交付超过合同剩余可交付金额；先查询合同剩余可交付金额，减少本次金额或先上调合同金额。',
  },
  AMOUNT_BELOW_PAID: {
    httpStatus: 422,
    retryable: false,
    hint: '合同金额不能低于已付金额；先查询已付金额，将合同金额调整到不低于该值。',
  },
  AMOUNT_BELOW_DELIVERED: {
    httpStatus: 422,
    retryable: false,
    hint: '合同金额不能低于已交付金额；先查询已交付金额，将合同金额调整到不低于该值。',
  },
  CONTRACT_DIRECTION_LOCKED: {
    httpStatus: 422,
    retryable: false,
    hint: '合同已有付款或交付记录，方向不可修改；删除相关记录后重试，或新建一份合同。',
  },
  OWNER_INACTIVE: {
    httpStatus: 422,
    retryable: false,
    hint: '负责人已离职；先用 personnel transfer 批量转交该负责人的合同，或将其恢复在职后重试。',
  },
  REFERENCE_IN_USE: {
    httpStatus: 409,
    retryable: false,
    hint: '该字典项或人员仍被引用；先用 list 查询引用它的合同并改绑，再执行删除。',
  },
  READONLY: {
    httpStatus: 403,
    retryable: false,
    hint: '当前为只读模式；先修复存储错误并执行 retry_write 或 recheck_storage，或导出备份后重启服务。',
  },
  AUTH_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    hint: '请求缺少认证；先执行 ledger auth token 获取令牌，并放入 Authorization: Bearer 头。',
  },
  AUTH_INVALID: {
    httpStatus: 401,
    retryable: false,
    hint: '令牌无效或已吊销；执行 ledger auth rotate 生成新令牌后重试。',
  },
  PAIR_CODE_INVALID: {
    httpStatus: 401,
    retryable: false,
    hint: '配对码无效、过期或已使用；回到服务启动终端获取新的配对码后重试。',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    retryable: true,
    hint: '请求过于频繁；等待响应中的 retry-after 秒数后，用相同幂等键重试。',
  },
  HOST_REJECTED: {
    httpStatus: 403,
    retryable: false,
    hint: '请求 Host 不在白名单；改用 http://127.0.0.1:<端口> 访问本地服务。',
  },
  ORIGIN_REJECTED: {
    httpStatus: 403,
    retryable: false,
    hint: '请求 Origin 不被信任；从服务打印的本地地址打开页面，或改用 Bearer 令牌访问。',
  },
  DB_BUSY: {
    httpStatus: 503,
    retryable: true,
    hint: '数据库正被其他写入占用；等待片刻后使用相同幂等键重试。',
  },
  QUERY_REJECTED: {
    httpStatus: 422,
    retryable: false,
    hint: '查询被只读安全策略拒绝；仅使用 SELECT / WITH / EXPLAIN，并移除写操作或 DDL。',
  },
  INTERNAL: {
    httpStatus: 500,
    retryable: false,
    hint: '服务内部错误；记录 request_id 并查看服务日志，修复后重试。',
  },
} as const satisfies Readonly<Record<string, ErrorDefinition>>

/** 由错误码目录派生，新增 code 必须同步补全目录条目。 */
export type ErrorCode = keyof typeof ERROR_CATALOG
