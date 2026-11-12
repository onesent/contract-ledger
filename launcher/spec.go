package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// commandSpec 描述一个入口子命令。它是启动器命令面的唯一权威：
// usage() 由它渲染，`ledger.exe spec --json` 由它序列化，
// 分发包 README 与 docs 的漂移检查（scripts/docs-drift.test.mjs）也读它的产物。
type commandSpec struct {
	// Name 是子命令名；start 同时也是默认命令（不带参数时执行）。
	Name string `json:"name"`
	// Usage 是用法片段，如 "ledger.exe stop"。
	Usage string `json:"usage"`
	// Summary 是一句话说明（中文）。
	Summary string `json:"summary"`
	// Forward 为真表示该子命令之后的参数原样转发给被转发的入口。
	Forward bool `json:"forward"`
	// Hidden 为真表示不在用户帮助里展示（仅供工具消费）。
	Hidden bool `json:"hidden"`
	// Default 为真表示不带子命令时执行它。
	Default bool `json:"default"`
}

// optionSpec 描述一个入口选项。
type optionSpec struct {
	Flag    string `json:"flag"`
	Arg     string `json:"arg"`
	Summary string `json:"summary"`
}

// commandSpecs 是子命令表的唯一声明处；新增/删除子命令必须先改这里。
var commandSpecs = []commandSpec{
	{Name: "start", Usage: "ledger.exe [start] [选项...]", Summary: "校验运行时、起服、等健康检查并打开浏览器", Default: true},
	{Name: "stop", Usage: "ledger.exe stop", Summary: "停止后台服务（幂等）"},
	{Name: "status", Usage: "ledger.exe status", Summary: "查看版本、目录、配置文件与运行状态"},
	{Name: "cli", Usage: "ledger.exe cli <参数...>", Summary: "转发到 ledger CLI（透传退出码）", Forward: true},
	{Name: "server", Usage: "ledger.exe server <参数...>", Summary: "前台启动服务入口（高级用法）", Forward: true},
	{Name: "version", Usage: "ledger.exe version", Summary: "打印版本"},
	{Name: "help", Usage: "ledger.exe help", Summary: "显示本帮助"},
	{Name: "spec", Usage: "ledger.exe spec", Summary: "输出子命令与选项的机器可读 JSON 清单（供文档漂移检查）", Hidden: true},
}

// optionSpecs 是选项表的唯一声明处；usage() 与 spec 输出都由它渲染。
var optionSpecs = []optionSpec{
	{Flag: "--port", Arg: "N", Summary: "监听端口（默认 4517，仅回环）"},
	{Flag: "--data", Arg: "DIR", Summary: "数据目录（默认 <状态根>\\data）"},
	{Flag: "--install-dir", Arg: "DIR", Summary: "状态根目录（data / logs / run / current.json），默认 %LOCALAPPDATA%\\ledger，可用 LEDGER_HOME 覆盖"},
	{Flag: "--no-browser", Arg: "", Summary: "启动后不打开浏览器"},
	{Flag: "--portable", Arg: "", Summary: "把 exe 所在目录当作状态根（整个文件夹随 U 盘携带）"},
	{Flag: "--version", Arg: "", Summary: "等价于 version（-v 同义）"},
	{Flag: "--help", Arg: "", Summary: "等价于 help（-h 同义）"},
}

// specDoc 是 `spec --json` 的输出结构。
type specDoc struct {
	// Version 是当前版本（运行时优先读同目录 VERSION）。
	Version string `json:"version"`
	// Commands 是子命令清单（含隐藏项，便于工具判断合法性）。
	Commands []commandSpec `json:"commands"`
	// Options 是选项清单。
	Options []optionSpec `json:"options"`
	// ExitCodes 是退出码语义，文档与测试按它核对。
	ExitCodes []exitCodeSpec `json:"exitCodes"`
}

// exitCodeSpec 描述一个退出码。
type exitCodeSpec struct {
	Code    int    `json:"code"`
	Meaning string `json:"meaning"`
}

// exitCodes 是退出码表的唯一声明处。
var exitCodes = []exitCodeSpec{
	{exitOK, "成功"},
	{exitFailed, "运行失败"},
	{exitUsage, "用法或参数错误"},
	{exitPayload, "运行时文件不完整或校验值不符"},
	{exitPort, "目标端口被占用"},
	{exitBackup, "跨版本启动前备份失败（已中止）"},
}

// commandByName 返回指定名字的子命令声明。
// @param name 子命令名
// @returns 声明与是否命中
func commandByName(name string) (commandSpec, bool) {
	for _, spec := range commandSpecs {
		if spec.Name == name {
			return spec, true
		}
	}
	return commandSpec{}, false
}

// defaultCommand 返回默认子命令名（不带子命令时执行）。
// @returns 默认子命令名
func defaultCommand() string {
	for _, spec := range commandSpecs {
		if spec.Default {
			return spec.Name
		}
	}
	return "start"
}

// dispatch 把子命令名映射到处理函数；run() 只按它分派，
// 因此「声明了子命令但忘了实现」会被 spec_test 立刻发现。
var dispatch = map[string]func(options) int{
	"start":   start,
	"stop":    stop,
	"status":  status,
	"cli":     func(opts options) int { return passthrough(opts, "cli") },
	"server":  func(opts options) int { return passthrough(opts, "server") },
	"version": printVersion,
	"help":    printHelp,
	"spec":    printSpec,
}

// printVersion 打印版本。
// @param _ 已解析的选项（未使用）
// @returns 退出码
func printVersion(_ options) int {
	fmt.Fprintf(out, "ledger %s\n", runtimeVersion(runtimeDir()))
	return exitOK
}

// printHelp 打印帮助。
// @param _ 已解析的选项（未使用）
// @returns 退出码
func printHelp(_ options) int {
	fmt.Fprint(out, usage())
	return exitOK
}

// printSpec 输出机器可读的子命令与选项清单。
// @param _ 已解析的选项（未使用）
// @returns 退出码
func printSpec(_ options) int {
	payload, err := marshalSpec()
	if err != nil {
		fmt.Fprintf(errOut, "输出 spec 失败：%v\n", err)
		return exitFailed
	}
	fmt.Fprintf(out, "%s\n", payload)
	return exitOK
}

// specJSON 组装机器可读的命令面描述。
// @returns 描述结构
func specJSON() specDoc {
	commands := make([]commandSpec, len(commandSpecs))
	copy(commands, commandSpecs)
	sort.SliceStable(commands, func(i, j int) bool { return commands[i].Name < commands[j].Name })
	return specDoc{
		Version:   runtimeVersion(runtimeDir()),
		Commands:  commands,
		Options:   optionSpecs,
		ExitCodes: exitCodes,
	}
}

// usage 返回中文用法说明；子命令与选项都从声明表渲染，避免与实现漂移。
// @returns 帮助文本
func usage() string {
	var b strings.Builder
	b.WriteString("ledger 本地台账\n\n用法：\n")
	for _, spec := range commandSpecs {
		if spec.Hidden {
			continue
		}
		b.WriteString("  " + spec.Usage)
		b.WriteString(strings.Repeat(" ", padding("  "+spec.Usage, 32)))
		b.WriteString(spec.Summary + "\n")
	}
	b.WriteString("\n子命令与选项顺序无关：ledger.exe --install-dir D:\\ledger status 与\n")
	b.WriteString("ledger.exe status --install-dir D:\\ledger 等价；只有 cli / server\n")
	b.WriteString("之后的参数会原样转发给被转发的入口。\n\n选项：\n")
	for _, opt := range optionSpecs {
		line := "  " + opt.Flag
		if opt.Arg != "" {
			line += " " + opt.Arg
		}
		if pad := 20 - textWidth(line); pad > 2 {
			line += strings.Repeat(" ", pad)
		} else {
			line += "  "
		}
		b.WriteString(line + opt.Summary + "\n")
	}
	b.WriteString(`
程序与数据分离：ledger.exe 只做入口，运行时（node.exe / node_modules /
packages\web\dist / VERSION）与它同目录，来自分发包 zip；业务数据放在状态根。
升级：把新版本 zip 解压到新目录，用其中的 ledger.exe 启动（跳版本启动会自动
备份数据库到 <data>\backups\upgrade-<旧版本>-<时间戳>.db）。
回滚：用旧目录的 ledger.exe 启动，必要时用备份覆盖 ledger.db。
卸载：直接删除程序目录；需要时再删状态根（含 data）。
首次启动或首次转发 cli 后会把生效状态根写入 <install-dir>\ledger.conf.json，
若 exe 不在状态根内还会在 exe 旁写一份，因此后续命令不必重复传 --install-dir。
`)
	return b.String()
}

// marshalSpec 把 spec 序列化成稳定文本（缩进两格、不做 HTML 转义），
// 供 `spec` 子命令输出与 spec.json 一致性测试共用。
// @returns 序列化结果
func marshalSpec() (string, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(specJSON()); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

// padding 计算对齐到目标列所需的空格数。
// 中文按两列宽计算（终端里全角字符占两格），因此不能用 len()。
// @param text 待对齐文本
// @param column 目标列（从行首算起的显示列）
// @returns 需要的空格数（至少 2，保证不粘连）
func padding(text string, column int) int {
	if gap := column - textWidth(text); gap > 2 {
		return gap
	}
	return 2
}

// textWidth 计算字符串在终端里的显示宽度：ASCII 与半角为 1，CJK/全角为 2。
// @param text 待计算文本
// @returns 显示宽度
func textWidth(text string) int {
	width := 0
	for _, r := range text {
		if isWideRune(r) {
			width += 2
			continue
		}
		width++
	}
	return width
}

// isWideRune 判断字符是否属于东亚宽字符（全角/中日韩）。
// @param r 字符
// @returns 是否占两列
func isWideRune(r rune) bool {
	switch {
	case r >= 0x1100 && r <= 0x115F: // 韩文字母
		return true
	case r >= 0x2E80 && r <= 0xA4CF: // CJK 部首、假名、汉字
		return true
	case r >= 0xAC00 && r <= 0xD7A3: // 韩文音节
		return true
	case r >= 0xF900 && r <= 0xFAFF: // CJK 兼容汉字
		return true
	case r >= 0xFE30 && r <= 0xFE6F: // CJK 兼容形式
		return true
	case r >= 0xFF00 && r <= 0xFF60: // 全角 ASCII
		return true
	case r >= 0xFFE0 && r <= 0xFFE6: // 全角符号
		return true
	}
	return false
}
