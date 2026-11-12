/** 浏览器会话 Cookie 名；会话值形如 `<sessionId>.<secret>`。 */
export const SESSION_COOKIE = 'ledger_sid'

/** CSRF 双提交 Cookie 名；必须可被前端 JS 读取。 */
export const CSRF_COOKIE = 'ledger_csrf'

/** CSRF 请求头名。 */
export const CSRF_HEADER = 'X-CSRF-Token'
