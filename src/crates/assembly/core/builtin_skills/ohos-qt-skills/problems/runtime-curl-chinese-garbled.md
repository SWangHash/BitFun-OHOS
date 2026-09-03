---
id: runtime-curl-chinese-garbled
type: problem
domain: runtime
tags: [curl, encoding, utf-8, git-bash, windows, gitcode-api, chinese, garbled]
created: 2026-06-10
updated: 2026-06-10
status: solved
audience: public
summary: "Windows Git Bash 下 curl 调 API 请求体中文显示为乱码（编码非 UTF-8）"
severity: medium

# ====== 检索关键字 ======
error_message: >
  curl 在 Windows Git Bash 环境下调用 API 时，请求体中的中文显示为乱码。
  例如 "知识库" 变成 "֪ʶ⽻"，"门禁" 变成 "Ž"。
  API 返回 200/201 但中文字段全部乱码。
error_code: "N/A"
keywords: [curl, 乱码, 中文, encoding, UTF-8, Git Bash, Windows, API, garbled, mojibake]
symptoms: "curl POST/PATCH 请求体中的中文字符在 API 端显示为乱码（如 Cyrillic 字符 ֪ʶ⽻）"

# ====== 问题详情 ======
environment: "Windows 10/11 + Git Bash (MSYS2) + curl 7.x/8.x"
refs: []
related_problems: []
---

# curl 中文乱码（Windows Git Bash 环境）

## 错误信息

```
# 期望: "feat: Qt for HarmonyOS 知识库完整交付 + 门禁 CI 体系"
# 实际: "feat: Qt for HarmonyOS ֪ʶ + Ž CI ϵ"
```

API 返回 200/201 成功，但 title/body 等字段中的中文全部变成乱码（通常是 Cyrillic 或 Latin-1 字符）。

## 根因分析

Windows Git Bash 的终端默认编码不是 UTF-8，当 curl 的 `-d` 参数直接包含中文时：

1. Shell 将中文以终端编码（如 GBK/CP936）传递给 curl
2. curl 将收到的字节原样发送到 HTTP 请求体
3. API 端按 UTF-8 解码 → 乱码

**关键**：即使设置了 `Content-Type: application/json; charset=utf-8`，curl 也不会自动转换编码——它只是透传字节。

## 解决方案

### 方案 A：写入临时文件 + `@file` 引用（推荐）

将 JSON 内容写入临时文件（确保文件本身是 UTF-8 编码），然后 curl 读取文件：

```bash
# 1. 用 heredoc 写入临时文件（heredoc 内容以 UTF-8 写入文件）
cat > /tmp/pr_data.json << 'JSONEOF'
{
  "title": "feat: Qt for HarmonyOS 知识库完整交付 + 门禁 CI 体系",
  "body": "描述内容..."
}
JSONEOF

# 2. curl 读取文件（文件本身是 UTF-8，curl 原样发送）
curl -s -X PATCH "https://gitcode.com/api/v5/repos/OWNER/REPO/pulls/1" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Authorization: Bearer TOKEN" \
  -d @/tmp/pr_data.json
```

### 方案 B：`chcp 65001` 切换终端编码

```bash
# 切换到 UTF-8 代码页后再执行 curl
chcp 65001 >nul 2>&1
curl -s -X PATCH "URL" -H "Content-Type: application/json; charset=utf-8" \
  -d '{"title": "中文标题"}'
```

> ⚠️ 方案 B 在某些 Git Bash 版本中不稳定，推荐方案 A。

### 方案 C：`printf` + 管道

```bash
printf '{"title":"中文标题"}' | curl -s -X PATCH "URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d @-
```

## GitCode API 补充经验

| 操作 | 方法 | 认证方式 | 端点 |
|------|------|---------|------|
| 创建 PR | `POST` | `Authorization: Bearer TOKEN` | `/api/v5/repos/{owner}/{repo}/pulls` |
| 更新 PR | `PATCH`（不是 PUT） | `Authorization: Bearer TOKEN` | `/api/v5/repos/{owner}/{repo}/pulls/{id}` |
| 认证失败 | 返回 `401 token not found` | 检查：用 `Bearer` 而非 `token` 前缀 | — |

### GitCode API 认证格式

```bash
# ✅ 正确
-H "Authorization: Bearer YOUR_TOKEN"

# ❌ 错误（返回 401）
-H "Authorization: token YOUR_TOKEN"
```

## 排查步骤

1. **确认乱码来源**：在 curl 命令中加 `-v`，查看 `> ` 开头的请求体是否为正确 UTF-8
2. **检查文件编码**：`file /tmp/pr_data.json` 应显示 `UTF-8`
3. **检查终端编码**：`echo $LANG` 查看当前 locale
4. **验证 API 端**：用 API 返回的 JSON 中的 title 字段确认是否已修复

## 可复用经验

1. **Windows + Git Bash + curl + 中文 = 必须用文件传递 JSON**，不要直接在 `-d` 参数中写中文
2. **GitCode API 更新 PR 用 PATCH**，不支持 PUT（返回 405）
3. **GitCode API 认证用 Bearer**，不支持 `token` 前缀（返回 401）
4. **API Token 安全**：Token 一旦暴露在对话/日志中，应立即撤销并重新生成

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 2026-06-10 创建 GitCode PR 时遇到的实际问题和解决方案 |
