# Spec Delta

## ADDED Requirements

### Requirement: 同源托管前端产物

服务 MUST 在自身端口上提供前端构建产物（页面与静态资源），MUST NOT 要求用户额外部署静态服务器。未匹配到静态文件的页面路径 MUST 返回前端入口页面，MUST NOT 返回 404。

#### Scenario: 根路径返回界面

- **WHEN** 浏览器访问服务根路径
- **THEN** 返回前端入口页面与静态资源，界面经 `/api/*` 加载数据

#### Scenario: 深链刷新不 404

- **WHEN** 用户在前端深层路由页面刷新浏览器
- **THEN** 仍返回前端入口页面并渲染对应视图

#### Scenario: 静态资源缺失

- **WHEN** 请求的静态资源不存在
- **THEN** 返回 404，且不返回前端入口页面冒充资源

### Requirement: 静态托管不承载业务数据

静态托管 MUST 只返回构建产物，MUST NOT 触发命令分发或返回业务数据；`/api/*` 下的未匹配路径 MUST 仍返回 JSON 错误信封而不是页面。

#### Scenario: API 未知路径

- **WHEN** 请求 `/api/` 下的未知路径
- **THEN** 返回 JSON 错误（problem+json 信封），不返回前端页面

#### Scenario: 页面路径无需业务凭证

- **WHEN** 未认证主体请求页面路径
- **THEN** 返回静态产物；任何业务数据访问仍须经 `/api/*` 认证

### Requirement: 健康端点暴露配对状态

健康端点 MUST 以布尔字段 `paired` 暴露是否存在有效浏览器会话，MUST NOT 暴露会话标识、令牌或任何业务数据。启动器据此决定是否展示一次性配对码。

#### Scenario: 未配对

- **WHEN** 库中不存在有效（未吐销且未过期）浏览器会话时请求健康端点
- **THEN** 响应中 `paired` 为 `false`

#### Scenario: 已配对

- **WHEN** 完成浏览器配对后请求健康端点
- **THEN** 响应中 `paired` 为 `true`，且响应不包含会话列表、会话 id 或任何令牌

### Requirement: 响应安全策略按路径分层

API 响应 MUST 保持最严限制（`default-src 'none'` 且禁止被框架嵌入）。页面响应 MUST 允许同源脚本、同源与内联样式、同源请求与 `data:` 图片，MUST NOT 允许任何外部来源。

#### Scenario: 两类路径的头部不同

- **WHEN** 分别请求 API 路径与页面路径
- **THEN** API 响应的限制策略不含任何来源许可，页面响应只许可同源资源且不含外部主机

#### Scenario: 页面在严格策略下可渲染

- **WHEN** 浏览器按页面响应头加载前端产物
- **THEN** 脚本、样式、字体、图标与接口请求均被允许，控制台无来源被拒错误
