---
id: problem-runtime-hap-missing-so-closure
type: problem
domain: runtime
tags: [so闭包, libqohos, jscrash, TypeError, libdav1d, libaom, libbz2, aom编译, 静态库转so, portgraph]
created: 2026-09-11
updated: 2026-09-11
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-build, semantic-qt-harmonyos-third-party-libs]
summary: >
  HAP 启动 64ms 即死、无 cppcrash、jscrash TypeError "handleAbilityStageOnCreate
  of undefined"——根因是 libqohos.so 的传递依赖 .so 缺失（libbz2/libz/libdav1d/
  libaom）。给出 llvm-readobj 递归闭包排查法 + aom 源码编译 + dav1d 静态转 so。
leader_summary: >
  建立"启动即死查 so 闭包"的排障路径与两类无 bottle 依赖的补充手段
impact: [运行时排障, 依赖管理]
deliverables: [problem记录]
evidence: []

error_message: >
  jscrash: TypeError: Cannot read property handleAbilityStageOnCreate of undefined
  at onCreate entry (entry/src/main/ets/qabilitystage/QAbilityStage.ets:41:9)
  appspawn: com.example.xxx exit with code:254
  hiview: OnFault: xxx Unsupported faultlog abily (无 cppcrash)
error_code: ""
keywords: [so闭包, NEEDED, jscrash, handleAbilityStageOnCreate, libqohos, fontconfig, freetype, dav1d, aom, bz2, HAP, 启动崩溃]
symptoms: "签名 HAP 安装成功，aa start 后进程 <100ms 消失，无 cppcrash 只有 jscrash TypeError；同 kit 构建的简单 Qt 应用正常"

environment: "Windows 构建 + Qt 6.12-beta3 kit + portgraph bottle 依赖 + HUAWEI MateBook Pro 设备"
---

# HAP 启动即死（jscrash TypeError）= 依赖 .so 闭包缺失

## 错误信息

```
Reason: TypeError
Error message: Cannot read property handleAbilityStageOnCreate of undefined
Stacktrace: at onCreate entry (entry/src/main/ets/qabilitystage/QAbilityStage.ets:41:9)
appspawn: exit with code:254
```

无 cppcrash、faultlogger 报 "Unsupported faultlog"。进程在
QAbilityStage::onCreate() 后约 64ms 消失。

## 根因链

`import qpa from 'libqohos.so'` 返回 **undefined**（不是 import 抛错——napi
模块注册阶段抛异常时 ArkTS 得到 undefined，用到时才 TypeError）。
libqohos.so 是平台胶水，其 napi 注册前的 so 加载沿 DT_NEEDED 传递展开，
任一环节缺 .so → 整链加载失败 → qpa undefined。

本例缺失（Qt 6.12 kit + bottle 依赖组合）：

```
libqohos.so → libfontconfig.so → libfreetype.so → libbz2.so.1.0   ✗
                                             └→ libz.so.1          ✗
libapp.so → libavcodec.so.63 → libdav1d.so.7                  ✗
             → libavif.so.16  → libaom.so.3 / libdav1d.so.7        ✗
             → libheif.so.1   → libaom.so.3                        ✗
             → libz.so                                                  ✗
```

对照组：同设备上另一正常运行的 Qt 应用恰好部署了这些 so。

## 排查法（递归闭包脚本）

1. `hdc shell ls /system/lib64 /system/lib64/platformsdk ...` 取系统 so 集
   （NDK 系统库如 libhilog_ndk.z.so 在设备其他搜索路径，属于正常存在）
2. 从 `libqohos.so` + `libapp.so` 出发 BFS：`llvm-readobj --dynamic-table`
   解析每个 NEEDED，部署目录命中则继续下钻，未命中即缺失
3. 误报过滤：系统库白名单；重点看 app 级带版本号 so（.so.N）

## 修复手段

**bottle 有的直接复制**（zlib/bzip2/brotli/fontconfig）到 `entry/libs/arm64-v8a/`。

**无 bottle 的两个方案**（Harmonybrew/cmd-pkgs 均无 aom、dav1d 只有 .a）：

1. **aom 源码交叉编译**（约 5 分钟）：
   `github.com/m-ab-s/aom`（googlesource/gitcode 被墙时的镜像）v3.11.0
   tarball，ohos.toolchain.cmake + `BUILD_SHARED_LIBS=ON`，产出 libaom.so.3。

2. **静态库 whole-archive 转 so**（秒级）：
```
clang --target=aarch64-linux-ohos --sysroot=$SYSROOT \
  -shared -o libdav1d.so.7 \
  -Wl,--whole-archive libdav1d.a -Wl,--no-whole-archive \
  -Wl,-soname,libdav1d.so.7
```
   前提：cmd-pkgs 的 .a 是 PIC（OHOS 全 PIC 策略，实测可行），产物用
   `llvm-nm -D` 验证关键符号（dav1d_open 等）。

## 关联坑：portgraph bottle 的 NTFS symlink 损坏

bottle 解压在 NTFS 上的 .so symlink 变成 0 字节或不可访问 reparse point
（getsize 抛 WinError 1920/4390），导致：
- harmonydeployqt 部署时 readobj 失败（llvm-readobj failed exit 1）
- hvigor 打 HAP 时 EACCES: permission denied lstat

修复：扫描 bottle 目录，`lstat` 是 reparse/0 字节的 .so/.a 删除后复制同前缀
最长版本文件（libX.so ← libX.so.1.2.3）。本例修复 202 个。

## 验证

补齐后启动日志出现完整链路即成功：
```
setupQtApplication() - sharedLibraryName: libapp.so
opened library '.../libapp.so' with main function
calling 'main' function in library ... (argc=2)
QAbility::onForeground()
```
