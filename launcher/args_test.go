package main

import (
	"reflect"
	"testing"
)

// TestParseArgsDispatch 覆盖子命令与参数解析。
func TestParseArgsDispatch(t *testing.T) {
	opts, err := parseArgs([]string{"--port", "4600", "--install-dir", `D:\ledger`, "--no-browser"})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if opts.command != "start" || opts.port != 4600 || opts.homeDir != `D:\ledger` || !opts.noBrowser {
		t.Fatalf("解析结果不符：%+v", opts)
	}

	opts, err = parseArgs([]string{"stop"})
	if err != nil || opts.command != "stop" {
		t.Fatalf("stop 解析失败：%v %+v", err, opts)
	}

}

// TestParseArgsPassthrough 确认 cli / server 后续参数原样保留。
func TestParseArgsPassthrough(t *testing.T) {
	opts, err := parseArgs([]string{"cli", "contract", "list", "--json", "--data", `E:\tmp`})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if opts.command != "cli" {
		t.Fatalf("子命令应为 cli，实际 %s", opts.command)
	}
	want := []string{"contract", "list", "--json", "--data", `E:\tmp`}
	if !reflect.DeepEqual(opts.rest, want) {
		t.Fatalf("转发参数应为 %v，实际 %v", want, opts.rest)
	}

	opts, err = parseArgs([]string{"server", "--port", "4601"})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if !reflect.DeepEqual(opts.rest, []string{"--port", "4601"}) {
		t.Fatalf("server 转发参数不符：%v", opts.rest)
	}
}

// TestParseArgsErrors 覆盖非法参数。
func TestParseArgsErrors(t *testing.T) {
	cases := [][]string{
		{"--port", "0"},
		{"--port", "70000"},
		{"--port"},
		{"--unknown"},
	}
	for _, argv := range cases {
		if _, err := parseArgs(argv); err == nil {
			t.Fatalf("应报错：%v", argv)
		}
	}
	if opts, err := parseArgs([]string{"--version"}); err != nil || opts.command != "version" {
		t.Fatalf("--version 应映射为 version：%v %+v", err, opts)
	}
	if opts, err := parseArgs([]string{"--help"}); err != nil || opts.command != "help" {
		t.Fatalf("--help 应映射为 help：%v %+v", err, opts)
	}
}

// TestParseArgsCommandAnywhere 确认子命令与选项顺序无关（曾因「选项在前」导致所有子命令报未知参数）。
func TestParseArgsCommandAnywhere(t *testing.T) {
	cases := []struct {
		argv    []string
		command string
		homeDir string
		port    int
	}{
		{[]string{"--install-dir", `D:\ledger`, "status"}, "status", `D:\ledger`, defaultPort},
		{[]string{"status", "--install-dir", `D:\ledger`}, "status", `D:\ledger`, defaultPort},
		{[]string{"--port", "4602", "stop"}, "stop", "", 4602},
		{[]string{"--install-dir=D:\\l2", "rollback"}, "rollback", `D:\l2`, defaultPort},
		{[]string{"--port=4603", "start", "--no-browser"}, "start", "", 4603},
	}
	for _, item := range cases {
		opts, err := parseArgs(item.argv)
		if err != nil {
			t.Fatalf("%v 解析失败：%v", item.argv, err)
		}
		if opts.command != item.command || opts.homeDir != item.homeDir || opts.port != item.port {
			t.Fatalf("%v 解析结果不符：%+v", item.argv, opts)
		}
	}
}

// TestParseArgsCliAfterOptions 确认 cli 前面的启动器选项被消费，后面的原样转发。
func TestParseArgsCliAfterOptions(t *testing.T) {
	opts, err := parseArgs([]string{"--install-dir", `D:\ledger`, "cli", "contract", "list", "--json"})
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if opts.command != "cli" || opts.homeDir != `D:\ledger` {
		t.Fatalf("解析结果不符：%+v", opts)
	}
	if !reflect.DeepEqual(opts.rest, []string{"contract", "list", "--json"}) {
		t.Fatalf("转发参数不符：%v", opts.rest)
	}
}

// TestParseArgsPortable 确认 --portable 被解析且与子命令顺序无关。
func TestParseArgsPortable(t *testing.T) {
	opts, err := parseArgs([]string{"--portable", "start", "--no-browser"})
	if err != nil || !opts.portable || opts.command != "start" {
		t.Fatalf("--portable 解析失败：%v %+v", err, opts)
	}
	opts, err = parseArgs([]string{"status", "--portable"})
	if err != nil || !opts.portable || opts.command != "status" {
		t.Fatalf("--portable 后置解析失败：%v %+v", err, opts)
	}
}
