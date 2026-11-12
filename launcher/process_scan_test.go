package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestImagePathUnder 覆盖路径归属判断（大小写、分隔符、前缀误判）。
func TestImagePathUnder(t *testing.T) {
	root := filepath.Join("C:\\", "Users", "u", "AppData", "Local", "ledger", "app")
	cases := []struct {
		image string
		want  bool
	}{
		{filepath.Join(root, "1.0.0", "node.exe"), true},
		{strings.ToUpper(filepath.Join(root, "1.0.0", "node.exe")), true},
		{filepath.Join(filepath.Dir(root), "app-evil", "node.exe"), false},
		{filepath.Join("C:", "Program Files", "nodejs", "node.exe"), false},
		{"", false},
	}
	for _, item := range cases {
		if got := imagePathUnder(root, item.image); got != item.want {
			t.Fatalf("imagePathUnder(%q) = %v，期望 %v", item.image, got, item.want)
		}
	}
}

// TestListProcessesUnderEmptyDir 目录不存在时不应找到任何进程。
func TestListProcessesUnderEmptyDir(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	if pids := listProcessesUnder(missing); len(pids) != 0 {
		t.Fatalf("不应找到进程，实际 %v", pids)
	}
}

// TestProcessImagePathSelf 能读到自身映像路径。
func TestProcessImagePathSelf(t *testing.T) {
	path := processImagePath(uint32(os.Getpid()))
	if path == "" {
		t.Skip("当前环境无法读取自身映像路径")
	}
	if !strings.HasSuffix(strings.ToLower(path), ".test.exe") && !strings.HasSuffix(strings.ToLower(path), ".exe") {
		t.Fatalf("自身映像路径异常：%s", path)
	}
}
