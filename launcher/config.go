package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// configFileName 是与 exe 同目录（或安装根目录下）的配置文件名称。
const configFileName = "ledger.conf.json"

// launcherConfig 记录跨命令生效的目录设置，避免每次都重复传 --install-dir / --data。
type launcherConfig struct {
	InstallDir string `json:"installDir,omitempty"`
	DataDir    string `json:"dataDir,omitempty"`
}

// exeDir 返回可执行文件所在目录；失败返回空串。
//
// 解析符号链接是必需的：包管理器（winget 的 portable/ZIP 安装、Scoop 的 symlink 模式）
// 与手工建的快捷方式会把 exe 暴露成链接，未解析时会在链接所在目录里找不到同目录的
// node.exe / VERSION / node_modules，误报「运行时文件不完整」。
func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return resolveExeDir(exe)
}

// resolveExeDir 解析可执行文件路径中的符号链接并返回其所在目录（拆出来便于测试）。
// 解析失败（如路径不存在）时退回原路径的目录，行为与旧实现一致。
func resolveExeDir(exe string) string {
	if exe == "" {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil && resolved != "" {
		exe = resolved
	}
	return filepath.Dir(exe)
}

// readConfigIn 读取指定目录下的配置文件。
func readConfigIn(dir string) (launcherConfig, bool) {
	if dir == "" {
		return launcherConfig{}, false
	}
	raw, err := os.ReadFile(filepath.Join(dir, configFileName))
	if err != nil {
		return launcherConfig{}, false
	}
	var cfg launcherConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return launcherConfig{}, false
	}
	return cfg, true
}

// writeConfigIn 把配置写入指定目录；目录不可写时返回错误（调用方按尽力而为处理）。
func writeConfigIn(dir string, cfg launcherConfig) error {
	if dir == "" {
		return fmt.Errorf("目录为空")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	// 先写临时文件再改名，避免半截文件让后续命令解析失败。
	temp := filepath.Join(dir, configFileName+".tmp")
	if err := os.WriteFile(temp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(temp, filepath.Join(dir, configFileName))
}

// looksLikeHome 判断目录是否已经是台账安装根（据此把 exe 所在目录当成便携安装目录）。
func looksLikeHome(dir string) bool {
	if dir == "" {
		return false
	}
	return fileExists(filepath.Join(dir, "current.txt")) ||
		dirExists(filepath.Join(dir, "app")) ||
		dirExists(filepath.Join(dir, "data"))
}

// persistConfig 把生效配置写进安装根，并在 exe 不在安装根内时补一份旁挂配置，
// 使后续命令（ledger.exe status / cli …）无需再传 --install-dir。
func persistConfig(lay layout, cfg launcherConfig) {
	cfg.InstallDir = lay.home
	if err := writeConfigIn(lay.home, cfg); err != nil {
		fmt.Fprintf(errOut, "提示：无法写入配置文件 %s（%v），下次仍需手动指定 --install-dir。\n",
			filepath.Join(lay.home, configFileName), err)
	}
	dir := exeDir()
	if dir == "" || samePath(dir, lay.home) {
		return
	}
	// exe 在安装根之外：旁挂配置让「同一个 exe」后续命令仍指向本安装目录。
	// 默认安装目录（%LOCALAPPDATA%\ledger）不写，避免污染下载目录。
	if samePath(lay.home, defaultHome()) {
		return
	}
	_ = writeConfigIn(dir, cfg)
}

// samePath 比较两个路径是否指向同一位置（Windows 路径大小写不敏感）。
func samePath(left, right string) bool {
	a, errA := filepath.Abs(left)
	b, errB := filepath.Abs(right)
	if errA != nil || errB != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// effectiveDataDir 解析数据目录：--data > 配置文件 > <home>\data。
func effectiveDataDir(opts options, lay layout) (string, error) {
	if opts.dataDir != "" {
		abs, err := filepath.Abs(opts.dataDir)
		if err != nil {
			return "", fmt.Errorf("数据目录非法 %s：%w", opts.dataDir, err)
		}
		return abs, nil
	}
	if cfg, ok := readConfigIn(lay.home); ok && cfg.DataDir != "" {
		if abs, err := filepath.Abs(cfg.DataDir); err == nil {
			return abs, nil
		}
	}
	if cfg, ok := readConfigIn(exeDir()); ok && cfg.DataDir != "" && samePath(cfg.InstallDir, lay.home) {
		if abs, err := filepath.Abs(cfg.DataDir); err == nil {
			return abs, nil
		}
	}
	return lay.dataDir(), nil
}

// configFor 组装要持久化的配置：数据目录与默认值不同时才记录。
func configFor(lay layout, dataDir string) launcherConfig {
	cfg := launcherConfig{}
	if !samePath(dataDir, lay.dataDir()) {
		cfg.DataDir = dataDir
	}
	return cfg
}
