package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// backupEnvelope 是 CLI `backup` 命令输出信封中启动器关心的字段。
type backupEnvelope struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Path  string `json:"path"`
		Bytes int64  `json:"bytes"`
	} `json:"data"`
}

// installState 记录「上次成功启动」的版本与运行时目录，写在状态根 current.json。
// 参照 VS Code 便携模式：程序目录可以随便换，状态（数据/日志/上次运行）集中在状态根。
type installState struct {
	Version    string `json:"version,omitempty"`
	InstallDir string `json:"installDir,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}

// readInstallState 读取上次运行记录；不存在时返回零值。
func readInstallState(lay layout) installState {
	raw, err := os.ReadFile(lay.currentPath())
	if err != nil {
		return installState{}
	}
	var state installState
	if err := json.Unmarshal(raw, &state); err != nil {
		return installState{}
	}
	return state
}

// writeInstallState 写入上次运行记录。
func writeInstallState(lay layout, state installState) error {
	if err := os.MkdirAll(lay.home, 0o755); err != nil {
		return err
	}
	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	temp := lay.currentPath() + ".tmp"
	if err := os.WriteFile(temp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(temp, lay.currentPath())
}

// backupBeforeUpgrade 用运行时内的 CLI 生成一致性备份，并改名为可识别的升级备份。
func backupBeforeUpgrade(runtimeDirPath, dataDir, fromVersion string) (string, error) {
	runtime := newRuntimeLayout(runtimeDirPath)
	if !fileExists(runtime.nodeExe()) {
		return "", fmt.Errorf("运行时缺少 node.exe：%s", runtime.nodeExe())
	}
	if !fileExists(runtime.entry("cli")) {
		return "", fmt.Errorf("运行时缺少 CLI 入口：%s", runtime.entry("cli"))
	}
	cmd := exec.Command(runtime.nodeExe(), runtime.entry("cli"), "backup", "--data", dataDir, "--json")
	cmd.Dir = runtimeDirPath
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		// CLI 失败时会把原因写进 stdout 的 JSON 信封（如 BACKUP_FAILED），优先用它。
		reason := failureReason(output)
		if reason == "" {
			reason = err.Error()
		}
		return "", fmt.Errorf("升级前备份失败：%s%s", reason, detailText(stderr.String()))
	}
	var envelope backupEnvelope
	if err := json.Unmarshal(output, &envelope); err != nil {
		return "", fmt.Errorf("升级前备份输出无法解析：%v", err)
	}
	if !envelope.OK || envelope.Data.Path == "" {
		return "", fmt.Errorf("升级前备份失败：%s%s", envelope.Code, envelope.Message)
	}
	return renameUpgradeBackup(envelope.Data.Path, fromVersion)
}

// failureReason 从 CLI 失败输出的 JSON 信封中提取可读原因；解析不出来时返回空串。
func failureReason(output []byte) string {
	var envelope backupEnvelope
	if err := json.Unmarshal(output, &envelope); err != nil {
		return ""
	}
	parts := make([]string, 0, 2)
	if envelope.Code != "" {
		parts = append(parts, envelope.Code)
	}
	if envelope.Message != "" {
		parts = append(parts, envelope.Message)
	}
	return strings.Join(parts, "：")
}

// detailText 把子进程 stderr 拼成简短补充说明。
func detailText(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > 400 {
		trimmed = trimmed[:400] + "…"
	}
	return "（" + trimmed + "）"
}

// renameUpgradeBackup 把 ledger-<stamp>.db 改名为 upgrade-<from>-<stamp>.db。
func renameUpgradeBackup(path, fromVersion string) (string, error) {
	base := filepath.Base(path)
	stamp := strings.TrimSuffix(strings.TrimPrefix(base, "ledger-"), ".db")
	if stamp == base || stamp == "" {
		stamp = strings.TrimSuffix(base, ".db")
	}
	from := fromVersion
	if from == "" {
		from = "unknown"
	}
	target := filepath.Join(filepath.Dir(path), fmt.Sprintf("upgrade-%s-%s.db", from, stamp))
	if err := os.Rename(path, target); err != nil {
		// 改名失败不影响备份本身，保留原文件名。
		return path, nil
	}
	return target, nil
}

// fallbackText 返回文本或占位符。
func fallbackText(value, placeholder string) string {
	if strings.TrimSpace(value) == "" {
		return placeholder
	}
	return value
}
