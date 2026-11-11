# 合同管理台账工作台

一个**纯前端、零后端、零外链**的合同管理台账应用：Vue 3 + Element Plus + ECharts + dayjs，源码按模块拆分，构建产物是**单个自包含的 `dist/index.html`**。

- 单 HTML 是**分发形态**：可以拷贝给他人、双击打开（便携模式）。
- localhost 是**推荐使用形态**：有明确 origin，IndexedDB / localStorage 行为确定，刷新和重启浏览器后数据保留。
- **导出 JSON 才是真正的存档**；浏览器内数据只当本机缓存，应用不上传任何服务器。

---

## 1. 项目简介与方案说明

### 1.1 方案 B：源码分模块 + 构建单文件

- 源码：按 `views / components / composables / data / utils / ai / styles` 分目录维护，便于阅读与后续替换存储层 / AI 实现。
- 构建：Vite + `vite-plugin-singlefile`，把 JS、CSS、Element Plus 按需样式、ECharts、内联图标全部打进 `dist/index.html`，`dist/` 下**只有**这一个文件。
- 运行期：不发起任何 `fetch / XHR / WebSocket / 字体 / 图片 / CDN` 请求；断网可完整使用。
- 路由：`createWebHashHistory()`（`#/home`、`#/contracts/sale`、`#/contracts/purchase`、`#/personnel`、`#/dicts`、`#/settings`；旧链接 `#/contracts` 重定向到销售入口并透传 `query`，书签不失效），`file://` 下刷新、前进后退不白屏。

### 1.2 关键能力一览

- 合同分**销售 / 采购两个方向**（`direction` 字段是唯一方向真相）：方向决定对方称谓（客户 / 供应商）、金额标签（已收 / 未收 / 收款进度 对 已付 / 未付 / 付款进度）、统计口径与提醒语义；两个入口共用同一集合与视图，按方向过滤，新建合同自动继承入口方向。
- 两条独立执行轴：**资金执行流水**（收款 / 付款）与**交付执行明细**（纯金额计量，数量与单位仅作描述）；资金进度与交付进度实时派生、不可手改，并派生错位差额（预收 / 预付 / 已交付未收款 / 已到货未付款）；合同金额为 0 时两条进度均显示「—」而不是 NaN。
- 资金流水登记自动累加已收/已付金额，交付明细登记自动累加已交付金额；状态变化自动写状态变更时间与变更日志（el-timeline 可查）。
- 字典（类型 / 状态 / 付款方式 / 部门 + 自定义分类）、人员档案、引用保护、批量转交。
- 首页按方向切换视图：12 张统计卡、3 个 ECharts 图表、9 组提醒清单全部基于选中方向重算，销售与采购金额**永不相加**；点击可带着筛选条件跳到对应方向的列表。
- 备份导出 / 快照 / 导入（覆盖或按 id 合并）/ 非法备份校验 / 清空 / 恢复演示数据，导入使用事务，失败整体回滚。
- 存储引擎三态：IndexedDB → localStorage（降级）→ 内存只读；容量与集合记录数常驻页脚与设置页。
- AI 能力只保留接口与入口，默认零网络请求；备份强制剔除 API Key / Base URL。

### 1.3 实现说明（数据一致性）

- 合同「已收 / 已付金额」以合同字段为准；登记资金流水会追加一条流水并同步累加，界面文案按方向取义（销售为收款、采购为付款）。
- 删除一条资金流水会同步回退合同已收/已付金额，并把「收款 / 付款日期」更新为剩余流水中的最近日期。
- 合同「已交付金额」与「最后交付日期」**只由交付明细的登记 / 删除维护**，与明细在同一次事务内写入；表单中只读。删除交付明细后按剩余明细重算汇总（验收驳回的记录不计入），最后日期取剩余记录中的最大值。
- 合同已有资金流水或交付明细时**方向锁定不可修改**（保存被领域层拒绝并说明原因）；合同金额不能改到低于已收/已付或已交付金额；累计交付金额不能超过合同金额（超出时提示剩余可交付金额）。
- 删除合同会在同一次事务中级联删除其关联的资金流水与交付明细，不留孤立记录。
- 月度收款趋势图严格按**资金流水**聚合；手工直接把「已收金额」改大、却没有登记流水时，总额统计会变化，但趋势图不会凭空产生流水。建议始终用「登记收款 / 付款」维护流水。
- 所有写入都经 `src/data/store.js`；写入前会做结构化深拷贝（Vue 响应式 Proxy 不能被 IndexedDB 直接克隆），成功后一次性更新内存缓存并刷新 UI。

---

## 2. 三种运行方式

### ① 开发方式

```bash
npm install
npm run dev
# → http://localhost:5173
```

### ② 推荐正式方式（同一份单文件产物，存储最稳）

```bash
npm run build
cd dist
python -m http.server 8080
# → http://localhost:8080
```

或使用 Vite 预览（同样有明确 origin，端口 8080）：

```bash
npm run build
npm run preview
# → http://localhost:8080
```

> 日常记账默认用这一方式：IndexedDB / localStorage 行为确定，刷新、重启浏览器后数据保留。

### ③ 便携方式（便携模式）

```bash
npm run build
# 直接双击 dist/index.html（file://）
```

启动后应用会做存储能力探测，并显示醒目 `el-alert` 横幅：

> 当前为便携模式（file://）。浏览器对本地文件的存储行为未定义，数据与本文件路径绑定；移动、重命名或换浏览器打开都可能导致数据看似丢失。请定期导出备份，正式使用建议用 localhost 方式打开。

便携模式下若 IndexedDB 不可用，会按第四节降级到 localStorage；再不可用则进入内存只读模式。**任何写入失败都会明确提示，不会谎报保存成功。**

### 2.1 三种方式对比

| 方式 | 是否需安装 | 是否需服务 | 存储可靠性 | 适用场景 |
|---|---|---|---|---|
| ① `npm run dev` | 需 Node + `npm install` | 需 Vite 开发服务 | 高（localhost:5173 有明确 origin，IndexedDB 可用） | 开发、调试 |
| ② `dist + http.server` / `npm run preview` | 构建时需 Node，使用时无需安装 | 需一个静态文件服务 | **最高（推荐）**：明确 origin，IndexedDB 事务写入，刷新/重启保留 | 日常记账、正式使用 |
| ③ 双击 `dist/index.html` | 否 | 否 | 浏览器定义，可能降级为 localStorage / 只读；数据与路径绑定 | 便携演示、临时查看、拷贝给他人 |

### 2.2 首屏与加载行为

- 单文件产物由本地静态服务或 `file://` 直接加载，不依赖外链资源，断网时体验一致。
- 首页统计卡与 ECharts 图表在数据就绪后同步渲染，不会出现白屏。
- 首次启动载入演示数据会写入 18 条合同、17 条资金流水与 6 条交付明细。

---

## 3. 依赖清单与实际版本

### 3.1 `dependencies`（仅 6 个）

```text
vue 3.5.45
vue-router 4.6.4
element-plus 2.14.8
@element-plus/icons-vue 2.3.2
echarts 5.6.0
dayjs 1.11.23
```

### 3.2 `devDependencies`（仅 5 个）

```text
vite 7.3.8
@vitejs/plugin-vue 6.0.10
vite-plugin-singlefile 2.3.4
unplugin-auto-import 21.1.0
unplugin-vue-components 32.1.0
```

### 3.3 `npm ls --depth=0` 摘要

```text
contract-ledger-workbench@1.0.0
├── @element-plus/icons-vue@2.3.2
├── @vitejs/plugin-vue@6.0.10
├── dayjs@1.11.23
├── echarts@5.6.0
├── element-plus@2.14.8
├── unplugin-auto-import@21.1.0
├── unplugin-vue-components@32.1.0
├── vite-plugin-singlefile@2.3.4
├── vite@7.3.8
├── vue-router@4.6.4
└── vue@3.5.45
```

本机环境：Node v24.9.0，npm 11.6.0。

### 3.4 按需引入配置

`vite.config.js` 关键点：

```js
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { viteSingleFile } from 'vite-plugin-singlefile'

base: './',
plugins: [
  vue(),
  AutoImport({ resolvers: [ElementPlusResolver()] }),
  Components({ resolvers: [ElementPlusResolver()] }),
  viteSingleFile({ removeViteModuleLoader: true, useRecommendedBuildConfig: true }),
],
build: { cssCodeSplit: false, assetsInlineLimit: 100000000 }
```

- 未使用 `app.use(ElementPlus)`，未全量引入 Element Plus 与全局 CSS。
- `ElementPlusResolver` 使用默认 `importStyle`（css），**未配置 `importStyle: 'sass'`**。
- `ElMessage` / `ElMessageBox` / `ElNotification` 等命令式 API 由 AutoImport + Resolver 自动注入 JS 与样式。
- ECharts 只从 `src/utils/echarts.js` 引入，集中按需注册 `BarChart / LineChart / PieChart / Grid / Tooltip / Legend / Title / Dataset / SVGRenderer`，未使用 `import * as echarts from 'echarts'`。
- 字体使用系统字体栈（含 `WenQuanYi Micro Hei`、`Microsoft YaHei` 等中文兜底），无外链字体。
- 图标只从 `@element-plus/icons-vue` 显式 import 具体组件，渲染为内联 SVG；无图标字体、无外链 svg。
- favicon 为内联 `data:image/svg+xml`，避免额外请求。

---

## 4. 目录结构与职责

```text
.
├── index.html                       Vite 入口模板（仅挂载点 + 内联 favicon）
├── vite.config.js                   单文件构建、按需导入、base './'
├── package.json                     scripts / 精确依赖
├── scripts/
│   └── check-singlefile.mjs         构建产物自包含校验（npm run check）
├── src/
│   ├── main.js                      挂载、zh-cn locale、全局 errorHandler、存储初始化、能力探测
│   ├── App.vue                      el-container 布局壳、el-menu hash 导航、便携/降级/只读横幅、页脚存储状态
│   ├── router/
│   │   └── index.js                 hash 路由（销售/采购两入口 + /contracts 重定向透传 query）、静态引入视图、未保存离开守卫
│   ├── data/
│   │   ├── schema.js                集合定义、schemaVersion、方向与交付常量、按方向生成列定义、幂等迁移、18 条演示数据
│   │   ├── store.js                 唯一存储入口（IndexedDB / localStorage / 内存只读、事务、迁移、容量）
│   │   └── backup.js                导出、快照、校验、覆盖/合并导入、密钥剔除、下载
│   ├── composables/
│   │   ├── useLedger.js             Vue 侧唯一数据出口（provide/inject）、领域操作、派生 computed
│   │   └── useMediaQuery.js         响应式断点（窄屏卡片布局）
│   ├── views/
│   │   ├── HomeView.vue             统计卡、ECharts、提醒清单、快捷入口、备份到期提示
│   │   ├── ContractsView.vue        方向化列表（销售/采购共用，按 route.meta.direction 过滤）、筛选、排序、分页、列显隐、批量操作、表单/详情/收款/登记交付
│   │   ├── PersonnelView.vue        人员 CRUD、在职开关、引用保护、批量转交
│   │   ├── DictsView.vue            字典分类 tab、字典项 CRUD、颜色/启用、引用保护
│   │   └── SettingsView.vue         常规设置、存储状态、备份面板、AI 配置、操作日志
│   ├── components/                  仅业务组合组件（无 Base* 基建组件）
│   │   ├── ContractTable.vue        el-table 列模板薄封装，emit 业务事件
│   │   ├── ContractForm.vue         el-dialog + el-form（合同字段 + 附件元信息 + AI 入口 + 未保存守卫；对方与金额标签随方向切换，方向控件仅无执行记录时可改）
│   │   ├── ContractDetail.vue       el-drawer + el-descriptions + 资金/交付双进度条与错位差额 + el-timeline（资金流水/交付明细/状态日志）
│   │   ├── ReminderList.vue         el-card + el-badge + el-tag 提醒清单
│   │   ├── ChartPanel.vue           ECharts 生命周期（init / resize / dispose）薄封装
│   │   ├── BackupPanel.vue          导出/快照/导入/清空/恢复演示数据的业务组合
│   │   ├── StorageStatus.vue        存储引擎 / 容量 / 集合记录数展示
│   │   └── AiPlaceholder.vue        AI 未配置入口（禁用 + tooltip + 前往配置）
│   ├── utils/
│   │   ├── format.js                金额 ¥+千分位+2 位小数、日期、时间戳、文件大小、进度百分比
│   │   ├── validate.js              el-form 规则工厂 + 备份结构/字段校验
│   │   ├── derive.js                未收/资金进度/交付进度/错位差额/状态判定/按方向统计/提醒/趋势（纯函数）
│   │   ├── id.js                    UUID（crypto.randomUUID + 降级）
│   │   └── echarts.js               全项目唯一 ECharts 注册点
│   ├── ai/
│   │   └── provider.js              唯一 AI 出口（extractContract / summarize / draftReminder / askLedger / complete）
│   └── styles/
│       ├── theme.css                Element Plus CSS 变量覆盖 + 系统字体栈
│       ├── layout.css               布局壳、侧边栏、页脚、响应式
│       └── pages.css                统计卡、筛选、表格、详情、提醒、卡片布局
└── dist/
    └── index.html                   构建产物（单文件、自包含）
```

### 4.1 数据集合

`contracts`、`payments`、`deliveries`、`personnel`、`dicts`、`settings`、`meta`。

- 每条业务记录含 `id`（UUID）、`createdAt`、`updatedAt`；写入统一由 `store.js` 刷新 `updatedAt`。
- `contracts` 的方向与交付字段：`direction`（`sale` / `purchase`，唯一的方向真相）、`deliveredAmount`（已交付金额汇总，只由交付明细维护）、`lastDeliveryDate`（最后交付日期）。
- `deliveries`（交付执行明细）：`id`、`contractId`、`date`（交付日期）、`amount`（本次交付金额，必须大于 0）、`quantity` / `unit`（仅作描述，不参与任何计算）、`status`（`delivered` 已交付 / `accepted` 已验收 / `rejected` 验收驳回；`rejected` 不计入已交付金额但保留供追溯）、`note`、`createdAt`、`updatedAt`。
- `settings` 为单条 `id: 'app'` 记录；`meta` 为单条 `id: 'meta'` 记录，含 `schemaVersion`、`seeded`（演示数据标记）、`storageEngine`、`lastBackupAt`、`lastImportAt`、`lastMigrationAt`、`opLogs`。提醒忽略记录按 5.4 的要求写入 `settings.ignoredReminders`（不删除业务数据）。
- 派生字段（未收金额、资金进度、交付进度、错位差额、逾期/临期判定等）一律实时计算，不落库、不提供编辑入口；`deliveredAmount` / `lastDeliveryDate` 为落库的汇总字段，但只由交付明细的登记 / 删除在同一事务内维护，表单中只读。

---

## 5. UI 组件复用约定

### 5.1 原则

- 凡 Element Plus / ECharts 已提供的能力，一律直接复用；**不重复造组件**。
- `src/components/` 下只允许业务组合组件，全部是对 EP 组件的 props / 事件 / 业务薄封装；**不存在** `BaseTable / BaseModal / BaseToast / BaseConfirm / BasePagination / BaseDatePicker / BaseSelect / BaseChart`。
- 业务语义（金额逻辑、日期先后、唯一性、引用计数）写在 `utils/validate.js`、`utils/derive.js` 与 `el-form` 自定义 validator 中，不手写 UI 组件。

### 5.2 映射表摘要（实现即映射）

| 需求 | 实际使用 | 未使用（禁止项） |
|---|---|---|
| 数据表格 / 排序 / 多选 / 固定列 / 自定义列 | `el-table` + `el-table-column`（`sortable="custom"`、`type="selection"`、`fixed`） | 手写 `<table>`、排序箭头、勾选逻辑 |
| 分页 | `el-pagination`（`v-model:current-page` / `page-size`） | 手写页码、「共 N 条」 |
| 列显隐 | `el-drawer` + `el-checkbox-group` | 手写下拉浮层 |
| 表单与校验 | `el-form` + `el-form-item` + `rules` + `validate` | 手写红字、必填星号 |
| 下拉 / 字典选项 | `el-select` + `el-option`（实时读字典 / 人员） | 原生 `<select>`、硬编码 option |
| 客户联想 | `el-autocomplete` | datalist / 手写联想浮层 |
| 日期 | `el-date-picker`（`value-format="YYYY-MM-DD"`、daterange） | 手写日历、`<input type="date">` |
| 金额 / 天数 | `el-input-number`（`controls-position`、`precision`） | 手写千分位输入框 |
| 开关 | `el-switch` | 手写 checkbox 模拟 |
| 弹窗表单 | `el-dialog` + `el-form` | 手写 overlay / z-index |
| 抽屉 | `el-drawer` | 手写侧滑面板 |
| 二次确认 | `ElMessageBox.confirm` | 手写 confirm、`window.confirm` |
| 轻提示 / 通知 | `ElMessage` / `ElNotification` | 手写 toast 容器 |
| 状态色标 / 类型 / 验收状态 | `el-tag`（`type` / `effect` / CSS 变量色） | 手写彩色 span |
| 资金 / 交付进度（两条独立进度条） | `el-progress`（`:percentage`、自定义 color） | 手写 div 宽度条 |
| 交付明细 | `el-timeline` + `el-timeline-item`（金额、验收状态、备注、数量单位） | 手写表格或竖线圆点 |
| 首页方向切换 | `el-radio-group`（销售 / 采购） | 手写 tab 切换 |
| 详情字段 | `el-descriptions` + `el-descriptions-item` | dl/dt/dd |
| 收款 / 状态日志 | `el-timeline` + `el-timeline-item` | 手写竖线与圆点 |
| 空状态 | `el-empty`（含引导按钮） | 空白占位 div |
| 加载态 | `v-loading`（表格、图表） | 手写 loading 遮罩 |
| 附件元信息 | `el-upload`（`auto-upload=false`、`before-upload` 返回 false） | `<input type="file">` + 手写列表 |
| 统计卡 / 布局 | `el-row` + `el-col` + `el-card` | 手写 grid 骨架 |
| 侧边导航 | `el-menu`（`router` 模式 + hash 路由） | 手写 nav / active 判断 |
| 横幅 | `el-alert`（便携 / 降级 / 只读 / 备份到期 / AI） | 手写顶部条 |
| 悬浮说明 | `el-tooltip` | `title` 属性替代 |
| 图表 | ECharts（集中注册、SVGRenderer） | 手写 SVG 坐标轴 / 图例 / tooltip |
| 图标 | `@element-plus/icons-vue` 显式 import | 图标字体、外链 svg、emoji |
| 错误兜底 | `app.config.errorHandler` + `ElNotification` | 白屏 / 只 console.error |

### 5.3 全局中文

`src/main.js` 引入 `zhCn` 并通过 `app.provide('ep-locale', zhCn)` 提供；`App.vue` 用 `<el-config-provider :locale="locale">` 包裹根组件。分页「共 N 条 / 20条/页」、日期选择器「YYYY 年 MM 月 / 日一二三四五六」、`ElMessageBox` 等命令式 API 均为中文。

---

## 6. 备份与恢复完整步骤

### 6.1 导出备份

1. 进入「系统设置 → 备份与恢复」或首页/合同页点击「导出备份」。
2. 打开 `el-dialog`，确认各集合记录数（合同 / 收款 / 交付明细 / 人员 / 字典 / 设置）。
3. 点击「确认导出」，下载：

```text
合同台账备份_YYYYMMDD_HHmm.json
```

4. 结构：

```json
{
  "app": "contract-ledger",
  "schemaVersion": 2,
  "exportedAt": "2026-11-12T10:05:00.000Z",
  "data": {
    "contracts": [
      {
        "id": "c0000000-0000-4000-8000-000000000001",
        "no": "HT-202408-001",
        "customer": "星海科技有限公司",
        "direction": "sale",
        "typeCode": "sales",
        "amount": 480000,
        "receivedAmount": 480000,
        "deliveredAmount": 0,
        "lastDeliveryDate": "",
        "……": "其余字段（日期、状态、负责人、状态日志、附件等）省略"
      }
    ],
    "payments": [],
    "deliveries": [],
    "personnel": [],
    "dicts": [],
    "settings": {
      "id": "app",
      "reminderDays": 30,
      "overdueDays": 0,
      "staleDays": 90,
      "autoNo": { "enabled": true, "pattern": "HT-YYYYMM-###" },
      "autoBackup": { "enabled": true, "intervalDays": 7 },
      "dictCategories": [],
      "columnVisibility": {},
      "ai": { "provider": "custom", "model": "", "timeout": 30, "temperature": 0.3 }
    }
  }
}
```

- `schemaVersion` 当前为 **2**：备份新增 `deliveries` 集合与合同的 `direction` / `deliveredAmount` / `lastDeliveryDate` 字段。
- **v1 备份兼容**：`schemaVersion: 1` 的历史备份仍可导入；校验时缺失的新字段只记警告，导入后立即由幂等迁移补齐（`typeCode === 'purchase'` 的合同推断为采购，其余默认销售，`deliveries` 补空数组）。
- **合并导入方向冲突**：同一 `id` 的合同方向不一致时，若本机该合同已有资金流水或交付明细，以本机方向为准并计入「保留条数」，不会静默翻转。
- `settings.ai` 中**强制剔除** `apiKey`、`baseUrl`、`enabled`。
- 导出成功后更新 `meta.lastBackupAt`；若当前为只读模式，文件仍会下载，但会明确提示「未能更新上次备份时间」。

### 6.2 导入备份（覆盖 / 合并）

1. 在「备份与恢复」的 `el-upload` 拖拽区拖入 `.json` 文件（`auto-upload=false`，不会真上传）。
2. 应用依次执行：
   - **结构 / schemaVersion / 字段类型 / 必填项校验**；不通过则弹出「备份文件校验失败」对话框，逐条列出具体字段与原因。
   - 弹出 `ElMessageBox` 让用户选择：
     - **覆盖导入**：用备份整体替换现有数据；
     - **合并导入**：按 `id` 去重，冲突取 `updatedAt` 较新者；合同方向冲突且本机已有执行记录时以本机方向为准（见 6.1）；设置采用备份中的业务设置，本机 AI 密钥保留。
   - **自动下载导入前快照**：`合同台账快照_YYYYMMDD_HHmmss.json`。
   - 用**单事务**写入（IndexedDB 清理并重写全部集合；localStorage 单键整库写入），任一步失败整体回滚。
3. 成功后提示导入模式与新增/更新/保留条数，派生值、提醒与首页统计自动重建。
4. 非法 / 截断 / 版本不匹配的 JSON 不会修改现有数据。

### 6.3 清空与恢复演示数据

- 「清空全部数据」：`ElMessageBox` 二次确认，提示先导出备份。清空合同 / 收款 / 交付明细 / 人员，并把字典重置为内置项，保留设置。
- 「恢复演示数据」：二次确认后，用 18 份合同、17 条资金流水与 6 条交付明细的演示数据替换当前业务数据（AI 配置与列显隐保留）。
- 所有危险操作都有明确文案与取消入口。

---

## 7. 演示数据说明

首次启动检测到空库时，会通过 `ElMessageBox.confirm` 询问是否载入演示数据；也可以随时在「系统设置 → 备份与恢复」点击「恢复演示数据」。

- 规模：**18 份合同（销售 15 / 采购 3）/ 17 条资金流水 / 6 条交付明细 / 6 名人员 / 17 个字典项**（4 个内置分类；合同类型中「销售合同 / 采购合同」两项已停用不删除，方向由合同字段表达）。
- 覆盖场景：

| 场景 | 演示数据示例 |
|---|---|
| 执行中 / 已完结 / 已终止 / 草稿 | 多份合同分别处于四个状态 |
| 已收为 0 | 北辰医疗（逾期未收）、启明电子（已终止） |
| 部分收款 | 云图数据、恒远建设、蓝湖环保、远航物流等 |
| 全额收款 | 星海科技、天成制造、星河互娱、绿源农业 |
| 采购合同（0 进度） | 锐捷网络设备（未到货、未付款，交付与付款进度均为 0） |
| 采购合同（部分进度 + 验收驳回） | 华美办公家具（已付 18 万、已交付 18 万含一批待验收，另有 1 条 2 万验收驳回不计入已交付） |
| 采购合同（满进度已完结） | 新元新材料（全部到货验收、款项付清，两条进度 100%） |
| 销售合同部分交付 | 云图数据（已收 15 万、已交付 12 万，错位差额 3 万为预收） |
| 交付三种验收状态 | 已交付 / 已验收 / 验收驳回均有样本记录 |
| 本月到期 | 恒远建设（到期日 = 当月最后一天） |
| 已逾期 | 北辰医疗（已过期 20 天）、华宇咨询 |
| 跨年度签订 | 星海科技（2024-08 → 2025-08）、启明电子（2024-12 签订） |
| 合同金额为 0 | 明远教育公益赠送合同（进度显示「—」） |
| 状态超过 90 天未变更 | 蓝湖环保、绿源农业（statusChangedAt 为 120 天前） |
| 负责人已离职 | 智联软件（负责人刘洋，历史姓名快照保留） |
| 数据质量异常 | 启明电子「开始日期晚于到期日」 |

- 演示数据写入 `IndexedDB/localStorage`，不是硬编码只读数据源；可一键清空或覆盖。
- 演示数据里的日期基于**载入当天**计算相对日期，因此「本月到期 / 临期 / 逾期」在任意日期都成立。

---

## 8. 存储引擎三态与降级语义

启动顺序：**IndexedDB → localStorage → 内存只读**。页脚与「系统设置 → 存储状态」常驻显示当前引擎、容量、各集合记录数、上次备份/导入时间。

| 引擎 | 写入方式 | 失败语义 |
|---|---|---|
| **IndexedDB（主引擎）** | 单事务清空并重写全部集合；导入失败整体回滚 | 配额 / 安全错误时 `ElMessage.error` + 横幅，停止写入，引导导出 |
| **localStorage（降级）** | 单键整库 JSON 写入，仅适合小规模数据 | 捕获 `QuotaExceededError` / `SecurityError`，明确失败并停止录入；**不谎报保存成功** |
| **内存只读模式** | 无持久化 | 所有写入入口 disabled + `el-tooltip`「仅可浏览与导出」；导出仍可用（并提示未能更新备份时间） |

### 8.1 迁移与去重

- 每次启动若 IndexedDB 可用，会检查 localStorage 中是否遗留数据：若有业务数据，按 `id` 去重（`updatedAt` 较新者优先）合并进 IndexedDB，写入成功后才删除 localStorage 副本，并显示迁移前后记录数。
- 运行中若 IndexedDB 恢复可用，可在设置页点击「重新检测并迁移到 IndexedDB」；同样按 id 去重、成功后清理 localStorage，避免双份数据互相覆盖。
- Schema 迁移：`migrateDataset()` 幂等补齐 `id/createdAt/updatedAt` 与集合结构，不丢历史数据。v1 → v2 升级时额外补齐：缺失的 `direction`（`typeCode === 'purchase'` 推断为采购，其余销售）、`deliveredAmount = 0`、`lastDeliveryDate = ''`、`deliveries = []`；停用（不删除）`contractType` 字典的「销售合同 / 采购合同」两项，避免被引用计数拦截；并在 `meta.opLogs` 写一条迁移摘要。同一份数据连续迁移两次结果完全一致。

---

## 9. 数据仅存本机的风险提示

- 数据只保存在**当前浏览器、当前 origin** 的本地存储中，应用不连接任何服务器，也没有云同步。
- 以下操作都可能导致数据看似丢失：
  - 清除浏览器站点数据 / Cookie / 存储；
  - 换浏览器、换用户配置、使用无痕 / 隐私模式；
  - Safari 等浏览器长期未访问后的存储回收；
  - 便携模式（file://）下移动、重命名 HTML 文件，或换浏览器打开（不同浏览器对 file:// 的 origin 处理不一致）；
  - 系统清理软件、磁盘迁移、浏览器配置损坏。
- **请定期导出 JSON 备份**，并把它当作真正的存档。备份文件中不含 AI 密钥，可安全存放。
- 导入前应用会**自动下载当前数据快照**，仍建议手动保留最近几次备份。

---

## 10. AI 接入三步

默认实现是**占位实现**：未配置时所有 AI 入口禁用并显示 tooltip「请在设置中配置 AI 后使用」；即使配置后，占位实现也不会发起网络请求，只返回统一结构的「占位」结果，台账功能完全不受影响。

1. **填配置**：设置页「AI 配置」填写服务商 / Base URL / 模型名 / API Key / 超时 / 温度，打开总开关并保存。API Key 仅保存在本机，导出备份时强制剔除。
2. **替换 `src/ai/provider.js` 中的 `complete()` 实现**：

```js
export async function complete(prompt, context = {}, config = {}) {
  if (!isConfigured(config)) return notConfigured(AI_ACTIONS.COMPLETE)
  // 在这里使用 config.baseUrl / config.model / config.apiKey 发起真实请求
  // 注意：需要自行处理超时、错误兜底与返回结构对齐
  return { ok: true, data: { text: '...' }, meta: { network: true } }
}
```

3. **打开总开关**：保持 `extractContract / summarize / draftReminder / askLedger` 的返回结构不变，业务组件无需改动。合同表单「粘贴文本智能填入」、详情页「AI 摘要 / 生成催收文案」、首页「用一句话查台账」会自动变为可用。

> 未配置时应用零外部请求；不把任何密钥写入源码、演示数据或备份文件。

---

## 11. 构建产物校验

```bash
npm run build
npm run check
```

`scripts/check-singlefile.mjs` 断言：

1. `dist/index.html` 存在；
2. `dist/` 下除 `index.html` 外无任何文件（无 `assets/`、无 `.css/.js/.svg` 残留）；
3. HTML 内无 `<script src=...>`、无 `<link rel="stylesheet" href=...>`；
4. HTML 内无外链 `http(s)://` 资源引用（字体 / 图片 / CDN / favicon；`xmlns` 命名空间不计）；
5. 内联内容包含 Element Plus 样式特征（`--el-color-primary` / `.el-button`）；
6. 包含 hash 路由标识与 AI provider 标识；
7. 产物 ≤ 5 MB，超限以非零退出码失败并打印降体积建议。

任一断言失败都会以非零退出码结束；`npm run check` 会打印每项断言结果与当前产物体积。

---

## 附：已知限制与降级说明

1. **多列同时排序**：Element Plus 表格按列点击切换单列排序。所有业务列都可排序，但未实现「多列权重同时排序」。如需严格多列排序，需要在 `el-table` 的 `sort-change` 上手写多键排序状态（本应用未做，以免重复实现组件能力）。
2. **AI**：按需求只保留接口与入口；默认占位实现不发网络请求，不返回真实摘要/文案。
3. **附件**：按需求只记录文件名 / 大小 / 备注元信息，不上传、不写入真实文件路径。
4. **收款口径**：登记收款会同步累加合同已收金额并写流水；若手工直接修改已收金额而不登记流水，月度收款趋势图不会包含这部分调整。
5. **localStorage 降级**：仅为小数据量兜底，配额写满会停止录入并提示导出；不要把 localStorage 当作 IndexedDB 的等价替身。
6. **便携模式**：不同浏览器对 `file://` 的存储 origin 处理不同，可能持久化、降级为 localStorage 或进入只读。正式使用请用 localhost，并定期导出备份。
7. **清空语义**：清空全部数据会保留系统设置（含 AI 配置），并把字典重置为内置项，避免出现无状态可选、应用不可用的情况。
8. **两条执行轴维护方式不对称**：`deliveredAmount` 只读、仅由交付明细维护；`receivedAmount` 仍可在合同表单手工编辑。手工改已收金额不会产生资金流水，月度趋势图也不包含该调整，建议始终用「登记收款 / 付款」维护。
9. **采购对方**：供应商字段仍是自由文本 + 历史联想，没有供应商主数据档案（无唯一性、引用保护与转交语义）。
10. **执行计划与核销**：只记录实际发生的资金流水与交付明细，不含付款 / 交付计划节点，也不做流水与交付的一对一核销。
11. **交付验收人**：交付明细暂无独立「验收人」字段，验收信息以明细备注与合同负责人表达。
