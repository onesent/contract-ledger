package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// layout 描述状态根目录（data / logs / run / current.json）下的固定子目录。
// 程序本身不再复制到状态根：解压目录就是运行时，状态根只存业务数据与运行期文件。
type layout struct {
	home string
	// source 记录 home 的解析来源，供 status 展示与排障。
	source string
}

// defaultHome 返回默认状态根：%LOCALAPPDATA%\ledger（兜底用户配置目录）。
func defaultHome() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			return ""
		}
		base = dir
	}
	return filepath.Join(base, "ledger")
}

// resolveHome 解析状态根目录，优先级：
// --install-dir > LEDGER_HOME > exe 旁挂配置 installDir > exe 所在目录（便携布局）> %LOCALAPPDATA%\ledger。
func resolveHome(explicit string) (layout, error) {
	return resolveHomeWith(explicit, exeDir())
}

// resolveHomeWith 与 resolveHome 相同，但显式传入 exe 目录（便于测试）。
func resolveHomeWith(explicit, executableDir string) (layout, error) {
	candidate, source := explicit, "--install-dir"
	if candidate == "" {
		candidate, source = os.Getenv("LEDGER_HOME"), "环境变量 LEDGER_HOME"
	}
	if candidate == "" {
		if cfg, ok := readConfigIn(executableDir); ok && cfg.InstallDir != "" {
			candidate, source = cfg.InstallDir, "配置文件 "+filepath.Join(executableDir, configFileName)
		}
	}
	if candidate == "" && isPortableLayout(executableDir) {
		candidate, source = executableDir, "便携目录（exe 同目录）"
	}
	if candidate == "" {
		candidate, source = defaultHome(), "默认目录"
	}
	if candidate == "" {
		return layout{}, fmt.Errorf("无法确定用户目录；请用 --install-dir 指定状态目录")
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return layout{}, fmt.Errorf("状态目录非法 %s：%w", candidate, err)
	}
	return layout{home: abs, source: source}, nil
}

// isPortableLayout 判断 exe 目录是否已经带有便携布局的状态目录（data 或 run 或 current.json）。
func isPortableLayout(dir string) bool {
	if dir == "" {
		return false
	}
	return dirExists(filepath.Join(dir, "data")) ||
		dirExists(filepath.Join(dir, "run")) ||
		fileExists(filepath.Join(dir, "current.json"))
}

// dataDir 返回数据目录。
func (l layout) dataDir() string {
	return filepath.Join(l.home, "data")
}

// logsDir 返回日志目录。
func (l layout) logsDir() string {
	return filepath.Join(l.home, "logs")
}

// runDir 返回运行期状态目录。
func (l layout) runDir() string {
	return filepath.Join(l.home, "run")
}

// statePath 返回服务状态文件路径。
func (l layout) statePath() string {
	return filepath.Join(l.runDir(), "ledger.pid")
}

// currentPath 返回「上次运行」记录文件路径。
func (l layout) currentPath() string {
	return filepath.Join(l.home, "current.json")
}

// dirExists 判断路径是否为已存在的目录。
func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// fileExists 判断路径是否为已存在的文件。
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
