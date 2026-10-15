---
id: procfs-system-information-unavailable
title: "系统信息为空或为 0：Linux procfs 数据源受限"
status: active
confidence: 0.7
sources: [{type: experience, name: "系统监控 app 真机验证", date: 2026-08-03}]
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-03
superseded_by: null
tags: [problem, procfs, system-info, cpu, disk, sandbox]
refs: [system-information-access-limits]
summary: "库选择 Linux backend 后读取 /proc/stat、mounts 或 diskstats 被拒，CPU/disk 等返回空或 0。"
audience: public
error_message: |
  /proc/stat: Permission denied
  /proc/mounts: Permission denied
  CPU usage: 0
  disk list: empty
---

# 系统信息为空或为 0：Linux procfs 数据源受限

## 诊断

1. 确认具体指标的数据源；
2. 在应用进程权限下检查访问结果，不用 hdc/root 视角代替；
3. 区分 open/read permission error、parser error、空列表和真实零值；
4. 核对库是否因 target cfg 错误选择 Linux desktop backend。

## 解决方案

对受限指标使用平台公开 API 或专门的 OHOS backend；若平台未向普通应用开放，则明确降级为 unavailable，隐藏/禁用功能或解释权限限制，不伪造 0。

## 预防措施

系统监控类应用在选型阶段建立“指标→数据源→权限→设备/API→fallback”矩阵，并做真机回归。

