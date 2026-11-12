# 本地服务安全说明（agent-native-ledger）

本文件记录 `packages/server` 本地台账服务的威胁模型与安全边界，对应 OpenSpec 变更 `agent-native-ledger` 任务 5.9 与 `local-service-auth` 规格。每条「受保护」断言都尽量指向一个可执行测试；无法用测试证明的条目会显式标注「未自动化验证」并给出复现命令。

## 1. 资产与信任边界

### 1.1 受保护资产

| 资产 | 位置 | 敏感性 |
| --- | --- | --- |
| SQLite 主库（合同、流水、交付、人员、字典、审计、幂等、认证表） | `data/ledger.db`（WAL 模式，伴随 `ledger.db-wal`、`ledger.db-shm`） | 高：全部业务明文数据 |
| 一致性备份（`VACUUM INTO` 产物） | `data/backups/` | 高：等同主库快照 |
| 浏览器会话凭证 | 数据库表 `auth_sessions`（仅存 SHA-256 哈希）+ 浏览器 `HttpOnly` Cookie | 高：持有即等同用户身份 |
| agent 令牌凭证 | 数据库表 `auth_tokens`（仅存 SHA-256 哈希）+ 签发时一次性明文输出 | 高：持有即等同用户身份 |
| 一次性配对码 | `PairingCodeService` 进程内存（不落库、不落盘） | 高：TTL 120 秒内可换取会话 |
| 审计日志 | 数据库表 `audit_log`（只追加） | 中：操作追溯依据 |

### 1.2 信任边界

```text
        同一操作系统用户（单一信任域，非攻击者模型）
  ┌───────────────────────────────────────────────────────┐
  │  浏览器（配对后的 HttpOnly 会话）   CLI / agent（Bearer 令牌）  │
  └───────────────┬───────────────────────────┬──────────┘
                  │ 仅回环 127.0.0.1 / ::1        │
  ┌───────────────▼───────────────────────────▼──────────┐
  │  packages/server（Hono，绑定回环，Host/Origin/CSRF/限流）  │
  └───────────────┬──────────────────────────────────────┘
                  │ 参数化 SQL（better-sqlite3 + Kysely）
        ┌─────────▼─────────┐
        │  data/ledger.db   │  ← 同 OS 用户进程可直接读取（不在防护范围）
        └───────────────────┘
```

信任边界的要点：

- 服务只监听回环地址（`127.0.0.1`，可配 `::1` / `localhost`），局域网与外部网卡无法访问。
- 「认证」与「授权」分离：服务只做认证，不做角色与资源级授权；任意已认证主体（浏览器会话或 agent 令牌）拥有完全相同的操作能力，差异只体现在审计 `actor`。
- 单一操作系统用户是隐含的可信域。同一用户下的其他进程被视为与台账服务同权限，不构成需要防御的攻击者（见第 3 节）。

### 1.3 部署前提

- 运行环境满足 `scripts/check-runtime.mjs` 的最低要求：Node.js ≥ 24.0.0（Node 24.x），SQLite ≥ 3.51.3（规避 3.7.0 至 3.51.2 的 WAL checkpoint 并发损坏缺陷）。
- 所有写操作只通过命令端点（`POST /api/commands/:name`）执行；读端点与导出端点不修改业务数据。
- 只读模式由 `AppOptions.readonly` 控制，可用导出的 `setReadonly(options, true)` 运行期切换；命令返回 `READONLY` 时服务也会自动进入只读。

## 2. 威胁模型

| # | 威胁 | 缓解措施（实现位置） | 证据 |
| --- | --- | --- | --- |
| T1 | CSRF：Cookie 是环境凭证，跨站页面可诱导浏览器携带会话发起写请求；且 Cookie 不按端口隔离（RFC 6265 §8.5），仅靠 `SameSite` 不足以区分同机不同端口的本地页面 | 双重防线：（a）写请求精确 Origin 校验（协议+主机+端口，`guards.ts` `originGuard`）；（b）双提交 CSRF：配对响应写可读 Cookie `ledger_csrf`，写请求必须带相同值的 `X-CSRF-Token` 头，定长时间比较（`guards.ts` `csrfGuard` + `util.ts` `constantTimeEqual`）。会话 Cookie `ledger_sid` 为 `HttpOnly; SameSite=Strict`（`routes/auth.ts`） | 受保护：`middleware.test.ts`「Cookie 写请求缺少 CSRF 头返回 403」「Cookie 写请求携带正确 CSRF 头可执行」「其他本地端口的 Origin 写请求返回 403 ORIGIN_REJECTED」 |
| T2 | DNS rebinding / 伪造 Host：把恶意域名解析到 127.0.0.1，绕过同源限制读取本地服务 | 仅绑定回环 + Host 白名单（`127.0.0.1:port`、`localhost:port`、`[::1]:port`，`guards.ts` `hostGuard` 置于中间件链最前）；不信任任何 `X-Forwarded-*`，限流键取 socket 对端地址（`util.ts` `clientKey`） | 受保护：`middleware.test.ts`「伪造 Host 返回 403 HOST_REJECTED」；回环绑定：`main-options.test.ts`「拒绝非回环 --host」 |
| T3 | agent 令牌泄漏 | 库中只存 SHA-256 哈希（`auth_tokens.secret_hash`），明文 `ldg_<tokenId>_<secret>` 仅在签发时返回一次；比较走 `timingSafeEqual`（`safeEqualHex`）；支持轮换（旧令牌立即吊销）与吊销（立即 401，不依赖缓存过期） | 受保护：`auth/tokens.test.ts`「签发的令牌格式为 ldg_<16 hex>_<secret>，库中只存哈希」「已吊销令牌返回 AUTH_INVALID；重复吊销返回 false」「过期令牌返回 AUTH_INVALID」；`auth-routes.test.ts`「创建、列出、轮换并吊销令牌」（轮换后旧令牌 401、新令牌 200） |
| T4 | 浏览器会话泄漏 | 会话 secret 只在配对响应 Cookie 中出现一次，库中存哈希；吊销/登出立即生效；`revoke-all` 批量吊销当前主体全部会话 | 受保护：`auth/tokens.test.ts`「创建会话返回一次性 secret，库中只存哈希与到期时间」「吊销单个会话后立即失效」「revokeAllSessions 只吊销指定操作者的会话」；`auth-routes.test.ts`「登出后会话立即失效」「会话列表可读且 revoke-all 吊销当前主体全部会话」 |
| T5 | 配对码暴力猜测 | 8 位、32 字符无歧义字母表（去 0/O/1/I），TTL 120 秒，单次使用（成功即烧毁），错误尝试上限 5 次后 `RATE_LIMITED` 并停止继续校验；HTTP 层对 `/api/auth/pair` 另加固定窗口限流 5 次/分钟（`rate-limit.ts` `PAIR_RATE_RULE`） | 受保护：`auth/pair-code.test.ts`「连续 5 次错误后返回 RATE_LIMITED，并停止继续校验」「成功校验一次后立即烧毁，第二次返回 PAIR_CODE_INVALID」「过期后返回 PAIR_CODE_INVALID」；`auth-routes.test.ts`「已使用的配对码再次提交返回 401 PAIR_CODE_INVALID」「配对接口超过窗口上限返回 429 并带 Retry-After」 |
| T6 | 一般认证请求洪泛 | 除 `/api/health` 外全部 `/api/*` 走认证限流 30 次/分钟（`rate-limit.ts` `AUTH_RATE_RULE`，`guards.ts` `rateLimitGuard`）。限流位于认证之前（`app.ts` 中间件顺序），未认证/无效凭证请求同样计数；超限 `429 RATE_LIMITED` + `Retry-After` | 受保护：`middleware.test.ts`「未认证请求超过 30 次/分钟返回 429 RATE_LIMITED」；手工复现见第 4.1 节 |
| T7 | SQL 注入 | 所有数据库访问经 better-sqlite3 `prepare(...)` 绑定参数或 Kysely 查询构造器，无用户输入拼接进 SQL 文本；列表 `search` 走 `LIKE` 绑定参数（`views.ts`），排序字段取白名单（`read-support.ts` `SORT_FIELDS`）；`ledger query` 仅允许 `SELECT/WITH/EXPLAIN` 单语句、强制 `PRAGMA query_only = ON` 兜底、行数上限默认 200 最大 1000（`cli/src/local/query.ts`） | 受保护：`packages/cli/test/e2e-full.test.ts`「query 拒绝写语句，允许 SELECT」（INSERT 返回 `QUERY_REJECTED`，退出码 1） |
| T8 | XSS 导致会话/Cookie 被窃 | 服务对所有响应统一下发 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Cache-Control: no-store` 与严格 CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`（`app.ts` 基线安全头中间件）。前端仅经 API 取数，不在服务端拼接 HTML | 受保护：`middleware.test.ts`「成功与失败响应都包含 nosniff、CSP、禁止嵌入与 no-store」 |
| T9 | 备份泄漏模型密钥 | 导出经 `sanitizeSettingsForExport` 递归剔除 `apiKey`、`baseUrl` 与 `ai.enabled`（`storage-sqlite/src/dataset-support.ts`）；导出端点与 CLI `export` 共用该净化 | 受保护：`dataset-routes.test.ts`「导出包含全部业务集合并剔除密钥字段」；`packages/cli/test/e2e-full.test.ts`「export 输出数据集且不包含 apiKey / baseUrl」 |
| T10 | 存储不可写时谎报成功 | 只读模式拒绝写命令与导入（`403 READONLY`），读与导出保持可用；命令返回 `READONLY` 时路由层置位 `options.readonly` | 受保护：`dataset-routes.test.ts`「写命令与导入返回 403 READONLY，导出仍可用」 |
| T11 | 缺少幂等键导致重复写 | 非只读命令必须携带 `Idempotency-Key`，缺失即 `400 IDEMPOTENCY_KEY_REQUIRED`（`routes/commands.ts`）；相同键+相同指纹重放首次结果，相同键+不同内容 `IDEMPOTENCY_KEY_REUSED` | 受保护：`command-routes.test.ts`「写命令缺少 Idempotency-Key 返回 400」「相同幂等键重放不产生重复记录」 |
| T12 | 并发覆盖（丢失更新） | 乐观并发：`If-Match: "v<n>"` 映射 `expectedVersion`，与当前 `meta.version` 不一致返回 `409 STALE_WRITE` + `currentVersion` | 受保护：`command-routes.test.ts`「过期 If-Match 返回 409 STALE_WRITE 与当前版本」 |
| T13 | 越权访问（无凭证调用） | 除 `/api/health`、`/api/auth/pair` 外全部要求 Bearer 或有效会话；缺失 `AUTH_REQUIRED`，无效/吊销 `AUTH_INVALID`（`guards.ts` `credentialGuard`） | 受保护：`auth-routes.test.ts`（登出/吊销后 401）、`command-routes.test.ts`（Bearer 正常路径） |

## 3. 明确不防御（非目标）

| 场景 | 说明 |
| --- | --- |
| 同一操作系统用户下的其他进程 | 同用户进程可直接读取 `data/ledger.db`（含 `auth_tokens`/`auth_sessions` 哈希表，但哈希不可逆推明文，仍可执行任意 SQL 读取全部业务数据），也可直接调用本机回环接口。本服务不做进程隔离，不防御恶意本机进程。需要更强隔离时在操作系统层使用独立用户或容器。 |
| 多用户与租户隔离 | 单用户本地台账，没有角色、权限或租户模型；任意已认证主体拥有全部操作能力（`local-service-auth`「无授权模型」要求）。 |
| 传输机密性（TLS） | 纯 `http://` 回环通信，未启用 TLS。回环之外网络无法访问，但同机抓包不在防护范围。 |
| 浏览器扩展或已被攻陷的浏览器 | 扩展可读取页面同源数据与可读 Cookie（`ledger_csrf`），等同于已获得用户会话。 |
| 系统级恶意软件、内存抓取、物理访问 | 明文令牌与配对码出现在进程内存或启动终端输出中，无法防御具备同等权限的攻击者。 |
| 备份文件自身的保密 | 导出文件已剔除密钥，但业务数据仍为明文 JSON，由调用方自行保管。 |

## 4. 未自动化验证项与手工复现

### 4.1 一般认证限流 30 次/分钟（T6）

自动化证据：`middleware.test.ts`「未认证请求超过 30 次/分钟返回 429 RATE_LIMITED」验证前 30 次为 401、第 31 次为 429。手工复现（服务默认端口 4517，需先构建：`npm run typecheck`）：

```bash
node packages/server/dist/bin.js --data ./tmp-sec &
# 对受保护端点连发 31 次无凭证请求，观察是否出现 429
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H 'Host: 127.0.0.1:4517' \
    http://127.0.0.1:4517/api/auth/session
done
# 预期：前 30 次为 401（AUTH_REQUIRED），第 31 次起为 429（RATE_LIMITED，带 Retry-After）
```

### 4.2 CSP / nosniff（T8）

服务已对全部 API 响应下发基线安全头。核对：

```bash
node packages/server/dist/bin.js --data ./tmp-sec &
curl -s -D - -o /dev/null -H 'Host: 127.0.0.1:4517' http://127.0.0.1:4517/api/health
# 预期：x-content-type-options: nosniff、x-frame-options: DENY、
#       content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'、
#       cache-control: no-store
```

注意：当前 CSP 面向纯 JSON API（`default-src 'none'`）。若后续由同一服务托管 Vue 静态产物，需要为静态资源单独放宽至 `default-src 'self'`，不要复用这条 API CSP。

### 4.3 回环绑定（T2 的另一半）

`main-options.test.ts` 只测参数解析拒绝非回环 `--host`，未起真实 socket 验证监听面。手工核对：

```bash
node packages/server/dist/bin.js --data ./tmp-sec --host 127.0.0.1
# 另开终端：从局域网 IP 访问应连接被拒
curl -s http://<本机局域网IP>:4517/api/health   # 预期：连接失败
curl -s http://127.0.0.1:4517/api/health         # 预期：200
```

## 5. 文档与代码不一致（如实记录）

- 设计文档（`design.md` D8、`proposal.md` Impact）与旧 README 描述 `data/.secret`（主密钥 0600）与 `data/.token`（agent 令牌 0600）两个文件。当前 `packages/server/src/main.ts` 与 `packages/cli` 均不写这两个文件：令牌经 `ledger auth token create` 或 `POST /api/auth/tokens` 签发并一次性打印到 stdout，由调用方自行保管；`AppOptions.secret` 字段存在但注释明确「当前不参与 Cookie 签名」。本说明据实描述现状，不沿用 `.secret`/`.token` 文件假设。
- MCP 设计假设默认协议为 2026-07-28。实测 `@modelcontextprotocol/server@2.4.0` 协商返回 `2025-11-25`（见 `packages/mcp/docs/mcp-compat.md`）。
