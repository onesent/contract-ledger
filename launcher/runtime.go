package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// runtimeDir 返回运行时根目录：与 exe 同目录。分发包解压后即自包含，
// 启动器不再把载荷解压到别处（zip 内已经是可运行内容，exe 只是入口）。
func runtimeDir() string {
	return exeDir()
}

// runtimeLayout 描述运行时目录内的关键路径。
type runtimeLayout struct {
	dir string
}

// newRuntimeLayout 构造运行时布局。
func newRuntimeLayout(dir string) runtimeLayout {
	return runtimeLayout{dir: dir}
}

// nodeExe 返回运行时自带的 node.exe。
func (r runtimeLayout) nodeExe() string {
	return filepath.Join(r.dir, "node.exe")
}

// versionFile 返回 VERSION 文件路径。
func (r runtimeLayout) versionFile() string {
	return filepath.Join(r.dir, "VERSION")
}

// entry 返回某个包的命令行入口。
func (r runtimeLayout) entry(pkg string) string {
	return filepath.Join(r.dir, "node_modules", "@ledger", pkg, "dist", "bin.js")
}

// webDir 返回前端产物目录。
func (r runtimeLayout) webDir() string {
	return filepath.Join(r.dir, "packages", "web", "dist")
}

// migrationsDir 返回迁移目录（仅用于自检提示）。
func (r runtimeLayout) migrationsDir() string {
	return filepath.Join(r.dir, "node_modules", "@ledger", "storage-sqlite", "migrations")
}

// requiredEntry 描述一项运行时自检项。
type requiredEntry struct {
	path  string
	label string
}

// verifyRuntime 校验 exe 同目录的运行时是否完整；缺失时返回中文提示。
func verifyRuntime(dir string) error {
	if dir == "" {
		return fmt.Errorf("无法定位可执行文件所在目录")
	}
	runtime := newRuntimeLayout(dir)
	required := []requiredEntry{
		{runtime.nodeExe(), "node.exe"},
		{runtime.versionFile(), "VERSION"},
		{runtime.entry("server"), "node_modules/@ledger/server/dist/bin.js"},
		{runtime.entry("cli"), "node_modules/@ledger/cli/dist/bin.js"},
		{filepath.Join(runtime.webDir(), "index.html"), "packages/web/dist/index.html"},
		{filepath.Join(runtime.migrationsDir(), "001_init.sql"), "node_modules/@ledger/storage-sqlite/migrations/001_init.sql"},
	}
	missing := make([]string, 0, len(required))
	for _, item := range required {
		if !fileExists(item.path) {
			missing = append(missing, item.label)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf(
			"运行时文件不完整（缺少 %s）。\n请把分发包 zip 完整解压后再运行 ledger.exe：%s",
			strings.Join(missing, "、"), dir,
		)
	}
	return nil
}

// runtimeVersion 读取运行时版本：优先 VERSION 文件（分发包内），退回编译期注入的版本。
func runtimeVersion(dir string) string {
	if dir != "" {
		if raw, err := os.ReadFile(filepath.Join(dir, "VERSION")); err == nil {
			if trimmed := strings.TrimSpace(string(raw)); trimmed != "" {
				return trimmed
			}
		}
	}
	return version
}
