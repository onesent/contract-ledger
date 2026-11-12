# Spec Delta

## Purpose

保证只有持有凭证的本地用户与 agent 能访问台账服务，同时只做认证、不引入角色与权限模型。

## ADDED Requirements

### Requirement: 仅回环监听

服务 MUST 只绑定 `127.0.0.1`（可附加 `::1`），MUST NOT 监听 `0.0.0.0` 或对外网卡开放。

#### Scenario: 启动监听

- **WHEN** 服务启动
- **THEN** 只接受来自回环地址的连接，局域网地址无法访问

### Requirement: 首次配对

未认证的浏览器 MUST 通过终端展示的一次性配对码完成配对；配对码 MUST 具备有效期、单次使用与尝试次数上限。

#### Scenario: 输入有效配对码

- **WHEN** 用户在配对页输入终端展示且未过期的配对码
- **THEN** 配对成功并获得会话，配对码立即失效

#### Scenario: 重复使用配对码

- **WHEN** 已使用过的配对码被再次提交
- **THEN** 返回 `PAIR_CODE_INVALID` 且不签发会话

### Requirement: 浏览器会话

配对成功后 MUST 签发 `HttpOnly`、`SameSite=Strict` 的会话 Cookie；会话 MUST 可单独吊销。

#### Scenario: 会话失效后访问

- **WHEN** 会话被吊销或过期后浏览器访问页面
- **THEN** 返回 `AUTH_REQUIRED` 并引导重新配对

### Requirement: Agent 令牌

CLI 与 agent MUST 使用 bearer token 认证；令牌 MUST 以哈希形式存储，明文 MUST 只出现在权限受限的本地文件中。

#### Scenario: 使用令牌调用

- **WHEN** 请求携带有效 bearer token
- **THEN** 认证通过，审计操作者为对应令牌标签

#### Scenario: 使用已吊销令牌

- **WHEN** 请求携带已吊销令牌
- **THEN** 返回 `AUTH_INVALID` 且不执行命令

### Requirement: Origin 与 Host 校验

携带 Cookie 的写请求 MUST 校验精确 Origin（含协议、主机与端口）；所有请求 MUST 校验 Host 属于回环白名单。

#### Scenario: 其他 localhost 端口发起写请求

- **WHEN** 另一个本地端口的页面携带会话 Cookie 发起写请求
- **THEN** 因 Origin 不匹配返回 `ORIGIN_REJECTED`，命令不执行

#### Scenario: DNS 重绑定

- **WHEN** 请求的 Host 头不是回环白名单中的值
- **THEN** 返回 `HOST_REJECTED`，不进入认证与业务逻辑

### Requirement: 无授权模型

任意已认证主体 MUST 拥有完全相同的操作能力；系统 MUST NOT 实现角色、权限或资源级授权。

#### Scenario: 两类主体能力一致

- **WHEN** 浏览器会话与 agent 令牌分别执行同一命令
- **THEN** 两者都被允许，差异只体现在审计操作者

### Requirement: 令牌生命周期

系统 MUST 支持 agent 令牌轮换与会话/令牌吊销；吊销 MUST 立即生效，MUST NOT 依赖缓存过期。

#### Scenario: 轮换令牌

- **WHEN** 执行令牌轮换
- **THEN** 新令牌可用，旧令牌立即失效

### Requirement: 认证限流

认证失败 MUST 受次数与时间窗口限制，超限 MUST 返回 `RATE_LIMITED`。

#### Scenario: 暴力尝试配对码

- **WHEN** 同一来源在窗口内多次提交错误配对码
- **THEN** 达到阈值后返回 `RATE_LIMITED` 并停止校验

### Requirement: 认证身份审计

每次认证与命令请求 MUST 记录操作者身份（浏览器用户、CLI 或 agent 令牌标签）到审计日志。

#### Scenario: 追溯操作者

- **WHEN** 查询某次写入的审计记录
- **THEN** 可看到具体操作者类型与标签

### Requirement: 安全边界声明

系统文档 MUST 明确声明不防御同一操作系统用户下的本地进程，因为其可直接读取数据文件与令牌。

#### Scenario: 阅读安全说明

- **WHEN** 用户查阅认证文档
- **THEN** 能看到受保护与不受保护的威胁边界
