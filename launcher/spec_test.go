package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSpecMatchesDispatch 断言「声明了子命令」与「实现了处理函数」完全一致，
// 防止新增/删除子命令时只改了一边。
func TestSpecMatchesDispatch(t *testing.T) {
	for _, spec := range commandSpecs {
		if _, ok := dispatch[spec.Name]; !ok {
			t.Fatalf("子命令 %s 已声明但没有处理函数", spec.Name)
		}
	}
	for name := range dispatch {
		if _, ok := commandByName(name); !ok {
			t.Fatalf("子命令 %s 有处理函数但未在 commandSpecs 中声明", name)
		}
	}
}

// TestUsageRendersEveryVisibleCommand 断言帮助文本覆盖所有非隐藏子命令与选项。
func TestUsageRendersEveryVisibleCommand(t *testing.T) {
	text := usage()
	for _, spec := range commandSpecs {
		if spec.Hidden {
			if strings.Contains(text, spec.Usage) {
				t.Fatalf("隐藏子命令 %s 不应出现在帮助里", spec.Name)
			}
			continue
		}
		if !strings.Contains(text, spec.Usage) {
			t.Fatalf("帮助缺少子命令用法：%s", spec.Usage)
		}
		if !strings.Contains(text, spec.Summary) {
			t.Fatalf("帮助缺少子命令说明：%s", spec.Name)
		}
	}
	for _, opt := range optionSpecs {
		if !strings.Contains(text, opt.Flag) {
			t.Fatalf("帮助缺少选项：%s", opt.Flag)
		}
	}
}

// TestSpecJSONCoversDefaultsAndExitCodes 断言 spec 输出包含默认子命令与全部退出码。
func TestSpecJSONCoversDefaultsAndExitCodes(t *testing.T) {
	doc := specJSON()
	if len(doc.Commands) != len(commandSpecs) {
		t.Fatalf("spec 命令数不符：%d != %d", len(doc.Commands), len(commandSpecs))
	}
	defaults := 0
	for _, spec := range doc.Commands {
		if spec.Default {
			defaults++
		}
	}
	if defaults != 1 {
		t.Fatalf("默认子命令必须有且只有一个，实际 %d 个", defaults)
	}
	if len(doc.ExitCodes) != len(exitCodes) {
		t.Fatalf("spec 退出码数不符：%d != %d", len(doc.ExitCodes), len(exitCodes))
	}
}

// TestSpecJSONFileIsUpToDate 断言提交在仓库里的 launcher/spec.json 与代码一致。
// 文档漂移检查（scripts/docs-drift.test.mjs）读这份产物，因此必须同步提交；
// 改动命令面后执行：npm run spec:launcher
func TestSpecJSONFileIsUpToDate(t *testing.T) {
	path := "spec.json"
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取 %s 失败：%v（执行 npm run spec:launcher 生成）", path, err)
	}
	current := strings.TrimSpace(string(raw))
	expected, err := marshalSpec()
	if err != nil {
		t.Fatalf("序列化 spec 失败：%v", err)
	}
	if current != expected {
		t.Fatalf("%s 与代码不一致，执行 npm run spec:launcher 重新生成后提交", filepath.Base(path))
	}
}
