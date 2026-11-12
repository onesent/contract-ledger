package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// prepareRuntime 校验同目录运行时并解析状态根与数据目录。
func prepareRuntime(opts options) (layout, runtimeLayout, string, error) {
	runtimePath := runtimeDir()
	if err := verifyRuntime(runtimePath); err != nil {
		return layout{}, runtimeLayout{}, "", err
	}
	lay, err := resolveHome(opts.homeDir)
	if err != nil {
		return layout{}, runtimeLayout{}, "", err
	}
	dataDir, err := effectiveDataDir(opts, lay)
	if err != nil {
		return layout{}, runtimeLayout{}, "", err
	}
	// 记录生效目录，后续命令不必重复传参。
	persistConfig(lay, configFor(lay, dataDir))
	return lay, newRuntimeLayout(runtimePath), dataDir, nil
}

// hasFlag 判断参数列表中是否已包含某个选项。
func hasFlag(args []string, name string) bool {
	for _, arg := range args {
		if arg == name || strings.HasPrefix(arg, name+"=") {
			return true
		}
	}
	return false
}

// passthrough 把参数转发给同目录的 CLI 或服务入口，并透传退出码。
func passthrough(opts options, kind string) int {
	_, runtime, dataDir, err := prepareRuntime(opts)
	if err != nil {
		fmt.Fprintf(errOut, "执行失败：%v\n", err)
		return exitFailed
	}
	entry := runtime.entry(kind)
	if !fileExists(entry) {
		fmt.Fprintf(errOut, "运行时缺少入口 %s\n", entry)
		return exitFailed
	}
	args := append([]string{}, opts.rest...)
	if kind == "cli" && !hasFlag(args, "--data") {
		args = append(args, "--data", dataDir)
	}
	cmd := exec.Command(runtime.nodeExe(), append([]string{entry}, args...)...)
	cmd.Dir = runtime.dir
	// 子进程的输入输出：有控制台时用 CONIN$/CONOUT$，否则沿用继承的管道。
	// 注意 exec.Cmd 的 Stdout 为 nil 会丢弃输出，不能省略。
	cmd.Stdin = os.Stdin
	if consoleAttached {
		if console, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
			defer console.Close()
			cmd.Stdout = console
			cmd.Stderr = console
		}
		if input, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
			defer input.Close()
			cmd.Stdin = input
		}
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode()
		}
		fmt.Fprintf(errOut, "执行失败：%v\n", err)
		return exitFailed
	}
	return exitOK
}
