---
id: document-picker-uri-access-failure
title: "DocumentViewPicker 结果无法读取或写入"
status: active
confidence: 0.7
sources: [{type: experience, name: "Tauri P2P app 文件/目录选择真机验证", date: 2026-08-06}]
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-06
superseded_by: null
tags: [problem, document-picker, uri, fileuri, permission]
refs: [document-picker-uri-access]
summary: "Picker URI 被当普通 path，或转换 path 后缺少所需 read/write grant，导致 not found/permission denied。"
audience: public
error_message: |
  Path is neither a file nor a directory
  No such file or directory
  Permission denied
---

# DocumentViewPicker 结果无法读取或写入

## 症状与原因

- 后端把 `file://docs/...` 等 URI 直接传给普通 filesystem API，返回不存在；
- URI 转换成 path 后读取成功但写入失败；
- 应用重启后原先可访问的选择失效。

根因是 URI、path representation 与 access grant 被混成一个值。转换字符串不等于获得读写或持久权限。

## 解决方案

1. 回到 picker adapter，保留原 URI；
2. 使用目标 SDK 的 fileuri/fileShare 等 API 完成解析；
3. 按业务申请 read/write mode，并只在平台支持且确有需要时持久化；
4. 将可用 handle/path 与明确权限范围传给后端；
5. 分别验证文件、目录、取消、重启、权限撤销和目标被删除。

## 预防措施

IPC/bridge 类型中把 URI 与 path 分开命名，附带 access mode/lifetime；不让字符串隐式承担 capability。

