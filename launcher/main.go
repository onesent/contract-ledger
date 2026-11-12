// Package main 实现台账的便携启动器：校验同目录运行时、后台起服、停服、状态与升级/卸载。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// version 由构建脚本通过 -ldflags "-X main.version=..." 注入；运行时优先用同目录 VERSION 文件。
var version = "0.0.0-dev"

const (
	// defaultPort 是服务默认监听端口（仅回环）。
	defaultPort = 4517
	// exitOK 表示成功。
	exitOK = 0
	// exitFailed 表示运行期失败。
	exitFailed = 1
	// exitUsage 表示参数用法错误。
	exitUsage = 2
	// exitPayload 表示分发包校验失败（运行时文件不完整或校验值不符）。
	exitPayload = 3
	// exitPort 表示目标端口被占用。
	exitPort = 4
	// exitBackup 表示升级前备份失败（已中止）。
	exitBackup = 6
	// healthTimeout 是等待服务就绪的上限。
	healthTimeout = 30 * time.Second
)

// options 是启动器命令行选项。
type options struct {
	command   string
	port      int
	dataDir   string
	homeDir   string
	noBrowser bool
	portable  bool
	// rest 是转发给 cli / server 的原始参数。
	rest []string
}

// takeValue 读取 --name value 形式的取值；支持 --name=value。
func takeValue(argv []string, index *int, name, inlineValue string, hasInline bool) (string, error) {
	if hasInline {
		if inlineValue == "" {
			return "", fmt.Errorf("选项 %s 缺少取值。", name)
		}
		return inlineValue, nil
	}
	if *index+1 >= len(argv) {
		return "", fmt.Errorf("选项 %s 缺少取值。", name)
	}
	value := argv[*index+1]
	if strings.HasPrefix(value, "--") {
		return "", fmt.Errorf("选项 %s 缺少取值。", name)
	}
	*index++
	return value, nil
}

// splitOption 把 --name=value 拆成名称与取值。
func splitOption(arg string) (name, value string, inline bool) {
	if at := strings.Index(arg, "="); at > 0 {
		return arg[:at], arg[at+1:], true
	}
	return arg, "", false
}

// parseArgs 解析命令行参数。子命令可以出现在任意位置（例如 `--install-dir D:\ledger status`
// 与 `status --install-dir D:\ledger` 等价）；`cli` / `server` 之后的参数不再参与解析，原样转发。
func parseArgs(argv []string) (options, error) {
	opts := options{command: "start", port: defaultPort}
	commandSet := false
	for index := 0; index < len(argv); index++ {
		arg := argv[index]
		if !strings.HasPrefix(arg, "-") {
			opts.command = arg
			commandSet = true
			// cli / server 子命令后面的参数原样转发，不参与启动器解析。
			if arg == "cli" || arg == "server" {
				opts.rest = append([]string{}, argv[index+1:]...)
				return opts, nil
			}
			continue
		}
		name, inlineValue, hasInline := splitOption(arg)
		switch name {
		case "--port":
			raw, err := takeValue(argv, &index, name, inlineValue, hasInline)
			if err != nil {
				return opts, err
			}
			port, err := strconv.Atoi(raw)
			if err != nil || port <= 0 || port > 65535 {
				return opts, fmt.Errorf("--port 必须是 1..65535 的整数，当前为：%s", raw)
			}
			opts.port = port
		case "--data":
			raw, err := takeValue(argv, &index, name, inlineValue, hasInline)
			if err != nil {
				return opts, err
			}
			opts.dataDir = raw
		case "--install-dir":
			raw, err := takeValue(argv, &index, name, inlineValue, hasInline)
			if err != nil {
				return opts, err
			}
			opts.homeDir = raw
		case "--no-browser":
			opts.noBrowser = true
		case "--portable":
			opts.portable = true
		case "--help", "-h":
			// 已指定子命令时保留它，`ledger.exe stop --help` 仍执行 stop。
			if !commandSet {
				opts.command = "help"
			}
		case "--version", "-v":
			if !commandSet {
				opts.command = "version"
			}
		default:
			return opts, fmt.Errorf("未知参数：%s", arg)
		}
	}
	return opts, nil
}

// main 是启动器入口。
func main() {
	setupConsole()
	code := runMain()
	// os.Exit 不会执行 defer，这里显式恢复控制台代码页。
	restoreConsoleCodePage()
	os.Exit(code)
}

// runMain 解析参数并分派子命令，返回退出码。
func runMain() int {
	opts, err := parseArgs(os.Args[1:])
	if err != nil {
		reportUsage(err)
		return exitUsage
	}
	return run(opts)
}

// run 按子命令分派。
func run(opts options) int {
	// --portable 是 --install-dir <exe 所在目录> 的语法糖：数据与程序同放，便于随 U 盘携带。
	if opts.portable && opts.homeDir == "" {
		dir := exeDir()
		if dir == "" {
			reportUsage(fmt.Errorf("--portable 需要可执行文件路径可解析"))
			return exitUsage
		}
		opts.homeDir = dir
	}
	if opts.command == "" {
		opts.command = defaultCommand()
	}
	handler, ok := dispatch[opts.command]
	if !ok {
		reportUsage(fmt.Errorf("未知子命令：%s", opts.command))
		return exitUsage
	}
	return handler(opts)
}

// start 校验运行时并后台起服，就绪后打开浏览器。
func start(opts options) int {
	runtimePath := runtimeDir()
	if err := verifyRuntime(runtimePath); err != nil {
		showError("启动失败", err.Error())
		fmt.Fprintf(errOut, "启动失败：%v\n", err)
		return exitPayload
	}
	currentVersion := runtimeVersion(runtimePath)

	lay, err := resolveHome(opts.homeDir)
	if err != nil {
		showError("启动失败", err.Error())
		fmt.Fprintf(errOut, "启动失败：%v\n", err)
		return exitFailed
	}
	dataDir, err := effectiveDataDir(opts, lay)
	if err != nil {
		showError("启动失败", err.Error())
		fmt.Fprintf(errOut, "启动失败：%v\n", err)
		return exitFailed
	}
	for _, dir := range []string{dataDir, lay.logsDir(), lay.runDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			message := fmt.Sprintf("无法创建目录 %s：%v", dir, err)
			showError("启动失败", message)
			fmt.Fprintf(errOut, "启动失败：%s\n", message)
			return exitFailed
		}
	}

	url := fmt.Sprintf("http://127.0.0.1:%d", opts.port)
	if state, ok := readState(lay); ok && processAlive(state.PID) {
		runningPort := state.Port
		if state.Version == currentVersion && healthOK(runningPort) {
			fmt.Fprintf(out, "台账已在运行：http://127.0.0.1:%d\n", runningPort)
			if !opts.noBrowser {
				openBrowser(fmt.Sprintf("http://127.0.0.1:%d", runningPort))
			}
			return exitOK
		}
		// 运行中的是其他版本（升级/降级）：先停服，再备份与启动。
		if err := stopProcess(lay, state); err != nil {
			message := fmt.Sprintf("停止旧版本失败：%v", err)
			showError("启动失败", message)
			fmt.Fprintf(errOut, "%s\n", message)
			return exitFailed
		}
	}
	// pid 文件可能已被覆盖：按路径兜底清理同目录残留进程。
	if killed := killProcessesUnder(runtimePath); killed > 0 {
		fmt.Fprintf(out, "已结束 %d 个残留进程\n", killed)
	}
	if portInUse(opts.port) {
		message := fmt.Sprintf(
			"端口 %d 已被其他程序占用。\n请用 --port 指定其他端口后重试，例如：ledger.exe start --port 4518\n"+
				"若占用者是另一个目录里的旧版本台账，请到该目录执行 ledger.exe stop。",
			opts.port,
		)
		showError("端口被占用", message)
		fmt.Fprintln(errOut, message)
		return exitPort
	}

	// 跨版本启动（升级或降级）且已有数据库时，先用运行时内的 CLI 做一致性备份。
	previous := readInstallState(lay)
	if previous.Version != currentVersion && fileExists(filepath.Join(dataDir, "ledger.db")) {
		backupPath, err := backupBeforeUpgrade(runtimePath, dataDir, previous.Version)
		if err != nil {
			message := fmt.Sprintf("升级前备份失败，已中止启动以保护数据：\n%v", err)
			showError("升级中止", message)
			fmt.Fprintln(errOut, message)
			return exitBackup
		}
		fmt.Fprintf(out, "升级前已备份：%s\n", backupPath)
	}

	logPath := filepath.Join(lay.logsDir(), fmt.Sprintf("server-%s-%s.log", currentVersion, time.Now().Format("20060102")))
	if err := startServer(lay, runtimePath, dataDir, opts.port, logPath); err != nil {
		message := fmt.Sprintf("%v\n日志：%s", err, logPath)
		showError("启动失败", message)
		fmt.Fprintf(errOut, "启动失败：%s\n", message)
		return exitFailed
	}
	if err := waitHealthy(opts.port, healthTimeout); err != nil {
		// 把服务最后一条错误带回控制台/弹框，否则用户只看到「未就绪」而无从下手。
		reason := lastLogLine(logPath)
		if reason == "" {
			reason = fmt.Sprintf("服务在 %s 内未就绪。", healthTimeout)
		}
		showError("启动失败", fmt.Sprintf("%s\n日志：%s", reason, logPath))
		fmt.Fprintf(errOut, "启动失败：%s\n日志：%s\n", reason, logPath)
		return exitFailed
	}
	if err := writeInstallState(lay, installState{Version: currentVersion, InstallDir: runtimePath}); err != nil {
		fmt.Fprintf(errOut, "提示：无法写入 %s（%v），下次启动会再备份一次。\n", lay.currentPath(), err)
	}
	// 记住本次生效的目录，后续命令（status / cli …）无需再传 --install-dir / --data。
	persistConfig(lay, configFor(lay, dataDir))
	fmt.Fprintf(out, "台账已启动：%s\n  版本 %s\n  程序 %s\n  数据 %s\n  日志 %s\n",
		url, currentVersion, runtimePath, dataDir, logPath)
	if !opts.noBrowser {
		openBrowser(url)
	}
	// 未配对时把本次启动日志里的一次性配对码展示给用户（双击场景下用户看不到控制台）。
	if !healthPaired(opts.port) {
		if code, ok := extractPairingCode(readText(logPath)); ok {
			showInfo("首次使用配对", pairingMessage(code, url))
		}
	}
	return exitOK
}

// status 打印版本、目录与运行状态。
func status(opts options) int {
	runtimePath := runtimeDir()
	lay, err := resolveHome(opts.homeDir)
	if err != nil {
		fmt.Fprintf(errOut, "状态查询失败：%v\n", err)
		return exitFailed
	}
	dataDir, err := effectiveDataDir(opts, lay)
	if err != nil {
		fmt.Fprintf(errOut, "状态查询失败：%v\n", err)
		return exitFailed
	}
	currentVersion := runtimeVersion(runtimePath)
	previous := readInstallState(lay)
	fmt.Fprintf(out, "版本 %s\n程序目录 %s\n状态目录 %s（来源：%s）\n数据目录 %s\n日志目录 %s\n配置文件 %s\n",
		currentVersion, runtimePath, lay.home, lay.source, dataDir, lay.logsDir(),
		filepath.Join(lay.home, configFileName))
	if previous.Version != "" && previous.Version != currentVersion {
		fmt.Fprintf(out, "上次运行 %s（%s）\n", previous.Version, fallbackText(previous.InstallDir, "目录未知"))
	}
	if err := verifyRuntime(runtimePath); err != nil {
		fmt.Fprintf(out, "运行时 不完整（%v）\n", err)
	} else {
		fmt.Fprintln(out, "运行时 完整")
	}
	state, hasState := readState(lay)
	running := hasState && processAlive(state.PID) && healthOK(state.Port)
	if running {
		fmt.Fprintf(out, "状态 运行中（pid %d）：http://127.0.0.1:%d\n", state.PID, state.Port)
		return exitOK
	}
	// 状态根里什么都没有 = 从未运行过（程序目录存在并不代表已初始化）。
	if previous.Version == "" && !dirExists(lay.dataDir()) && !dirExists(lay.runDir()) && !dirExists(lay.logsDir()) {
		fmt.Fprintf(out, "状态 未初始化（尚未运行过；首次 start 会在 %s 下创建 data/logs/run）\n", lay.home)
		return exitOK
	}
	fmt.Fprintln(out, "状态 未运行")
	return exitOK
}

// stop 停止后台服务；未运行时幂等成功。
func stop(opts options) int {
	lay, err := resolveHome(opts.homeDir)
	if err != nil {
		fmt.Fprintf(errOut, "停止失败：%v\n", err)
		return exitFailed
	}
	state, ok := readState(lay)
	if !ok || !processAlive(state.PID) {
		removeState(lay)
		// pid 文件丢失或过期时按路径兜底：同目录的残留进程同样要停掉。
		if killed := killProcessesUnder(runtimeDir()); killed > 0 {
			fmt.Fprintf(out, "已结束 %d 个残留服务进程\n", killed)
			return exitOK
		}
		fmt.Fprintln(out, "台账未在运行")
		return exitOK
	}
	if err := stopProcess(lay, state); err != nil {
		fmt.Fprintf(errOut, "停止失败：%v\n", err)
		return exitFailed
	}
	fmt.Fprintf(out, "已停止（pid %d）\n", state.PID)
	return exitOK
}
