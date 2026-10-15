---
title: harmonydeployqt 设备侧部署缺口（5 类系统性问题）
tags: [runtime, harmonydeployqt, deployment, soname, fontconfig, libz, hap, bottle]
summary: "harmonydeployqt 打出的签名 HAP 设备侧 dlopen 连环失败：QPA 插件非 Qt 依赖（fontconfig 链）不部署、无 SONAME bottle 截断依赖解析、libz.so.1 在应用 namespace 外、设备系统库在非标准路径、bottle 缺无版本化文件名。附 readelf 闭包检查方法与 5 条检查清单。"
refs: [semantic-qt-harmonyos-third-party-libs, problem-runtime-hap-missing-so-closure]
keywords: [harmonydeployqt, deploy, dlopen, MUSL-LDSO, handleAbilityStageOnCreate, fontconfig, SONAME, DT_NEEDED, libz.so.1, chipset-sdk-sp, bottle, unversioned]
created: 2026-10-08
---

# harmonydeployqt 设备侧部署缺口（5 类系统性问题）

> 来源：一次"零人工介入的全流程鸿蒙化"测试中，部署/装机阶段连环踩坑后
> 沉淀（耗时约占全程 1/4）。全部为部署器/工具链层的通用缺口，与具体应用无关。

## 症状

harmonydeployqt 正常完成部署并打出签名 HAP，应用在设备上启动即 jscrash
（`Cannot read property handleAbilityStageOnCreate of undefined`）或 MUSL-LDSO
`Error loading shared library`，且**每次补一个库又冒出下一个缺失**。

## 根因（5 类）

1. **QPA 插件的非 Qt 依赖不部署**：`copyPlatformPlugin`（harmonydeployqt
   main.cpp ~L2365）只处理 `libQt6*` 前缀依赖，libqohos.so 需要的
   `libfontconfig.so.1` 及其传递闭包（freetype/expat/libintl/png/bz2）
   全部被跳过。
2. **无 SONAME 的 .so 产生绝对路径 DT_NEEDED**：Harmonybrew bottle 的部分
   .so 无 SONAME → lld 在应用 .so 里记录完整构建机路径 → 部署器
   `readElfDependencies` 解析到含 `:`（盘符）的行直接 break，**整个依赖
   清单被截断**（实测 Qt6Widgets/ffmpeg/openssl 全部漏部署）。
3. **libz.so.1 被当系统库**：部署器 `isSystemLibrary` 跳过 `libz.*`
   （Android 惯例），但 HarmonyOS 设备的 libz.so.1 在 `/system/usr/lib`，
   **不在应用 linker namespace**；bottle 版 freetype/png/ffmpeg 都需要它。
4. **设备系统库在非标准路径**：`libnative_*.so` 在 chipset-sdk-sp/、
   `libpixelmap/libudmf` 在 ndk/、`libz.so` 在 platformsdk/——闭包检查
   不能只看 /system/lib64。
5. **bottle 缺无版本化文件名**：Qt6 kit 链接无版本名（如
   libbrotlicommon.so），bottle 只有 libbrotlicommon.so.1 →
   findExtraDepLibrary 两级查找都失败。

## 修复方案

1. 在应用目标上显式声明 fontconfig 依赖（`--as-needed` 会丢弃无符号引用的
   库，必须包裹）：
   ```cmake
   target_link_libraries(<应用目标> PRIVATE
       "-Wl,--no-as-needed" "${FONTCONFIG_LIB}" "-Wl,--as-needed")
   ```
   让 `detectAndCopyDependencies` 从应用二进制扫到 fontconfig 全链。
2. 无 SONAME 的 bottle 库：源码重编加 `-Wl,-soname,libfoo.so.N`。
3. libz.so.1 手工注入 entry/libs/arm64-v8a/ 后重跑增量 HAP 构建。
4. bottle 目录物化无版本名副本（libfoo.so ← libfoo.so.1）。
5. hvigor 环境三件套：`DEVECO_SDK_HOME` + `JAVA_HOME`（DevEco jbr）+ PATH
   里 java 用**反斜杠**路径（node spawn 对 `C:/` 形式 PATH 解析失败 →
   `spawn java ENOENT`，另见 build-fail-hvigor-spawn-java-enoent）。
6. 部署 JSON 的 `extra-libs-dirs` 取自 **CMAKE_FIND_ROOT_PATH**（不是
   CMAKE_PREFIX_PATH）；Qt CMake finalizer 不经 imported 间接层传播，需手动调
   `_qt_internal_harmonyos_executable_finalizer`。

## 验证

大型工程实测：修复后 `aa start` → 进程存活、Qt 渲染循环运行、主窗口可见、
`qt-ohos-run verify` G0-G9 全 PASS。

**检查方法**：对部署目录每个 .so 做 readelf NEEDED 闭包检查，白名单 =
部署集 ∪ 设备实存系统库（按 chipset-sdk-sp/ndk/platformsdk 分路径核实）。

## 检查清单（部署前过一遍）

1. 部署前本地闭包检查（所有三方库 NEEDED 全覆盖）
2. QPA 插件依赖（fontconfig 链）在 app 二进制上显式声明
3. 所有 bottle .so 有 SONAME
4. libz.so.1 手工注入
5. hvigor 环境：DEVECO_SDK_HOME + JAVA_HOME + 反斜杠 PATH

## 关联

- [runtime-hap-missing-so-closure](runtime-hap-missing-so-closure.md)——
  同族问题：HAP 启动即死的 DT_NEEDED 闭包分析（本页是部署器侧的系统性
  根因与修复，那页是运行时侧的排查方法）
- [semantic/qt-harmonyos-third-party-libs](../semantic/qt-harmonyos-third-party-libs.md)
  §3.4——bottle 缺口处理技巧（镜像源/静态转共享）
