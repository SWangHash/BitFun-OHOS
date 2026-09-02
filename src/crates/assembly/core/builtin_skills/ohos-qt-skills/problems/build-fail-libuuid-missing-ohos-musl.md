---
id: problem-build-fail-libuuid-missing-ohos-musl
type: problem
domain: build
tags: [build, ohos, musl, libuuid, uuid, cross-compile, porting, shim]
created: 2026-07-10
updated: 2026-07-10
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-third-party-libs, procedural-qt-app-harmonyos-migration, problem-build-fail-glibc-internal-symbols-ohos-musl]
summary: >
  OHOS musl sysroot 不含 libuuid（无 <uuid/uuid.h>、无 -luuid）。Linux 应用 #include <uuid/uuid.h>
  + LIBS += -luuid 在 OHOS 交叉编译报 fatal error: 'uuid/uuid.h' file not found（或链接 cannot
  find -luuid）。首选解：在 OHOS 构建的 include path 放 drop-in shim（uuid_t=unsigned char[16]、
  uuid_generate 经 QUuid::createUuid、uuid_unparse snprintf），原代码零改动即可编译。
leader_summary: 沉淀 Linux 应用鸿蒙化最常见的系统库缺失（libuuid）零改动 shim 方案
impact: [迁移提效, 编译排障]
deliverables: [problem记录, tcpview HAP, uuid shim]
evidence: [tcpview-ohos BUILD SUCCESSFUL, entry-default-unsigned.hap, OhosExampleApp/uuid/uuid.h]

error_message: >
  fatal error: 'uuid/uuid.h' file not found
  #include <uuid/uuid.h>
  （链接阶段变体: ld.lld: error: unable to find library -luuid / cannot find -luuid）
error_code: ""
keywords: [libuuid, uuid_t, uuid_generate, uuid_unparse, uuid/uuid.h, -luuid, musl, QUuid, shim, drop-in]
symptoms: Linux Qt 应用移植 OHOS，编译报找不到 uuid/uuid.h 或链接找不到 -luuid
environment: OHOS Qt5.15.16 SDK (${QT5_15_OHOS_SDK_FULL}) + OHOS musl sysroot (aarch64-linux-ohos)；tcpview (chipmunk-sm/tcpview) LIBS += -luuid
---

# OHOS musl 无 libuuid —— drop-in shim 方案

## 错误信息

```
fatal error: 'uuid/uuid.h' file not found
   46 | #include <uuid/uuid.h>
      |          ^~~~~~~~~~~~~~~
（若头文件能找到则链接报: ld.lld: error: unable to find library -luuid / cannot find -luuid）
```

## 场景

Linux Qt 应用用 libuuid 生成唯一 ID（`#include <uuid/uuid.h>` + `LIBS += -luuid`），典型如
tcpview 的 `SocketInfo.uuid` / `uuid_generate` / `uuid_unparse`。OHOS musl sysroot 不带 libuuid，
交叉编译即断。tcpview 例：批次 triage 阶段零预检即识别（assessment 标 `ohos_compatibility: maybe,
replaceable by QUuid`），首次构建前就放好 shim，未实际触发错误。

## 原因

OHOS 用 musl libc，不打包 libuuid（e2fsprogs 的 BSD 库，桌面 glibc 发行版自带）。musl sysroot 下
`usr/include/uuid/` 不存在，无对应 .so。

## 解决方案

**首选：drop-in shim（原代码零改动）。** 在 OHOS 构建的 include path 放 `OhosExampleApp/uuid/uuid.h`，
用 QUuid（QtCore 在 OHOS Qt SDK 可用）实现 libuuid 的三个符号：

```cpp
// OhosExampleApp/uuid/uuid.h
#include <QUuid>
#include <QByteArray>
#include <cstring>
#include <cstdio>
typedef unsigned char uuid_t[16];           // 与 libuuid 二进制一致
static inline void uuid_generate(uuid_t out) {
    const QByteArray rfc = QUuid::createUuid().toRfc4122(); // 16 raw bytes
    std::memcpy(out, rfc.constData(), 16);
}
static inline void uuid_unparse(const uuid_t uu, char *out) {
    const unsigned char *u = uu;
    std::snprintf(out, 37,
        "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-"
        "%02x%02x%02x%02x%02x%02x",
        u[0],u[1],u[2],u[3],u[4],u[5],u[6],u[7],
        u[8],u[9],u[10],u[11],u[12],u[13],u[14],u[15]);
}
```

CMakeLists 把 `OhosExampleApp/` 加进 `include_directories`，原代码 `#include <uuid/uuid.h>`
即解析到 shim（OHOS 无系统 uuid.h 抢先）。`-luuid` 在 CMake 里不链接即可——原 datasource.h /
rootmodule.h 的 `#include <uuid/uuid.h>` 一字不改。

**次选**：把 `uuid_t` 字段 + `uuid_generate/uuid_unparse` 调用直接换成 `QUuid`（改原代码，仅当
shim 因别处不便时）。

## 注意事项

- `uuid_t` 必须 `unsigned char[16]`（libuuid 定义如此），否则含 `uuid_t` 字段的结构体 memset/copy
  出现尺寸偏差（tcpview SocketInfo 即如此）。
- `static inline` 在多 TU 安全（内部链接，各 TU 一份副本，无 ODR 冲突；datasource.h/rootmodule.h
  均被多 cpp 包含）。
- `uuid_unparse` 输出 36 字符 + NUL = 37 字节，调用方 guid buffer 需 ≥37。
- 仅适用于"唯一 ID"语义；若应用依赖 UUID 的特定版本/变体语义需另核。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 Linux→OHOS 最常见的系统库缺失（libuuid）零改动 shim 方案 |
| 影响面 | 所有依赖 libuuid 的 Linux Qt 应用鸿蒙化 |
| 交付物 | problem记录 + tcpview HAP + uuid shim（OhosExampleApp/uuid/uuid.h）|
| 证据 | tcpview-ohos BUILD SUCCESSFUL + entry-default-unsigned.hap |
| 可复用方式 | 以后编译报 `uuid/uuid.h not found` 或 `cannot find -luuid` 直接套 shim |

## 相关

- [[semantic-qt-harmonyos-third-party-libs]] — 三方库鸿蒙化指南
- [[procedural-qt-app-harmonyos-migration]] — 迁移工作流（阶段零预检）
- [[build-fail-glibc-internal-symbols-ohos-musl]] — 同批次的 glibc-ism 问题
