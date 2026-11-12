package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// processExitWait 是等待被结束进程真正退出的上限。
const processExitWait = 10 * time.Second

var (
	procCreateToolhelp32Snapshot   = kernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW            = kernel32.NewProc("Process32FirstW")
	procProcess32NextW             = kernel32.NewProc("Process32NextW")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
)

// 快照与句柄常量。
const (
	th32csSnapProcess  = 0x00000002
	invalidHandleValue = ^uintptr(0)
)

// processEntry32 对应 Win32 PROCESSENTRY32W。
type processEntry32 struct {
	Size            uint32
	CntUsage        uint32
	ProcessID       uint32
	DefaultHeapID   uintptr
	ModuleID        uint32
	CntThreads      uint32
	ParentProcessID uint32
	PriClassBase    int32
	Flags           uint32
	ExeFile         [260]uint16
}

// imagePathUnder 判断进程映像路径是否位于指定目录之下（大小写不敏感）。
func imagePathUnder(dir, image string) bool {
	if image == "" {
		return false
	}
	prefix := strings.ToLower(filepath.Clean(dir))
	candidate := strings.ToLower(filepath.Clean(image))
	return candidate == prefix || strings.HasPrefix(candidate, prefix+string(os.PathSeparator))
}

// processImagePath 返回进程映像完整路径；无权限或进程已退出时返回空串。
func processImagePath(pid uint32) string {
	const processQueryLimitedInformation = 0x1000
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return ""
	}
	defer syscall.CloseHandle(handle)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	ok, _, _ := procQueryFullProcessImageNameW.Call(
		uintptr(handle),
		0,
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer[:size])
}

// listProcessesUnder 列出映像路径位于 dir 之下的进程 pid。
func listProcessesUnder(dir string) []int {
	snapshot, _, _ := procCreateToolhelp32Snapshot.Call(th32csSnapProcess, 0)
	if snapshot == invalidHandleValue {
		return nil
	}
	defer syscall.CloseHandle(syscall.Handle(snapshot))

	self := uint32(os.Getpid())
	entry := processEntry32{Size: uint32(unsafe.Sizeof(processEntry32{}))}
	found := make([]int, 0, 4)
	ok, _, _ := procProcess32FirstW.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	for ok != 0 {
		pid := entry.ProcessID
		if pid != 0 && pid != self && imagePathUnder(dir, processImagePath(pid)) {
			found = append(found, int(pid))
		}
		ok, _, _ = procProcess32NextW.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	}
	return found
}

// killProcessesUnder 终止映像路径位于 dir 之下的所有进程，返回结束的进程数。
// 用途：旧版本残留进程会锁住 app\<版本>\node.exe，导致清理/卸载 Access denied；
// 不能只依赖 run\ledger.pid（升级后该文件已被新版本覆盖）。
func killProcessesUnder(dir string) int {
	killed := 0
	for _, pid := range listProcessesUnder(dir) {
		if err := killTree(pid); err == nil {
			killed += 1
		}
	}
	if killed > 0 {
		// 等进程真正退出：Windows 在进程完全结束前仍锁定映像文件。
		deadline := time.Now().Add(processExitWait)
		for time.Now().Before(deadline) && len(listProcessesUnder(dir)) > 0 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	return killed
}
