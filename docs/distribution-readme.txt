台账（ledger）v{{version}}  使用说明
============================================================

本目录就是完整程序：ledger.exe（入口）+ node.exe + node_modules +
packages\web\dist + VERSION。放到任意可写位置即可运行：不用装 Node、
不用管理员权限、不联网、不写注册表。

------------------------------------------------------------
1. 快速开始
------------------------------------------------------------
双击 ledger.exe
  → 后台启动本地服务（默认 http://127.0.0.1:4517）
  → 首次启动弹出一次性配对码（8 位，120 秒有效）
  → 浏览器自动打开，输入配对码即完成配对
  → 之后再双击只打开浏览器，不会重复起服

配对码过期：ledger.exe stop 后重新双击。
换端口：ledger.exe start --port 4600（浏览器地址随之变化）。
把数据放在本目录内（随 U 盘携带）：ledger.exe --portable start

------------------------------------------------------------
2. 页面能做什么
------------------------------------------------------------
首页      概览：合同数与金额、资金/交付进度、临期与逾期提醒、近 12 个月趋势
合同      销售合同 / 采购合同两个列表：筛选、排序、分页、增删改；
          详情含资金流水、交付明细、状态变更日志
人员档案  编号（忽略大小写唯一）、部门、岗位、联系方式、在职状态、批量转交
字典配置  合同类型 / 合同状态 / 付款方式 / 部门，可增改条目
系统设置  提醒参数、编号规则、备份与恢复（导出 JSON / 下载快照 / 导入）、
          存储引擎状态；业务设置只读，AI 配置为能力预留（默认不联网）

------------------------------------------------------------
3. 数据、日志、配置放在哪
------------------------------------------------------------
状态根（默认 %LOCALAPPDATA%\ledger）：
  data\ledger.db        数据库（WAL 模式）
  data\backups\         备份（含升级前自动备份）
  logs\                 服务日志
  run\ledger.pid        运行中的进程号
  current.json          上次运行的版本与程序目录
  ledger.conf.json      首次运行后记录生效的状态根与数据目录

状态根解析优先级：
  --install-dir D  >  环境变量 LEDGER_HOME  >  exe 旁 ledger.conf.json
  >  exe 目录便携布局（存在 data\ 或 run\）  >  %LOCALAPPDATA%\ledger

只改数据位置：ledger.exe start --data D:\ledger-data

------------------------------------------------------------
4. 入口命令（ledger.exe）
------------------------------------------------------------
ledger.exe [start] [--port N] [--data DIR] [--install-dir DIR]
                   [--no-browser] [--portable]
ledger.exe stop              停止后台服务
ledger.exe status            版本、程序目录、状态目录（含来源）、数据与日志目录、
                             配置文件、上次运行版本、运行时完整性、运行状态
ledger.exe cli <参数...>     转发到 ledger CLI（自动带上 --data，透传退出码）
ledger.exe server <参数...>  前台启动服务（高级用法，Ctrl+C 结束）
ledger.exe version | --version
ledger.exe help

选项与子命令顺序无关，也支持 --data=D:\x 写法；
只有 cli / server 之后的参数会原样转发。

------------------------------------------------------------
5. 命令行（ledger.exe cli ...）
------------------------------------------------------------
5.1 先看帮助
  ledger.exe cli --help                    列出全部命令
  ledger.exe cli contract upsert --help    单条命令的选项
  ledger.exe cli describe                  机器可读能力描述（命令 / schema / 错误码）

5.2 通用选项（写在 cli 之后，位置不限）
  --json                  单行 JSON 信封（脚本与 agent 请用它）
  --dry-run               只预览字段级 diff，不写入、不递增版本
  --yes                   跳过交互确认
  --idempotency-key <k>   写命令必填；同键同内容重放首次结果
  --expected-version <n>  乐观锁：版本不符返回 STALE_WRITE
  --input '<json>'        命令入参
  --input-file <path>     从文件读入参；没有 --input 时也可用管道喂 JSON
  --data <dir>            数据目录（ledger.exe 已自动注入，通常不用写）

  退出码：0 成功 / 1 业务失败 / 2 用法或校验错误 / 4 未认证
  结果信封：{ ok, code?, message?, hint?, details?, retryable?, data?, version?, meta }
  写命令缺 --idempotency-key 会返回 IDEMPOTENCY_KEY_REQUIRED。

5.3 领域命令（18 条）
  contract  upsert | get | list | delete | statusLogs
  payment   record | list | delete
  delivery  record | list | delete
  personnel upsert | list | delete | transfer
  dict      upsert | list | delete

  · 金额一律整数分（amountCents），业务日期 YYYY-MM-DD。
  · contract.list 入参：{ direction?, statusCode?, ownerId?, search?,
                          page?, pageSize?, sortBy?, sortOrder? }
      默认 page=1、pageSize=20、sortBy=updatedAt、sortOrder=desc
      sortBy: no | counterparty | amountCents | dueDate | updatedAt
  · payment.record：{ contractId, date, amountCents, methodCode?, note? }
  · delivery.record：{ contractId, date, amountCents, status?, quantity?, unit?, note? }
      status: delivered（默认）| accepted | rejected（驳回不计入已交付金额）
  · dict.upsert 两种形态：
      { kind: "category", categoryCode, name, sort? }
      { kind: "item", categoryCode, code, name, color?, enabled?, sort? }

5.4 内置字典项（新建台账即有，编码可直接用）
  合同类型   sales 销售合同 | service 服务合同 | sale_service 服务类 |
             purchase 采购合同 | framework 框架协议
  合同状态   draft 草稿 | active 执行中 | executing 执行中 | finished 已完结 |
             terminated 已终止 | overdue 逾期
  付款方式   transfer 银行转账 | cash 现金 | check 支票 | installments 分期付款
  部门       sales 销售部 | delivery 交付部 | finance 财务部 | admin 行政部
  用 ledger.exe cli dict list --json 查看当前实际条目。

5.5 运维命令
  validate                     完整性 + 外键 + 业务不变量检查（有问题退出码 1）
  query --sql "<SELECT ...>"   只读 SQL（仅 SELECT / WITH / EXPLAIN，默认 200 行上限）
  backup [--out <dir>]         一致性备份（VACUUM INTO + 完整性检查）
  export [--out <file>]        导出 JSON（已剔除 apiKey / baseUrl / ai.enabled）
  import --backup <file> [--mode replace|merge]
  auth token create | list | revoke | rotate     agent 令牌
  auth session list | revoke                     浏览器会话

5.6 完整示例（cmd.exe；数据目录由 ledger.exe 自动注入）
  :: 1) 建人员，记下返回的 personnel.id
  ledger.exe cli personnel upsert --idempotency-key 1 ^
    --input "{\"code\":\"E001\",\"name\":\"张三\",\"deptCode\":\"sales\",\"position\":\"销售经理\"}"

  :: 2) 建合同（ownerId 填上一步的 id；typeCode / statusCode 用内置字典编码）
  ledger.exe cli contract upsert --idempotency-key 2 ^
    --input "{\"no\":\"HT-2026-001\",\"direction\":\"sale\",\"counterparty\":\"甲公司\",\"typeCode\":\"sales\",\"statusCode\":\"active\",\"ownerId\":\"<人员id>\",\"amountCents\":1200000,\"signDate\":\"2026-01-05\",\"startDate\":\"2026-01-06\",\"dueDate\":\"2026-12-31\"}"

  :: 3) 登记收款与交付
  ledger.exe cli payment record --idempotency-key 3 ^
    --input "{\"contractId\":\"<合同id>\",\"date\":\"2026-02-10\",\"amountCents\":300000,\"methodCode\":\"transfer\",\"note\":\"首款\"}"
  ledger.exe cli delivery record --idempotency-key 4 ^
    --input "{\"contractId\":\"<合同id>\",\"date\":\"2026-03-01\",\"amountCents\":400000,\"status\":\"accepted\"}"

  :: 4) 查询与统计（视图已算好派生值，直接查）
  ledger.exe cli contract list --json ^
    --input "{\"direction\":\"sale\",\"sortBy\":\"dueDate\",\"sortOrder\":\"asc\"}"
  ledger.exe cli query --json --sql "select no, counterparty, amount_cents, paid_cents, unpaid_cents, funding_percent, delivery_percent from v_contract_full order by due_date limit 20"

  :: 5) 备份与异地存档
  ledger.exe cli backup
  ledger.exe cli export --out D:\backup\ledger-2026-11-12.json

  :: 6) 给脚本 / agent 签发令牌（明文只出现这一次，库里只存哈希）
  ledger.exe cli auth token create --label web-agent

  PowerShell 下用单引号包 JSON 更省转义：
  ledger.exe cli contract list --input '{"page":1,"pageSize":20,"sortBy":"updatedAt","sortOrder":"desc"}' --json

------------------------------------------------------------
6. 升级、回滚、卸载
------------------------------------------------------------
升级 = 换目录：
  ledger-<旧版本>-win-x64\ledger.exe stop
  ledger-<新版本>-win-x64\ledger.exe
  启动前自动备份到 <data>\backups\upgrade-<旧版本>-<时间戳>.db；
  备份失败则不启动。旧目录保留，确认无误后自行删除。

回滚 = 用旧目录启动：
  stop 后，必要时用上面的备份覆盖 <data>\ledger.db，
  并删除 <data>\ledger.db-wal 与 <data>\ledger.db-shm，
  再运行旧目录的 ledger.exe。程序不会自动改数据。

卸载 = 删文件夹：
  ledger.exe stop 后删除本目录；需要时再删状态根
  %LOCALAPPDATA%\ledger（含 data\、logs\、run\、current.json）。

------------------------------------------------------------
7. 常见问题
------------------------------------------------------------
* 双击没反应 / 端口被占用：换端口 ledger.exe start --port 4600；
  ledger.exe status 会显示运行状态与占用情况。
* 页面提示未配对：配对码在首次启动的弹窗与控制台输出里，120 秒有效；
  过期执行 ledger.exe stop 后重新双击。
* 想知道服务在不在跑、数据在哪：ledger.exe status；日志在 <状态根>\logs。
* 提示「数据库结构版本过高」：说明用旧版本打开了新数据，程序会拒绝启动并
  指出备份目录；改用新版本启动，或用升级前备份覆盖 ledger.db 后重试。
* 金额：界面按元，库里按分；命令行入参一律是 *Cents 整数分。
* 服务只监听 127.0.0.1，运行期不发起任何外部网络请求，不需要联网。

------------------------------------------------------------
8. 校验与版本
------------------------------------------------------------
* SHA256SUMS 列出本目录内关键文件的校验值，可用
    certutil -hashfile ledger.exe SHA256
  与其中一行比对。
* 版本同源：本 README 顶部、VERSION、ledger.exe --version、
  ledger.exe cli --version、页面 /api/health 的 version 保持一致。

详细说明（架构、安全模型、发版流程）见仓库 docs/distribution.md。
