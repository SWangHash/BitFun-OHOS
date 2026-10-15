---
id: problem-build-fail-glibc-internal-symbols-ohos-musl
type: problem
domain: build
tags: [build, ohos, musl, glibc, pid_t, uid_t, in6_addr, s6_addr32, porting]
created: 2026-07-10
updated: 2026-07-10
status: solved
severity: medium
audience: public
refs: [procedural-qt-app-harmonyos-migration, problem-build-fail-libuuid-missing-ohos-musl]
summary: >
  glibc 暴露一批"内部"符号（__pid_t/__uid_t 等 typedef、in6_addr.s6_addr32 等 glibc-only 成员），
  OHOS musl 只提供标准名（pid_t/uid_t、s6_addr[16]）。Linux 应用直接用 glibc 内部名在 OHOS 编译报
  "unknown type name '__pid_t'" / "no member named 's6_addr32'"。首选解：换标准 POSIX 名（pid_t/uid_t，
  glibc 也支持，不破坏原 Linux 构建）；s6_addr32 改 sscanf 到 4x uint32 + memcpy 到 s6_addr[16]（字节布局一致）。
leader_summary: 沉淀 Linux→OHOS 移植的 glibc 内部符号（__pid_t/__uid_t/s6_addr32）musl 不兼容复用排障
impact: [迁移提效, 编译排障]
deliverables: [problem记录, tcpview HAP]
evidence: [tcpview-ohos attempt1 build.log (__pid_t/__uid_t 错误), attempt2 BUILD SUCCESSFUL]

error_message: >
  error: unknown type name '__pid_t'; did you mean 'pid_t'?
      CRootModule(__pid_t processId, std::string fifoName);
  error: unknown type name '__uid_t'
      static QString GetUserNameString(__uid_t euid, bool bErrorUser);
  （另一形态, s6_addr32: error: no member named 's6_addr32' in 'struct in6_addr'）
error_code: ""
keywords: [__pid_t, __uid_t, pid_t, uid_t, s6_addr32, s6_addr, in6_addr, glibc, musl, unknown type name, no member]
symptoms: Linux 应用移植 OHOS，编译报 unknown type name '__pid_t'/'__uid_t' 或 in6_addr no member 's6_addr32'
environment: OHOS musl sysroot (aarch64-linux-ohos) + clang；tcpview（rootmodule.h/cusername.h/datasource.cpp）
---

# glibc 内部符号在 OHOS musl 不存在（__pid_t/__uid_t/s6_addr32）

## 错误信息

```
# 形态 A：__ 前缀 typedef（glibc 内部名，musl 无）
C:/.../source/rootmodule.h:46:17: error: unknown type name '__pid_t'; did you mean 'pid_t'?
    CRootModule(__pid_t processId, std::string fifoName);
                ^~~~~~~
                pid_t
C:/.../source/cusername.h:26:38: error: unknown type name '__uid_t'
    static QString GetUserNameString(__uid_t euid, bool bErrorUser);

# 形态 B：glibc-only 结构成员（musl 无）
C:/.../source/datasource.cpp:399: error: no member named 's6_addr32' in 'struct in6_addr'
    sscanf(loc_addr, "%08X%08X%08X%08X", &socket_info.loc6.s6_addr32[0], ...);
```

## 场景

Linux 应用直接用了 glibc 的"内部"符号（双下划线前缀 typedef 或 glibc 扩展结构成员）。这些在 glibc
上可用（glibc 同时暴露 `__pid_t` 和 `pid_t`、`in6_addr.s6_addr32` 和 `s6_addr`），但在 OHOS musl
上只有标准名 → 编译报 unknown type name / no member。tcpview 三处：rootmodule.h `__pid_t`、
cusername.h `__uid_t`、datasource.cpp `in6_addr.s6_addr32`。

## 原因

- glibc 的 `bits/alltypes.h` 既定义 `__pid_t`/`__uid_t`（内部名）又 typedef `pid_t`/`uid_t`（标准名，
  通常 `typedef __pid_t pid_t`）。musl 只定义标准名 `pid_t`/`uid_t`（`typedef int pid_t;`），
  不暴露 `__` 前缀内部名。
- glibc 的 `struct in6_addr` 提供 `s6_addr`、`s6_addr16`、`s6_addr32` 三个 union 视图（后者是 glibc 扩展）。
  musl 的 `in6_addr` 只有 `s6_addr[16]`（union + `#define s6_addr`），无 `s6_addr32`/`s6_addr16`。

## 解决方案

**形态 A（__pid_t/__uid_t 等）：换标准 POSIX 名。** `__pid_t`→`pid_t`、`__uid_t`→`uid_t`。glibc 也
支持标准名，故不破坏原 Linux/qmake 构建（可移植修复）。注意头文件自足：用 `uid_t` 的头若只 include
了 `<QString>` 之类，需补 `#include <sys/types.h>`（tcpview cusername.h 即补了）。

**形态 B（s6_addr32）：改走 s6_addr[16] + memcpy。** sscanf 读 4 个 uint32 进临时数组，再 memcpy
16 字节进 `s6_addr`——与 glibc 上写 `s6_addr32[]` 字节布局完全一致（一个 uint32 按本机序重解释为 4 字节）：

```cpp
unsigned int u32[4];
sscanf(loc_addr, "%08X%08X%08X%08X", &u32[0], &u32[1], &u32[2], &u32[3]);
memcpy(socket_info.loc6.s6_addr, u32, 16);
```

**预检 grep（阶段零）**：移植 Linux 应用前 grep `__[a-z]+_t\b`（抓 __pid_t/__uid_t/__gid_t/... 等
glibc 内部 typedef）和 `s6_addr32|s6_addr16`（glibc-only 成员），一次定位全部，避免逐次 attempt。

## 注意事项

- `__` 前缀 typedef 替换为标准名是双向安全的（glibc/musl 都有标准名）——首选，不要用 `typedef __pid_t pid_t`
  这种反向 shim（musl 没 `__pid_t` 可作源）。
- s6_addr32 的 memcpy 等价仅保证"字节布局一致"（与原行为同），不修原逻辑的潜在字节序显示问题——
  移植目标是"行为不变 + 能编译"，不改原算法。
- musl 里 `pid_t`/`uid_t` 来自 `<sys/types.h>`（被 `<pwd.h>`/`<unistd.h>` 等传递包含，但头文件自足
  原则下显式 include 最稳）。
- 别误判：`getpwuid`/`gethostbyaddr`/`mkfifo`/`chmod`/`opendir`/`readlink`/`inet_ntoa`/`execv`/`posix_spawn`
  在 musl 都**存在**（编译过，运行时沙箱才失败）——不是 glibc-ism，别误改。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 Linux→OHOS glibc 内部符号（__pid_t/__uid_t/s6_addr32）musl 不兼容的复用排障 |
| 影响面 | 所有从 glibc/Linux 移植到 OHOS 的应用（含直接用 __ 前缀或 glibc 扩展成员的）|
| 交付物 | problem记录 + tcpview HAP |
| 证据 | attempt1 build.log（__pid_t/__uid_t 错误）→ 修复 → attempt2 全 .cpp 编译过 |
| 可复用方式 | 以后报 `unknown type name '__*_t'` 换标准名；报 `no member 's6_addr32'` 改 memcpy |

## 相关

- [[procedural-qt-app-harmonyos-migration]] — 阶段零预检（grep 模式）
- [[build-fail-libuuid-missing-ohos-musl]] — 同批次（tcpview）的另一 musl 系统库缺失
- [[build-fail-qinitresource-extern-c-main]] — 同批次（tcpview）的链接冲突
