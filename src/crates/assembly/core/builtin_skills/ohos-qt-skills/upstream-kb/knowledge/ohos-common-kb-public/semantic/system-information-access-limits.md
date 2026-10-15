---
id: system-information-access-limits
title: 应用获取系统信息的访问边界
status: active
confidence: 0.7
sources:
  - type: experience
    name: "系统监控 app OHOS 真机验证"
    date: 2026-08-03
  - type: code
    name: "sysinfo 0.35.2 Linux backend"
    date: 2026-08-03
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-03
review_by: null
superseded_by: null
tags: [system-info, procfs, sandbox, cpu, disk, process]
refs: [procfs-system-information-unavailable, application-sandbox-paths]
summary: "普通应用不能假定 Linux procfs 全量可读；按指标使用平台 API，并区分不支持、权限拒绝与真实零值。"
audience: public
---

# 应用获取系统信息的访问边界

OHOS target 或兼容层可能让三方库选择 Linux backend，但不代表普通应用拥有桌面 Linux 的 procfs、mount table 和设备统计访问范围。

## 已验证边界

在特定真机/普通应用验证中，`/proc/meminfo` 与部分 `/proc/<pid>` 数据可读，而 `/proc/stat`、`/proc/mounts`、`/proc/diskstats` 等受限，导致 CPU、disk/storage 指标为空或零。该结果受设备、系统版本、应用类型与权限影响，不应推广为所有产品的永久静态表。

## 设计规则

- 每个指标记录真实数据源，不以“库支持 Linux”代替平台支持证明；
- 优先使用目标系统公开的 system ability/API；
- 将 unavailable/permission-denied/not-implemented 与数值 0 分开建模；
- 对进程、CPU、内存、磁盘、网络逐项验证，不因一个维度成功推断全部成功；
- system/basic/特权应用的能力不自动适用于普通第三方应用。

## Adapter 边界

Rust sysinfo、Qt system API、JVM MXBean 或 .NET diagnostics 如何 fallback/展示留在框架仓。common 维护“数据源和权限必须逐指标验证”的平台 seam。

