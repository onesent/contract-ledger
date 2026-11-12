package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// detachedProcess 让子进程脱离启动器的控制台，启动器退出后服务继续运行。
const detachedProcess = 0x00000008

// serverState 记录后台服务进程信息（run\ledger.pid）。
type serverState struct {
	PID       int    `json:"pid"`
	Port      int    `json:"port"`
	Version   string `json:"version"`
	StartedAt string `json:"startedAt"`
}

// readState 读取服务状态文件。
func readState(lay layout) (serverState, bool) {
	data, err := os.ReadFile(lay.statePath())
	if err != nil {
		return serverState{}, false
	}
	var state serverState
	if err := json.Unmarshal(data, &state); err != nil || state.PID <= 0 {
		return serverState{}, false
	}
	return state, true
}

// writeState 写入服务状态文件。
func writeState(lay layout, state serverState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return os.WriteFile(lay.statePath(), append(data, '\n'), 0o644)
}

// removeState 删除服务状态文件。
func removeState(lay layout) {
	_ = os.Remove(lay.statePath())
}

// processAlive 判断进程是否存活（用 OpenProcess 避免 PID 复用的假阳性判断依据）。
func processAlive(pid int) bool {
	const processQueryLimitedInformation = 0x1000
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false
	}
	syscall.CloseHandle(handle)
	return true
}

// portInUse 判断回环端口是否已被监听。
func portInUse(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// healthOK 请求健康端点，判断服务是否就绪。
func healthOK(port int) bool {
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// waitHealthy 轮询健康端点直到就绪或超时。
func waitHealthy(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if healthOK(port) {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("健康检查超时")
}

// startServer 在后台启动载荷内的服务进程，并记录状态。
func startServer(lay layout, runtimeDirPath, dataDir string, port int, logPath string) error {
	runtime := newRuntimeLayout(runtimeDirPath)
	if !fileExists(runtime.nodeExe()) {
		return fmt.Errorf("运行时缺少 node.exe：%s", runtime.nodeExe())
	}
	if !fileExists(runtime.entry("server")) {
		return fmt.Errorf("运行时缺少服务入口 %s", runtime.entry("server"))
	}
	if !fileExists(filepath.Join(runtime.webDir(), "index.html")) {
		return fmt.Errorf("运行时缺少前端产物 %s", filepath.Join(runtime.webDir(), "index.html"))
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("无法打开日志文件 %s：%w", logPath, err)
	}
	cmd := exec.Command(
		runtime.nodeExe(), runtime.entry("server"),
		"--data", dataDir,
		"--port", strconv.Itoa(port),
		"--web-dir", runtime.webDir(),
	)
	cmd.Dir = runtime.dir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess}
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("无法启动服务进程：%w", err)
	}
	state := serverState{
		PID:       cmd.Process.Pid,
		Port:      port,
		Version:   runtimeVersion(runtimeDirPath),
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_ = cmd.Process.Release()
	logFile.Close()
	return writeState(lay, state)
}

// killTree 用 taskkill 结束进程及其子进程。
func killTree(pid int) error {
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.CombinedOutput()
	if err != nil && processAlive(pid) {
		return fmt.Errorf("结束进程 %d 失败：%v（%s）", pid, err, strings.TrimSpace(string(output)))
	}
	return nil
}

// stopProcess 终止服务进程树并清理状态文件。
func stopProcess(lay layout, state serverState) error {
	err := killTree(state.PID)
	removeState(lay)
	if err != nil {
		return err
	}
	// 等到进程真正退出：Windows 在进程完全结束前仍锁定 node.exe，过早删除会 Access denied。
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(state.PID) && !portInUse(state.Port) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil
}

// openBrowser 用系统默认浏览器打开地址。
func openBrowser(url string) {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return
	}
	_ = cmd.Process.Release()
}
