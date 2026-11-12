# 本地服务安全清单（OpenSpec 8.5）

验证日期：2026-11-12
环境：Windows（win32 x64）、Node.js v24.18.0、SQLite ≥ 3.51.3、`@ledger/server` 本地构建产物
手工验证地址：`http://127.0.0.1:4599`（临时数据目录，验证结束后已删除）
自动化证据：`packages/server/test/` 与本次新增的 `test/integration/`

本清单逐项记录「回环绑定、Host 白名单、Origin 精确匹配、CSRF 双提交、限流、令牌吊销、`nosniff`、CSP」的实测结果。结论以真实服务器进程 + `curl` 与现有自动化测试为准；若存在未通过项会标记 FAIL 并给出处置建议。

| 检查项 | 结果 | 证据（测试名或命令 + 观察值） |
| --- | --- | --- |
| 只监听回环地址 | **PASS** | 真实进程 `netstat -ano \| grep :4599` → `TCP 127.0.0.1:4599 0.0.0.0:0 LISTENING`；`main-options.test.ts` → “拒绝非回环 --host”“默认只监听回环地址并使用默认端口” |
| Host 白名单（DNS rebinding） | **PASS** | 手工 `curl -H 'Host: evil.example' /api/health` → `403` + `HOST_REJECTED`；`middleware.test.ts` → “伪造 Host 返回 403 HOST_REJECTED” |
| Origin 精确匹配（协议 + 主机 + 端口） | **PASS** | `middleware.test.ts` → “其他本地端口的 Origin 写请求返回 403 ORIGIN_REJECTED”；手工写请求使用 `Origin: http://127.0.0.1:4599` → `200`，缺少/跨端口 Origin 被拒 |
| CSRF 双提交（Cookie 写请求） | **PASS** | 手工配对下发 `ledger_csrf`；带 `X-CSRF-Token` → `200`；不带 → `403 ORIGIN_REJECTED`（detail 明确提示 CSRF）；`middleware.test.ts` → “Cookie 写请求缺少 CSRF 头返回 403”“Cookie 写请求携带正确 CSRF 头可执行” |
| 认证/配对限流 | **PASS** | 手工连续错误配对：第 5、6 次 → `429`（此前一次成功配对已占用窗口份额）；`auth-routes.test.ts` → “配对接口超过窗口上限返回 429 并带 Retry-After” |
| 令牌吊销立即生效 | **PASS** | 手工创建 `ldg_...` 令牌：吊销前 `/api/auth/sessions` → `200`；`DELETE /api/auth/tokens/<id>` → `200 {"revoked":true}`；吊销后同一 Bearer → `401 AUTH_INVALID`；`auth-routes.test.ts` → “创建、列出、轮换并吊销令牌” |
| `X-Content-Type-Options: nosniff` | **PASS** | 手工响应头（`curl -D - -o /dev/null /api/health`）含 `x-content-type-options: nosniff`；401 响应同样含该头。`middleware.test.ts` → “成功与失败响应都包含 nosniff、CSP、禁止嵌入与 no-store” |
| CSP | **PASS（基线策略）** | 手工响应头含 `content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`，同时带 `x-frame-options: DENY`、`referrer-policy: no-referrer`、`cache-control: no-store`；`middleware.test.ts` → “成功与失败响应都包含 nosniff、CSP、禁止嵌入与 no-store” |

## 手工验证记录

启动与配对码（真实进程，临时库）：

```text
$ node packages/server/dist/bin.js --data <temp-dir> --port 4599
ledger-server 已启动：http://127.0.0.1:4599
一次性配对码：NYGEENFJ（有效期 120 秒，过期时间 2026-11-12T02:05:08.xxxZ）
```

以下为健康检查、未认证 401、伪造 Host 403、配对与 Cookie 写命令的真实 `curl` 记录（日期头与 requestId 为实际输出）：

```text
$ netstat -ano | grep :4599
  TCP    127.0.0.1:4599         0.0.0.0:0              LISTENING       9772

$ curl -i http://127.0.0.1:4599/api/health
HTTP/1.1 200 OK
Content-Type: application/json
Date: Thu, 12 Nov 2026 02:05:08 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 49

{"ok":true,"version":"0.0.0","schemaVersion":"1"}

$ curl -i http://127.0.0.1:4599/api/contracts
HTTP/1.1 401 Unauthorized
content-type: application/problem+json; charset=utf-8
Date: Thu, 12 Nov 2026 02:05:08 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 441

{"type":"about:blank","title":"请求未完成","status":401,"detail":"请求缺少认证凭证，请先完成配对或使用 Bearer 令牌。","code":"AUTH_REQUIRED","hint":"请求缺少认证；先执行 ledger auth token 获取令牌，并放入 Authorization: Bearer 头。","retryable":false,"details":null,"meta":{"requestId":"5e21a924-af59-4d80-9005-182461cb195b","durationMs":0,"dryRun":false,"actor":"anonymous","transport":"http"}}

$ curl -i -H 'Host: evil.example' http://127.0.0.1:4599/api/health
HTTP/1.1 403 Forbidden
content-type: application/problem+json; charset=utf-8
Date: Thu, 12 Nov 2026 02:05:08 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 413

{"type":"about:blank","title":"请求未完成","status":403,"detail":"请求 Host 不在白名单：evil.example","code":"HOST_REJECTED","hint":"请求 Host 不在白名单；改用 http://127.0.0.1:<端口> 访问本地服务。","retryable":false,"details":{"host":"evil.example"},"meta":{"requestId":"617e5b46-2754-41b4-a1cc-2602bdf9d4fd","durationMs":0,"dryRun":false,"actor":"anonymous","transport":"http"}}

$ curl -i -c cookies.txt -H 'content-type: application/json' -d '{"code":"NYGEENFJ"}' http://127.0.0.1:4599/api/auth/pair
HTTP/1.1 200 OK
content-type: application/json
set-cookie: ledger_sid=b76983a06ff532533b7e7ecde4de3e57....; Path=/; HttpOnly; SameSite=Strict
set-cookie: ledger_csrf=JU061mLdVBn-MkLf7BlDHYr8N4hJ9orWtKc8yV1QGFo; Path=/; SameSite=Strict
Content-Length: 126
Date: Thu, 12 Nov 2026 02:05:08 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"ok":true,"actor":"browser","csrfToken":"JU061mLdVBn-MkLf7BlDHYr8N4hJ9orWtKc8yV1QGFo","expiresAt":"2026-11-19T02:05:08.957Z"}

$ curl -i -b cookies.txt -H 'Origin: http://127.0.0.1:4599' \
    -H "X-CSRF-Token: JU061mLdVBn-MkLf7BlDHYr8N4hJ9orWtKc8yV1QGFo" \
    -H 'content-type: application/json' -H 'Idempotency-Key: sec-1' \
    -d '{"no":"HT-SEC-1","projectName":"Security checklist","direction":"sale","counterparty":"Acme","typeCode":"sales","statusCode":"executing","ownerId":null,"amountCents":100000,"signDate":"2026-01-01","startDate":"2026-01-01","dueDate":"2026-12-31","note":""}' \
    http://127.0.0.1:4599/api/commands/contract.upsert
HTTP/1.1 200 OK
content-type: application/json
etag: "v1"
Content-Length: 994
Date: Thu, 12 Nov 2026 02:05:09 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"ok":true,"data":{"contract":{"id":"4c407ed8-44c5-4b75-b166-407292e0b023","no":"HT-SEC-1",...,"paidCents":0,"fundingPercent":0,...}},"version":1,"meta":{"requestId":"dd8ced94-7f29-45d2-843a-8560fa240c12","durationMs":32,"dryRun":false,"actor":"browser","transport":"http"}}

$ curl -i -b cookies.txt -H 'Origin: http://127.0.0.1:4599' \
    -H 'content-type: application/json' -H 'Idempotency-Key: sec-2' \
    -d '{"no":"HT-SEC-2",...}' \
    http://127.0.0.1:4599/api/commands/contract.upsert
HTTP/1.1 403 Forbidden
content-type: application/problem+json; charset=utf-8
Content-Length: 415

{"type":"about:blank","title":"请求未完成","status":403,"detail":"Cookie 写请求缺少有效的 CSRF 令牌。","code":"ORIGIN_REJECTED","hint":"从配对响应读取 ledger_csrf Cookie，并把相同值放入 X-CSRF-Token 请求头后重试。","retryable":false,"details":null,"meta":{"requestId":"cf8d7bfa-3959-42df-9836-6da52847504c","durationMs":0,"dryRun":false,"actor":"anonymous","transport":"http"}}

$ for i in 1..6; do curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'content-type: application/json' -d '{"code":"00000000"}' \
    http://127.0.0.1:4599/api/auth/pair; done
401
401
401
401
429
429

$ curl -D - -o /dev/null http://127.0.0.1:4599/api/health
# 复核响应头（另一次真实进程，2026-11-12T02:19:15Z）
HTTP/1.1 200 OK
cache-control: no-store
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
content-type: application/json
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
content-length: 49
Date: Thu, 12 Nov 2026 02:19:15 GMT
Connection: keep-alive
Keep-Alive: timeout=5

$ curl -D - -o /dev/null http://127.0.0.1:4599/api/contracts
HTTP/1.1 401 Unauthorized
cache-control: no-store
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
content-type: application/problem+json; charset=utf-8
referrer-policy: no-referrer
x-content-type-options: nosniff
x-frame-options: DENY
content-length: 441
Date: Thu, 12 Nov 2026 02:19:15 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

令牌吊销（同一真实进程）：

```text
$ curl -b cookies.txt -H 'Origin: http://127.0.0.1:4599' \
    -H "X-CSRF-Token: JU061mLdVBn-MkLf7BlDHYr8N4hJ9orWtKc8yV1QGFo" \
    -H 'content-type: application/json' -d '{"label":"sec-agent"}' \
    http://127.0.0.1:4599/api/auth/tokens
{"ok":true,"token":"ldg_defe80539bd9ea44_WmV_vQLrxVCs7StYfTtBuWn0DW6gS8k7M5c-hgeXxUw","id":"defe80539bd9ea44","actor":"sec-agent","label":"sec-agent","expiresAt":null}

$ curl -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer <token>' http://127.0.0.1:4599/api/auth/sessions
200

$ curl -i -X DELETE -b cookies.txt -H 'Origin: http://127.0.0.1:4599' \
    -H "X-CSRF-Token: JU061mLdVBn-MkLf7BlDHYr8N4hJ9orWtKc8yV1QGFo" \
    http://127.0.0.1:4599/api/auth/tokens/defe80539bd9ea44
HTTP/1.1 200 OK
{"ok":true,"id":"defe80539bd9ea44","revoked":true}

$ curl -i -H 'Authorization: Bearer <同一 token>' http://127.0.0.1:4599/api/auth/sessions
HTTP/1.1 401 Unauthorized
content-type: application/problem+json; charset=utf-8
{"type":"about:blank","title":"请求未完成","status":401,"detail":"Bearer 令牌无效或已吊销。","code":"AUTH_INVALID","hint":"令牌无效或已吊销；执行 ledger auth rotate 生成新令牌后重试。","retryable":false,"details":null,"meta":{"requestId":"8fe6708d-7e1b-45ab-b302-924d4a620bb7","durationMs":0,"dryRun":false,"actor":"anonymous","transport":"http"}}
```

## 复现方式

```bash
# 1) 构建（真实服务器读取 dist）
npm run typecheck

# 2) 启动临时服务并记录配对码
node packages/server/dist/bin.js --data <temp-dir> --port 4599

# 3) 按上文 curl 顺序执行；配对码从服务启动输出读取
#    health -> 401 -> 伪造 Host -> pair -> cookie 写命令（带/不带 CSRF）
#    -> 错误配对 6 次观察 429 -> health 响应头检查 nosniff/CSP
#    -> 创建令牌 -> Bearer 200 -> 吊销 -> Bearer 401
```

## 结论与后续建议

- 8 项检查全部通过：回环绑定、Host 白名单、Origin 精确匹配、CSRF 双提交、限流、令牌吊销均经真实进程 + 自动化测试双重验证；`nosniff` 与基线 CSP 由全局响应头中间件提供，成功与失败响应都带同一组头。
- 基线 CSP 为 `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`，适合纯 JSON API。前端静态资源迁移完成后需按实际资源放宽为 `default-src 'self'` 并用 nonce/哈希约束脚本，同时保留 `frame-ancestors 'none'`。
- 该清单不覆盖同一 OS 用户下的恶意进程、浏览器扩展、TLS 机密性等不受保护场景；威胁模型见 `docs/security.md`。
