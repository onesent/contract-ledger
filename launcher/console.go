package main

import (
	"fmt"
	"io"
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	user32                    = syscall.NewLazyDLL("user32.dll")
	procAttachConsole         = kernel32.NewProc("AttachConsole")
	procGetStdHandle          = kernel32.NewProc("GetStdHandle")
	procGetConsoleMode        = kernel32.NewProc("GetConsoleMode")
	procWriteConsoleW         = kernel32.NewProc("WriteConsoleW")
	procSetConsoleOutputCP    = kernel32.NewProc("SetConsoleOutputCP")
	procGetConsoleOutputCP    = kernel32.NewProc("GetConsoleOutputCP")
	procGetConsoleProcessList = kernel32.NewProc("GetConsoleProcessList")
	procMessageBoxW           = user32.NewProc("MessageBoxW")
)

// 标准句柄常量（(DWORD)-11 / (DWORD)-12）。
const (
	stdOutputHandle = 0xFFFFFFF5
	stdErrorHandle  = 0xFFFFFFF4
)

// out 与 errOut 是面向用户的输出目标。
// 控制台场景下经 WriteConsoleW 输出，避免控制台代码页（如 936）把 UTF-8 字节渲染成乱码。
var (
	out    io.Writer = os.Stdout
	errOut io.Writer = os.Stderr
)

// consoleAttached 记录是否已获得可用的控制台输出。
var consoleAttached bool

// stdoutWritable 记录标准输出句柄是否可用（管道、文件、控制台都算）。
var stdoutWritable bool

// originalCodePage 是进入时控制台的输出代码页（0 表示未知）；退出时恢复，避免污染调用方会话。
var originalCodePage uint32

// guiDisabled 判断是否禁用消息框（自动化测试用 LEDGER_NO_GUI=1）。
func guiDisabled() bool {
	return os.Getenv("LEDGER_NO_GUI") != ""
}

// interactiveGUI 判断是否应以弹窗方式与用户交互：完全没有控制台，或控制台只属于本进程
// （双击启动时 Windows 会为控制台子系统新建一个只含本进程的控制台，窗口在进程退出后关闭，
// 打印内容用户来不及看，因此改用消息框）。
func interactiveGUI() bool {
	if guiDisabled() {
		return false
	}
	if !consoleAttached {
		// 没有控制台：能写管道/文件（重定向、mintty）时照常打印，否则只能弹框。
		return !stdoutWritable
	}
	buffer := make([]uint32, 4)
	count, _, _ := procGetConsoleProcessList.Call(uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	return count <= 1
}

// consoleWriter 通过 WriteConsoleW 把 UTF-8 文本写入控制台，与代码页无关。
type consoleWriter struct {
	handle uintptr
}

// Write 实现 io.Writer：转换为 UTF-16 后交给控制台；转换失败时退回原始字节写入。
func (w consoleWriter) Write(p []byte) (int, error) {
	text, err := syscall.UTF16FromString(string(p))
	if err != nil {
		return os.Stdout.Write(p)
	}
	text = text[:len(text)-1] // 去掉 UTF16FromString 追加的终止符
	if len(text) == 0 {
		return len(p), nil
	}
	var written uint32
	ok, _, _ := procWriteConsoleW.Call(
		w.handle,
		uintptr(unsafe.Pointer(&text[0])),
		uintptr(len(text)),
		uintptr(unsafe.Pointer(&written)),
		0,
	)
	if ok == 0 {
		return os.Stdout.Write(p)
	}
	return len(p), nil
}

// stdHandle 返回标准句柄；无效（NULL 或 INVALID_HANDLE_VALUE）时返回 0。
func stdHandle(id uintptr) uintptr {
	handle, _, _ := procGetStdHandle.Call(id)
	if handle == 0 || handle == ^uintptr(0) {
		return 0
	}
	return handle
}

// isConsole 判断句柄是否指向控制台（管道与文件返回 false）。
func isConsole(handle uintptr) bool {
	if handle == 0 {
		return false
	}
	var mode uint32
	ok, _, _ := procGetConsoleMode.Call(handle, uintptr(unsafe.Pointer(&mode)))
	return ok != 0
}

// setupConsole 准备用户可见输出。
// 仅在标准输出与错误都无效（双击启动）时附加父进程控制台；
// 已继承句柄（cmd 管道、重定向到文件）时保持原样，避免把重定向内容写到控制台。
func setupConsole() {
	stdout := stdHandle(stdOutputHandle)
	stderr := stdHandle(stdErrorHandle)
	if stdout == 0 && stderr == 0 {
		const attachParentProcess = ^uintptr(0)
		if result, _, _ := procAttachConsole.Call(attachParentProcess); result == 0 {
			return
		}
		stdout = stdHandle(stdOutputHandle)
		stderr = stdHandle(stdErrorHandle)
	}
	if isConsole(stdout) {
		out = consoleWriter{handle: stdout}
	}
	if isConsole(stderr) {
		errOut = consoleWriter{handle: stderr}
	}
	consoleAttached = isConsole(stdout) || isConsole(stderr)
	stdoutWritable = stdout != 0 || stderr != 0
	if consoleAttached {
		// 有控制台时把输出代码页切到 UTF-8：本进程经 WriteConsoleW 输出与代码页无关，
		// 但同一控制台里被管道转发的字节（如 `| more`）仍按代码页解码，切到 65001 才不会乱码。
		if current, _, _ := procGetConsoleOutputCP.Call(); current != 0 && current != 65001 {
			originalCodePage = uint32(current)
			procSetConsoleOutputCP.Call(65001)
		}
	}
}

// restoreConsoleCodePage 恢复进入时的控制台输出代码页。
func restoreConsoleCodePage() {
	if originalCodePage != 0 {
		procSetConsoleOutputCP.Call(uintptr(originalCodePage))
		originalCodePage = 0
	}
}

// showError 在无控制台时用消息框呈现错误，保证双击场景下用户可见。
func showError(title, text string) {
	showMessageBox(title, text, 0x10)
}

// showInfo 呈现提示信息：命令行下直接打印，双击场景下弹消息框。
func showInfo(title, text string) {
	if consoleAttached || guiDisabled() {
		fmt.Fprintf(out, "%s\n%s\n", title, text)
		return
	}
	showMessageBox(title, text, 0x40)
}

// showMessageBox 弹出消息框（无控制台且未禁用 GUI 时）。
func showMessageBox(title, text string, flags uintptr) {
	if !interactiveGUI() {
		return
	}
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	textPtr, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(textPtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		flags,
	)
}

// reportUsage 输出用法错误（命令行有控制台时只打印，双击时弹框）。
func reportUsage(err error) {
	fmt.Fprintf(errOut, "%v\n\n%s", err, usage())
	showError("参数错误", err.Error())
}
