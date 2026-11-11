# AGENTS.md

面向 AI 编码代理的工程规范。`README.md` 面向用户；冲突时以本文件与 `package.json` 为准。

---

## 1. 项目

- 纯前端合同台账：Vue 3 + Vue Router（hash）+ Element Plus + ECharts + dayjs + Vite。
- 构建产物为单个自包含 `dist/index.html`；零后端、零外链、零网络请求。
- 数据仅存浏览器：IndexedDB → localStorage → 内存只读；JSON 备份才是存档。
- 源码分模块；依赖版本以 `package.json` 为准（README 的版本可能滞后，例如 echarts 实际为 6.1.0）。

---

## 2. 硬约束（违反即失败）

1. `dist/` 只能有 `index.html`，体积 ≤ 5 MB。
2. 运行期禁止 `fetch / XHR / WebSocket / 外链字体 / 外链图片 / CDN / 外链 favicon`。
3. 必须使用 `createWebHashHistory()`。
4. 持久化写入只经 `src/data/store.js` 的 `applyChanges()`；组件不得直接操作 `data` 或浏览器存储。
5. 派生字段（未收金额、收款进度、逾期/临期、统计等）实时计算，不落库、不可编辑。
6. 导出备份必须剔除 `apiKey`、`baseUrl`、`ai.enabled`。
7. AI 默认占位实现零网络；唯一出口是 `src/ai/provider.js`。
8. 不引入 TypeScript，不新增 `.ts/.tsx`。
9. 写入失败必须明确报错并停止写入，不得谎报成功。
10. UI 优先复用 Element Plus；禁止手写表格、分页、弹窗、Toast、确认框、日历、进度条、图表。

---

## 3. 数据流与职责

```text
views / components
  → useLedger()              inject 的 ledger，Vue 侧唯一数据出口
  → ledger.actions.*         领域操作，返回 { ok, code?, message?, ... }
  → store.applyChanges()     合并变更 → 深拷贝 → 单事务持久化 → 更新响应式 data
  → computed → UI
```

- `src/data/store.js`：存储三态、事务、容量；不感知 UI。
- `src/composables/useLedger.js`：全部领域操作与派生 computed；`App.vue` 中 provide。
- `src/utils/*.js`：纯函数（格式化、校验、派生统计），不要放组件逻辑。
- `src/views/`：页面组合；`src/components/`：业务组合组件。
- `src/ai/provider.js`：唯一 AI 出口；`src/utils/echarts.js`：唯一 ECharts 注册点。

**禁止**：组件直接 import store；直接读写 `localStorage/indexedDB`；直接修改 `data.*`；绕过 `useLedger` 自行增删改查。

数据一致性：

- 业务记录必须有 `id`、`createdAt`、`updatedAt`，`updatedAt` 由存储层刷新。
- 合同状态变更同时写 `statusChangedAt` 与 `statusLogs`（旧值/新值/时间/操作人）。
- 登记/删除收款必须同步维护合同 `receivedAmount` 与 `paymentDate`，并与流水在同一事务写入。
- 删除被引用的字典项/人员必须拦截；人员离职前需批量转交。

---

## 4. 开发规范

### 4.1 代码风格

- Vue 3 `<script setup>` + Composition API；Vue API（`ref`、`computed` 等）显式 import。
- Element Plus 组件与 `ElMessage` / `ElMessageBox` / `ElNotification` 由 resolver 自动导入；不要手动 import 组件，也不要 `app.use(ElementPlus)`。
- 图标必须从 `@element-plus/icons-vue` 显式 import；禁止图标字体、外链 SVG、emoji。
- 2 空格缩进、单引号、不写分号、多行结构尾逗号。
- 组件/视图文件 `PascalCase.vue`，变量/函数 `camelCase`，常量 `UPPER_SNAKE_CASE`。
- 导出函数、复杂逻辑、领域对象用 JSDoc；注释与用户文案用中文，标识符用英文。
- `src/` 内不使用 `console.*`；错误通过返回值、`ElMessage`/`ElNotification` 或 `status.lastError` 呈现。
- 禁止空 `catch`；确需忽略时写 `/* ignore */` 并说明原因。
- 禁止 `as any`、`@ts-ignore`、`@ts-expect-error`。
- 业务计算放 `utils/derive.js`，不要塞进模板或 `watch`。

### 4.2 数据写入

- 所有写操作返回 `{ ok, code?, message? }`；调用方必须判断 `ok` 并反馈用户。
- 多集合操作必须放进同一次 `applyChanges`，保证原子性。
- `put` 按 id 新增/更新；`remove` 按集合 + id 删除；`replace` 整库替换。
- `touch: false` 仅用于导入/替换/演示数据等不刷新 `updatedAt` 的场景。
- 写入前必须使用纯数据（`cloneDataset`），Vue 响应式 Proxy 不能被 IndexedDB 直接克隆。
- 只读模式（`status.writable === false`）下禁用所有写入口，并用 `el-tooltip` 说明“仅可浏览与导出”。
- 配额/安全错误后不要自行恢复可写状态，走 `retryWrite()` / `recheckStorage()`。

### 4.3 Schema 变更

1. 更新 `src/data/schema.js` 的集合、默认值与演示数据。
2. 递增 `SCHEMA_VERSION`，在 `migrateDataset()` 写幂等迁移（只补齐/规范化，不丢数据）。
3. 更新 `validateBackup()` 的字段校验与 `normalizeSettings()` / `normalizeMeta()` 默认值。
4. 涉及表格列时更新 `CONTRACT_COLUMNS` 与列显隐默认值。
5. 同步 README 的数据结构与版本说明。

### 4.4 校验、金额与日期

- 表单规则统一写在 `src/utils/validate.js`（`contractRules` / `paymentRules` / `personnelRules` / `dictRules`），禁止模板内手写校验 UI。
- 跨字段校验通过 `getValues()` 读取当前表单值。
- 业务日期用 `YYYY-MM-DD` 字符串，时间戳用 ISO，统一 `dayjs` 解析。
- 金额计算前用 `toNumber()` / `isFiniteNumber()`，舍入用 `roundMoney()`，展示用 `formatMoney` / `formatPercent` / `formatNumber`。
- 非法/缺失值显示 `—`，绝不出现 `NaN` / `Infinity`；合同金额为 0 时进度返回 `null`。
- 业务下拉必须实时读字典/人员档案，禁止硬编码选项数组。

### 4.5 UI 与交互

- 复用映射：表格 `el-table`、分页 `el-pagination`、表单 `el-form`、弹窗 `el-dialog`、确认 `ElMessageBox.confirm`、提示 `ElMessage`、空态 `el-empty`、加载 `v-loading`、图表 `ChartPanel.vue`。
- `src/components/` 禁止 `Base*` 基建组件。
- 删除、清空、覆盖导入、离职等危险操作必须二次确认并说明后果。
- 禁用按钮外包 `<span>` 再挂 `el-tooltip`；图标按钮提供 `aria-label`，保留 `:focus-visible`。
- 响应式断点 `1023px`；新增列表页必须提供窄屏卡片布局或无横向溢出的方案。
- 中文 locale 由 `main.js` 提供 `ep-locale`，`App.vue` 用 `<el-config-provider>` 包裹。

### 4.6 样式

- 全局样式放 `src/styles/`：`theme.css`（EP 变量 + `--ledger-*`）、`layout.css`、`pages.css`。
- 优先复用已有类名与 CSS 变量；禁止内联魔法色值。
- 组件 `scoped` 样式仅用于局部特例（当前只有 `BackupPanel.vue`）。
- 禁止外链字体/图片/图标；字体用系统字体栈，favicon 用内联 `data:image/svg+xml`。
- 布局改动需检查 375px / 800px / 桌面三档，不得横向溢出。

### 4.7 存储、备份与 AI

- 存储三态不可弱化：IndexedDB 主引擎 → localStorage 小数据兜底 → 内存只读。
- 写入错误区分 `QUOTA` / `SECURITY` / `WRITE_FAILED`，给出可操作提示。
- 导出：`snapshot()` → `sanitizeSettingsForBackup()` → `downloadText()`，全程零网络。
- 导入：`parseBackupText` → `validateBackup` → 自动下载快照 → `applyChanges({ replace })` 单事务写入。
- 密钥只能存在 `settings.ai` 本机数据中；不得写入源码、演示数据、日志或备份。
- AI 方法保持 `{ ok, configured, action, status, message, data, meta }`；默认实现 `meta.network === false`；接入真实模型只替换 `complete()`。

### 4.8 构建与依赖

- 路由视图必须静态引入；禁止动态 `import()` 造成分包。
- ECharts 只从 `src/utils/echarts.js` 引入，新图表类型在该文件注册。
- 不配置 `manualChunks`、`external` 等破坏单文件的选项。
- 新增依赖必须保证产物 ≤ 5 MB 且不引入外链资源。
- 不提交 `dist/`、`node_modules/`、`.omo/`、`.codegraph/`。

### 4.9 Git

- 未明确要求时不 commit / push / 开 PR。
- 一个提交只做一件事，建议 Conventional Commits（如 `fix(storage): 配额失败后停止写入`）。
- 提交前检查 `git status` / `git diff`，不得带密钥、备份 JSON、构建产物。

---

## 5. 常见坑

1. 直接 `structuredClone(data)` 会因 Vue Proxy 失败，写入前用 `cloneDataset()`。
2. `file://` 的存储行为未定义，不能假设一定持久化，必须保留便携横幅与导出引导。
3. localStorage 写满时必须抛错并停止录入，不能静默失败。
4. hash 路由守卫在浏览器前进/后退时 URL 可能已变，`router/index.js` 的 `replaceState` 复原逻辑不要破坏。
5. EP 组件与 `ElMessage` 自动导入，但 Vue API 不会自动导入。
6. ECharts 必须 `init → setOption → resize → dispose`，并清理 `ResizeObserver`。
7. 首页统计、提醒条数、列表筛选必须共用 `utils/derive.js` 的同一套纯函数。
8. 月度收款趋势按 `payments` 流水聚合；手改 `receivedAmount` 不产生流水。
9. 演示数据日期按载入当天相对生成，修改时保持“任何日期都成立”。

---

## 6. 验收

```bash
npm run dev       # http://localhost:5173
npm run build     # 产出 dist/index.html
npm run check     # 校验单文件自包含，必须全部通过
npm run preview   # http://localhost:8080
```

项目无 lint / test / typecheck 脚本。改动代码的最低验收：

- `npm run build && npm run check` 全部通过，产物 ≤ 5 MB。
- 编辑器诊断无新增错误（若环境提供 LSP）。
- 手工冒烟：首页、合同管理、人员档案、字典配置、系统设置均可用，控制台无报错。
- 涉及存储/备份/布局时，额外验证只读模式、`file://` 便携模式、375px 窄屏。

不要放宽 `scripts/check-singlefile.mjs` 的断言来让检查通过。
