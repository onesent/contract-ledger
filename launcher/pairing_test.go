package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestExtractPairingCode 覆盖日志中配对码的提取（含多次启动的多条记录）。
func TestExtractPairingCode(t *testing.T) {
	text := strings.Join([]string{
		"ledger-server 已启动：http://127.0.0.1:4517",
		"一次性配对码：A7Q4PYAZ（有效期 120 秒，过期时间 2026-01-01T00:02:00.000Z）",
		"ledger-server 已启动：http://127.0.0.1:4517",
		"一次性配对码：B2C3D4E5（有效期 120 秒，过期时间 2026-01-01T00:05:00.000Z）",
	}, "\n")
	code, ok := extractPairingCode(text)
	if !ok {
		t.Fatal("应能提取配对码")
	}
	if code != "B2C3D4E5" {
		t.Fatalf("应取最近一次配对码，实际为 %s", code)
	}
}

// TestExtractPairingCodeMissing 确认无配对码时返回 false。
func TestExtractPairingCodeMissing(t *testing.T) {
	if _, ok := extractPairingCode("ledger-server 已启动：http://127.0.0.1:4517"); ok {
		t.Fatal("无配对码时不应返回结果")
	}
	if _, ok := extractPairingCode(""); ok {
		t.Fatal("空文本不应返回结果")
	}
}

// TestReadTextMissing 确认读取不存在的文件返回空串。
func TestReadTextMissing(t *testing.T) {
	if got := readText(filepath.Join(t.TempDir(), "missing.log")); got != "" {
		t.Fatalf("期望空串，实际为 %q", got)
	}
}

// TestReadText 确认读取日志文件内容。
func TestReadText(t *testing.T) {
	file := filepath.Join(t.TempDir(), "server.log")
	if err := os.WriteFile(file, []byte("一次性配对码：ZZ99YY88\n"), 0o644); err != nil {
		t.Fatalf("写入失败：%v", err)
	}
	code, ok := extractPairingCode(readText(file))
	if !ok || code != "ZZ99YY88" {
		t.Fatalf("期望 ZZ99YY88，实际 %q（ok=%v）", code, ok)
	}
}

// TestResolveHome 覆盖安装根目录的解析顺序。
func TestResolveHome(t *testing.T) {
	explicit, err := resolveHome(t.TempDir())
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if !filepath.IsAbs(explicit.home) {
		t.Fatalf("安装根目录应为绝对路径，实际 %s", explicit.home)
	}
	if got, want := explicit.dataDir(), filepath.Join(explicit.home, "data"); got != want {
		t.Fatalf("数据目录为 %s，期望 %s", got, want)
	}

	t.Setenv("LEDGER_HOME", filepath.Join(t.TempDir(), "custom"))
	fromEnv, err := resolveHome("")
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if filepath.Base(fromEnv.home) != "custom" {
		t.Fatalf("应优先使用 LEDGER_HOME，实际 %s", fromEnv.home)
	}
}
