package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestResolveHomePrecedence 覆盖安装目录解析链：
// --install-dir > LEDGER_HOME > exe 旁挂配置 > exe 所在目录（已是安装根）> 默认目录。
func TestResolveHomePrecedence(t *testing.T) {
	exeDirPath := t.TempDir()
	flagDir := t.TempDir()
	envDir := t.TempDir()
	configDir := t.TempDir()

	t.Setenv("LEDGER_HOME", "")
	// 1) 显式 --install-dir 最高优先。
	lay, err := resolveHomeWith(flagDir, exeDirPath)
	if err != nil || !samePath(lay.home, flagDir) || lay.source != "--install-dir" {
		t.Fatalf("--install-dir 优先失败：%+v %v", lay, err)
	}

	// 2) 环境变量次之。
	t.Setenv("LEDGER_HOME", envDir)
	lay, err = resolveHomeWith("", exeDirPath)
	if err != nil || !samePath(lay.home, envDir) {
		t.Fatalf("LEDGER_HOME 优先失败：%+v %v", lay, err)
	}
	t.Setenv("LEDGER_HOME", "")

	// 3) exe 旁挂配置。
	if err := writeConfigIn(exeDirPath, launcherConfig{InstallDir: configDir}); err != nil {
		t.Fatalf("写配置失败：%v", err)
	}
	lay, err = resolveHomeWith("", exeDirPath)
	if err != nil || !samePath(lay.home, configDir) {
		t.Fatalf("配置文件优先失败：%+v %v", lay, err)
	}
	if lay.source == "" {
		t.Fatal("应记录解析来源")
	}

	// 4) 无配置时，exe 所在目录已是安装根则用它。
	bareExeDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(bareExeDir, "data"), 0o755); err != nil {
		t.Fatalf("建目录失败：%v", err)
	}
	lay, err = resolveHomeWith("", bareExeDir)
	if err != nil || !samePath(lay.home, bareExeDir) {
		t.Fatalf("exe 目录识别失败：%+v %v", lay, err)
	}

	// 5) 都没有时回落默认目录。
	lay, err = resolveHomeWith("", t.TempDir())
	if err != nil || !samePath(lay.home, defaultHome()) {
		t.Fatalf("默认目录回落失败：%+v %v", lay, err)
	}
}

// TestLooksLikeHome 覆盖安装根识别（只有 current.txt / app / data 才算）。
func TestLooksLikeHome(t *testing.T) {
	empty := t.TempDir()
	if looksLikeHome(empty) {
		t.Fatal("空目录不应识别为安装根")
	}
	withApp := t.TempDir()
	if err := os.MkdirAll(filepath.Join(withApp, "app", "1.0.0"), 0o755); err != nil {
		t.Fatalf("建目录失败：%v", err)
	}
	if !looksLikeHome(withApp) {
		t.Fatal("含 app 目录应识别为安装根")
	}
	withCurrent := t.TempDir()
	if err := os.WriteFile(filepath.Join(withCurrent, "current.txt"), []byte("1.0.0\n"), 0o644); err != nil {
		t.Fatalf("写文件失败：%v", err)
	}
	if !looksLikeHome(withCurrent) {
		t.Fatal("含 current.txt 应识别为安装根")
	}
	if looksLikeHome("") {
		t.Fatal("空路径不应识别为安装根")
	}
}

// TestEffectiveDataDir 覆盖数据目录解析链：--data > 配置文件 > <home>\data。
func TestEffectiveDataDir(t *testing.T) {
	home := t.TempDir()
	lay := layout{home: home, source: "--install-dir"}

	got, err := effectiveDataDir(options{}, lay)
	if err != nil || !samePath(got, filepath.Join(home, "data")) {
		t.Fatalf("默认数据目录失败：%s %v", got, err)
	}

	custom := filepath.Join(t.TempDir(), "mydata")
	if err := writeConfigIn(home, launcherConfig{InstallDir: home, DataDir: custom}); err != nil {
		t.Fatalf("写配置失败：%v", err)
	}
	got, err = effectiveDataDir(options{}, lay)
	if err != nil || !samePath(got, custom) {
		t.Fatalf("配置文件数据目录失败：%s %v", got, err)
	}

	flagDir := filepath.Join(t.TempDir(), "flagdata")
	got, err = effectiveDataDir(options{dataDir: flagDir}, lay)
	if err != nil || !samePath(got, flagDir) {
		t.Fatalf("--data 应最高优先：%s %v", got, err)
	}
}

// TestConfigRoundTrip 覆盖配置读写与「默认数据目录不入配置」。
func TestConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if _, ok := readConfigIn(dir); ok {
		t.Fatal("无文件时不应读到配置")
	}
	want := launcherConfig{InstallDir: dir, DataDir: `D:\data`}
	if err := writeConfigIn(dir, want); err != nil {
		t.Fatalf("写配置失败：%v", err)
	}
	got, ok := readConfigIn(dir)
	if !ok || got.InstallDir != want.InstallDir || got.DataDir != want.DataDir {
		t.Fatalf("配置读回不符：%+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, configFileName+".tmp")); err == nil {
		t.Fatal("临时文件应已改名")
	}

	lay := layout{home: dir}
	if cfg := configFor(lay, lay.dataDir()); cfg.DataDir != "" {
		t.Fatalf("默认数据目录不应写入配置：%+v", cfg)
	}
	if cfg := configFor(lay, filepath.Join(dir, "other")); cfg.DataDir == "" {
		t.Fatal("非默认数据目录应写入配置")
	}
}

// TestResolveExeDir 覆盖入口目录解析：普通路径取目录，符号链接（包管理器安装方式）取真实目录。
func TestResolveExeDir(t *testing.T) {
	if got := resolveExeDir(""); got != "" {
		t.Fatalf("空路径应返回空串，得到 %q", got)
	}

	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatalf("建目录失败：%v", err)
	}
	real := filepath.Join(appDir, "ledger.exe")
	if err := os.WriteFile(real, []byte("stub"), 0o644); err != nil {
		t.Fatalf("写文件失败：%v", err)
	}
	if got := resolveExeDir(real); !samePath(got, appDir) {
		t.Fatalf("普通路径解析失败：%s，期望 %s", got, appDir)
	}

	// winget / Scoop 这类安装方式会把 exe 以链接形式暴露在别处：
	// 必须解析回真实目录，否则同目录的 node.exe / VERSION 找不到。
	link := filepath.Join(root, "ledger-link.exe")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("无法创建符号链接（Windows 需开发者模式或管理员权限）：%v", err)
	}
	if got := resolveExeDir(link); !samePath(got, appDir) {
		t.Fatalf("符号链接未解析：%s，期望 %s", got, appDir)
	}
}
