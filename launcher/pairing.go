package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// pairingCodePattern 匹配服务启动日志中的一次性配对码（8 位大写字母与数字）。
var pairingCodePattern = regexp.MustCompile(`一次性配对码：([0-9A-Z]{8})`)

// healthBody 是健康端点中启动器关心的字段。
type healthBody struct {
	OK     bool `json:"ok"`
	Paired bool `json:"paired"`
}

// extractPairingCode 从日志文本中提取最近一次打印的配对码。
func extractPairingCode(text string) (string, bool) {
	matches := pairingCodePattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return "", false
	}
	return matches[len(matches)-1][1], true
}

// readText 读取文本文件；读取失败返回空串。
func readText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}

// lastLogLine 返回日志文件最后一条非空行（用于启动失败提示）。
func lastLogLine(path string) string {
	lines := strings.Split(strings.TrimSpace(readText(path)), "\n")
	for index := len(lines) - 1; index >= 0; index -= 1 {
		line := strings.TrimSpace(lines[index])
		if line != "" {
			return line
		}
	}
	return ""
}

// healthPaired 查询健康端点，判断是否已有有效浏览器会话。
func healthPaired(port int) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return true
	}
	var body healthBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return true
	}
	return body.Paired
}

// pairingMessage 生成首次配对提示文案。
func pairingMessage(code, url string) string {
	return fmt.Sprintf(
		"配对码：%s\n\n"+
			"请在已打开的页面（%s）中输入该配对码完成配对。\n"+
			"配对码 120 秒内有效；若已过期，请关闭本提示后执行：\n"+
			"  ledger.exe stop\n"+
			"然后重新双击启动。",
		code, url,
	)
}
