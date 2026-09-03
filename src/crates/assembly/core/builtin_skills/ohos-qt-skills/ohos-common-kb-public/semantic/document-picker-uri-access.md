---
id: document-picker-uri-access
title: DocumentViewPicker URI 与访问授权
status: active
confidence: 0.7
sources: [{type: experience, name: "Tauri P2P app DocumentViewPicker 真机验证", date: 2026-08-06}]
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-06
review_by: null
superseded_by: null
tags: [document-picker, uri, fileuri, permission, fileshare, sandbox]
refs: [document-picker-uri-access-failure, application-sandbox-paths]
summary: "Picker 返回的是带授权语义的 URI；URI、转换后的 path、临时/持久读写授权必须分别处理。"
audience: public
---

# DocumentViewPicker URI 与访问授权

DocumentViewPicker 返回的值首先是 URI/capability，不是可无条件交给 POSIX `open`、Rust `std::fs` 或框架文件 API 的普通绝对路径。

## 三层语义

1. **URI identity**：描述用户选中的文档或目录；
2. **path representation**：某些 API 可把 URI 转成当前进程可用的路径表示；
3. **access grant**：允许的 read/write 操作、有效期和是否可持久化。

URI 转 path 不会自动扩大权限；选择文件与选择目录的授权模式也不能互相推断。

## 使用流程

1. 在 ArkTS/platform adapter 中调用 picker；
2. 保留原始 URI，检查取消/空结果/多选；
3. 按目标 API 使用 fileuri/fileShare 等平台能力解析和申请所需访问；
4. 只有当后端明确需要 path 且平台允许时，才把转换后的 path 传给 native/框架层；
5. 需要跨进程或重启后继续访问时，验证 persistPermission 的 mode、范围和失败行为；
6. 对 read、create、overwrite、rename、delete 和子目录访问分别测试。

## 安全边界

- 不根据 URI 字符串拼接任意路径；
- 不把一次用户选择视为整个目录树的永久全权限；
- 权限申请失败时回到用户可理解的重新选择或应用私有目录流程；
- 日志避免记录完整用户文件名、目录与 URI token。

## Adapter 边界

common 维护 URI/path/grant invariant。Tauri dialog plugin、Qt file dialog、JVM File 或 .NET stream 如何表达结果，留在框架仓，并保留其原始错误文本。

