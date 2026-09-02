---
id: runtime-write-to-readonly-bundle-path
title: "运行时写入失败：目标位于只读 bundle 路径"
status: active
confidence: 0.7
sources: [{type: experience, name: "Qt 应用数据库、Python 与资源路径排障", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-05
superseded_by: null
tags: [problem, runtime, sandbox, readonly, bundle, writable-path]
refs: [application-sandbox-paths]
summary: "应用把数据库、缓存、配置或生成文件写到随包资源/安装目录而 EACCES/EROFS；复制到平台可写数据目录。"
audience: public
error_message: |
  Permission denied
  Read-only file system
  EACCES
  EROFS
---

# 运行时写入失败：目标位于只读 bundle 路径

## 场景与原因

应用从资源/bundle 中打开数据库、配置、脚本或模型后尝试原地修改。安装内容用于分发和完整性校验，不是运行时数据目录，因此写入、rename、chmod 或创建相邻临时文件失败。

## 解决方案

1. 在日志中输出目标路径的类别而非敏感绝对路径；
2. 确认它是否来自 bundle/resource API；
3. 首次运行时把需要修改的 seed data 复制到平台提供的应用 data/files/cache 目录；
4. 后续读写始终使用复制后的路径；
5. clean install 与升级场景验证初始化、迁移和失败回滚。

只读资源仍可直接读取。不要为了写入而给 bundle `chmod`，也不要把代码库与可变数据放进同一目录。

## 预防措施

设计时为每个 artifact 标注 immutable resource、mutable persistent data、cache 或 executable code；由 platform context/框架路径 API 获取目录。
