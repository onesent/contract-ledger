package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRenameUpgradeBackup 确认备份文件被改名为可识别的 upgrade-<版本>-<时间戳>.db。
func TestRenameUpgradeBackup(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "ledger-20260101-010203-000.db")
	if err := os.WriteFile(source, []byte("db"), 0o644); err != nil {
		t.Fatalf("写文件失败：%v", err)
	}
	got, err := renameUpgradeBackup(source, "0.9.0")
	if err != nil {
		t.Fatalf("改名失败：%v", err)
	}
	want := filepath.Join(dir, "upgrade-0.9.0-20260101-010203-000.db")
	if got != want {
		t.Fatalf("改名结果 %s，期望 %s", got, want)
	}
	if !fileExists(want) {
		t.Fatal("改名后文件不存在")
	}
}

// TestInstallStateRoundTrip 覆盖 current.json 读写与损坏容错。
func TestInstallStateRoundTrip(t *testing.T) {
	lay := layout{home: t.TempDir()}
	if state := readInstallState(lay); state.Version != "" {
		t.Fatalf("无文件时应返回零值，实际 %+v", state)
	}
	want := installState{Version: "1.2.3", InstallDir: `D:\ledger-1.2.3-win-x64`}
	if err := writeInstallState(lay, want); err != nil {
		t.Fatalf("写入失败：%v", err)
	}
	got := readInstallState(lay)
	if got.Version != want.Version || got.InstallDir != want.InstallDir || got.UpdatedAt == "" {
		t.Fatalf("读回不符：%+v", got)
	}
	if err := os.WriteFile(lay.currentPath(), []byte("{不是 json"), 0o644); err != nil {
		t.Fatalf("写坏文件失败：%v", err)
	}
	if state := readInstallState(lay); state.Version != "" {
		t.Fatalf("损坏文件应返回零值，实际 %+v", state)
	}
}

// TestHasFlag 覆盖参数中选项存在性判断。
func TestHasFlag(t *testing.T) {
	args := []string{"contract", "list", "--json", "--data", `E:\tmp`}
	if !hasFlag(args, "--json") || !hasFlag(args, "--data") {
		t.Fatal("应识别出 --json 与 --data")
	}
	if hasFlag(args, "--web-dir") {
		t.Fatal("不应识别出不存在的选项")
	}
	if !hasFlag([]string{"--data=E:\\tmp"}, "--data") {
		t.Fatal("应识别 --data=VALUE 形式")
	}
}

// TestVerifyRuntime 覆盖运行时自检（缺文件时报出中文清单）。
func TestVerifyRuntime(t *testing.T) {
	dir := t.TempDir()
	if err := verifyRuntime(dir); err == nil {
		t.Fatal("空目录应校验失败")
	}
	writeRuntimeFixture(t, dir)
	if err := verifyRuntime(dir); err != nil {
		t.Fatalf("完整运行时不应报错：%v", err)
	}
	if got := runtimeVersion(dir); got != "9.9.9" {
		t.Fatalf("版本应读自 VERSION，实际 %s", got)
	}
}

// writeRuntimeFixture 造一个自检通过的运行时目录。
func writeRuntimeFixture(t *testing.T, dir string) {
	t.Helper()
	files := []string{
		"node.exe",
		"VERSION",
		filepath.Join("node_modules", "@ledger", "server", "dist", "bin.js"),
		filepath.Join("node_modules", "@ledger", "cli", "dist", "bin.js"),
		filepath.Join("packages", "web", "dist", "index.html"),
		filepath.Join("node_modules", "@ledger", "storage-sqlite", "migrations", "001_init.sql"),
	}
	for _, name := range files {
		target := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatalf("建目录失败：%v", err)
		}
		content := "x"
		if name == "VERSION" {
			content = "9.9.9\n"
		}
		if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
			t.Fatalf("写文件失败：%v", err)
		}
	}
}
