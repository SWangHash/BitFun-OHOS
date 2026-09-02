---
id: episodic-projects-coin3d-quarter-ohos
type: episodic
domain: project
tags: [coin3d, quarter, harmonyos, cross-compile, 3d, opengl-es]
created: 2026-06-08
updated: 2026-06-08
status: active
audience: public
refs: [procedural-qt-app-harmonyos-migration, semantic-qt-harmonyos-modules, semantic-qt-harmonyos-build]
summary: >
  Coin3D Quarter 鸿蒙化完整迁移：交叉编译 libQuarter.so (ARM aarch64) + Demo 应用构建 (37MB HAP)
  + 3D 渲染验证通过。关键发现：OHOS Qt5 不含 UiTools 模块、FindOpenGL 需自定义（OHOS 用 GLES/EGL）、
  CMAKE_FIND_ROOT_PATH_MODE ONLY 需绝对路径绕过、hvigor 需 DEVECO_SDK_HOME。
  可复用：OHOS 交叉编译 CMake 模板 + FindOpenGL 映射模式 + 预编译库集成模式。
---

# Coin3D Quarter 鸿蒙化交叉编译 — 经验总结

## 项目概览

| 字段 | 内容 |
|------|------|
| 时间 | 2026-06-08 |
| 角色 | Qt for HarmonyOS 开发者 |
| 技术栈 | Coin3D 4.0 + Quarter 1.2.3 + Qt 5.12 + CMake + OHOS SDK clang 15 |
| 规模 | 单个 .so 库交叉编译 + demo 集成 |
| 状态 | ✅ 已完成（交叉编译 + Demo 构建 + 3D 渲染验证通过） |

## 背景与目标

将 [Coin3D Quarter](https://github.com/coin3d/quarter)（Coin3D 与 Qt 的集成胶水库）交叉编译为鸿蒙 ARM64 平台。Coin3D 已有 OHOS ARM64 预编译库（来自 [coin3d_demo](https://gitcode.com/zhong-luping/coin3d_demo)）。

## 关键决策

### 决策 1: 选择 Qt 5.12 而非 5.15
- **背景**：两个版本均有 OHOS 编译产物
- **选项**：Qt 5.12 / Qt 5.15
- **选择**：Qt 5.12（`<LOCAL_PATH>`）
- **理由**：Quarter 在 Qt5 下使用 `QGLWidget`（来自 QtOpenGL 模块），两个版本均可用，但 5.12 是当前主力分支
- **结果**：编译成功，无兼容性问题

### 决策 2: 移除 UiTools 依赖
- **背景**：Quarter CMakeLists.txt 依赖 `Qt5::UiTools`，但 OHOS Qt SDK 不含此模块
- **选项**：① 从 Qt 源码编译 UiTools ② 移除依赖 ③ 构建静态库绕过
- **选择**：移除 UiTools 依赖（仅在 examples 中使用，核心库不需要）
- **理由**：最小改动原则，核心库 src/Quarter/*.cpp 不使用 QUiLoader
- **结果**：编译通过，不影响核心功能

### 决策 3: 自定义 FindOpenGL.cmake
- **背景**：OHOS 使用 OpenGL ES（libGLESv2.so / libGLv4.so）+ EGL，而非桌面 OpenGL（libGL.so + libGLX.so）
- **选择**：创建自定义 FindOpenGL.cmake，映射 GLES/EGL 到标准 OpenGL CMake 变量
- **结果**：成功找到 libGLv4.so 和 libEGL.so

### 决策 4: CoinConfig.cmake 使用绝对路径
- **背景**：OHOS 工具链设置 `CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY`，导致 `find_library` 只搜索 sysroot
- **选择**：在 CoinConfig.cmake 中使用 `EXISTS` + 绝对路径，绕过搜索限制
- **结果**：成功定位预编译的 libCoin.so.80

## 踩过的坑

### 坑 1: Qt5UiTools 在 OHOS SDK 中缺失
- **现象**：`find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET)` 失败
- **根因**：OHOS Qt SDK（5.12 和 5.15）均不包含 Qt5UiTools cmake 模块
- **解决**：从 find_package 和 QUARTER_QT_TARGETS 中移除 UiTools
- **教训**：交叉编译第三方 Qt 库前，先扫描 OHOS SDK 中可用的 Qt 模块（`ls lib/cmake/`）

### 坑 2: FindOpenGL 在 OHOS 上找不到 libGL.so
- **现象**：`Could NOT find OpenGL (missing: OPENGL_opengl_LIBRARY OPENGL_glx_LIBRARY)`
- **根因**：OHOS sysroot 无 libGL.so 和 libGLX.so，只有 libGLESv2.so / libGLv4.so / libEGL.so
- **解决**：自定义 FindOpenGL.cmake，用 libGLv4.so 替代 libGL.so，用 libEGL.so 替代 libGLX.so
- **教训**：OHOS 上所有依赖桌面 OpenGL 的库都需要自定义 FindOpenGL

### 坑 3: CMAKE_FIND_ROOT_PATH_MODE ONLY 阻断 find_library/find_path
- **现象**：CoinConfig.cmake 中 `find_library(Coin_LIBRARY PATHS ...)` 找不到库
- **根因**：OHOS 工具链设置 `CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY`，限制了所有 find 操作到 sysroot
- **解决**：在 CoinConfig.cmake 中改用 `EXISTS` + 绝对路径直接设置变量，不用 find_library/find_path
- **教训**：在 OHOS 交叉编译中写 FindXXX.cmake 时，优先使用绝对路径 + EXISTS 检查

### 坑 4: CMAKE_FIND_ROOT_PATH 未包含 Qt SDK 路径
- **现象**：`find_package(Qt5 ...)` 找不到 Qt5，fallback 到 Qt4 报错
- **根因**：`CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY` 只搜索 CMAKE_FIND_ROOT_PATH，Qt SDK 不在其中
- **解决**：将 Qt SDK 路径通过 `-DCMAKE_FIND_ROOT_PATH="<LOCAL_PATH>"` 加入
- **教训**：OHOS 交叉编译时，所有外部依赖（Qt、第三方库）都需要加入 CMAKE_FIND_ROOT_PATH

## 可复用的经验

1. **OHOS 交叉编译 CMake 模板**：
   ```bash
   cmake -G Ninja \
     -DCMAKE_TOOLCHAIN_FILE="<OHOS_SDK>/native/build/cmake/ohos.toolchain.cmake" \
     -DOHOS_ARCH=arm64-v8a \
     -DCMAKE_FIND_ROOT_PATH="<Qt_SDK_path>" \
     -DCMAKE_MODULE_PATH="<自定义cmake模块路径>" \
     -DCoin_DIR="<CoinConfig.cmake所在目录>"
   ```

2. **自定义 FindOpenGL.cmake 模式**：OHOS 项目可复用此模式，将 libGLv4.so + libEGL.so 映射为标准 OpenGL 变量

3. **CoinConfig.cmake 绝对路径模式**：适用于所有在 OHOS 交叉编译中使用预编译第三方库的场景

4. **Quarter 库在 OHOS 的依赖链**：`libCoin.so.80` + `libGLv4.so` + `libQt5Core.so` + `libQt5Gui.so` + `libQt5OpenGL.so` + `libQt5Widgets.so`

## 构建产物

| 文件 | 大小 | 架构 | 路径 |
|------|------|------|------|
| libQuarter.so.20.2.3 | 400KB | ARM aarch64 | `quarter-ohos/build-ohos/lib/` |
| libQuarter.so.20 | symlink | - | 同上 |
| libQuarter.so | symlink | - | 同上 |
| libquarterdemo.so | 57KB | ARM aarch64 | `quarter-ohos/quarter-demo-ohos/` HAP 内 |
| quarter-demo-ohos-default-unsigned.app | 37MB | - | `quarter-ohos/quarter-demo-ohos/build/<INTERNAL_OUTPUT>` |

## Demo 应用构建经验

### 决策 5: 使用 Qt OHOS 模板而非原生 XComponent
- **背景**：Quarter 本质是 Qt Widget，需要 QApplication + Qt 事件循环
- **选择**：使用 Qt OHOS 模板（QAbility + QPA 插件），自动处理 XComponent ↔ Qt 桥接
- **结果**：只需写标准 Qt C++ main()，无需手动管理 EGL/GL 上下文

### 坑 5: hvigor 原生构建静默跳过
- **现象**：`BuildNativeWithCmake... after 1 ms`，BUILD SUCCESSFUL 但无 .so 产物
- **根因**：`DEVECO_SDK_HOME` 未设置，hvigor 找不到 OHOS SDK 工具链
- **解决**：`export DEVECO_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk"`
- **教训**：1ms 的 BuildNativeWithCmake 是静默跳过的标志，正常应 >1s

### 坑 6: PackageHap 需要 Java
- **现象**：`spawn java ENOENT`，HAP 打包失败
- **根因**：hvigor 的 PackageHap 步骤调用 `java -jar app_packing_tool.jar`，但命令行环境无 Java
- **解决**：`export PATH="/c/Program Files/Huawei/DevEco Studio/jbr/bin:$PATH"`（必须整个 jbr/bin 目录，不能只复制 java.exe）
- **教训**：DevEco Studio IDE 内置 JBR，但命令行构建需手动配置

### 坑 7: OhosExportModules.ts 的 lazy import 语法
- **现象**：`Current configuration does not support using lazy import`
- **根因**：模板使用 `import lazy` 语法，需要 API 12 beta3 或更高版本
- **解决**：将 `import lazy { ... }` 替换为 `import { ... }`
- **教训**：Qt OHOS 模板的 ArkTS 胶水代码可能需要根据 SDK 版本调整语法

## 3D 渲染验证（2026-06-08）

### 验证结果

| 验证项 | 状态 | 说明 |
|--------|:----:|------|
| 应用启动 | ✅ | QApplication 正常初始化，QPA 插件加载成功 |
| QuarterWidget 创建 | ✅ | QGLWidget 子类正确创建，EGL 上下文自动管理 |
| 3D 场景渲染 | ✅ | 红立方体 + 蓝球 + 绿半透明立方体 + 方向光，正确渲染 |
| 触摸交互 | ✅ | 拖拽旋转 / 双指缩放 / 双指平移，手势正常响应 |
| 透明度渲染 | ✅ | SORTED_OBJECT_BLEND 模式，半透明立方体正确混合 |

### 验证结论

Coin3D Quarter 库已完成端到端鸿蒙化迁移：从交叉编译到 3D 渲染全链路验证通过。关键技术路径验证：
1. Coin3D 场景图在 OHOS 上正常工作
2. Quarter 胶水库成功桥接 Coin3D 与 Qt OHOS
3. OpenGL ES 渲染管线通过 Qt QPA 自动管理
4. Qt Widget 事件循环正确传递触摸手势到 Coin3D

### 迁移报告

完整迁移报告已输出至项目根目录：`<MIGRATION_PROJECT_ROOT>/quarter-ohos\MIGRATION_REPORT.md`

## 相关资源

- Quarter 源码：https://github.com/coin3d/quarter
- Coin3D Demo：https://gitcode.com/zhong-luping/coin3d_demo
- 项目目录：`<MIGRATION_PROJECT_ROOT>/quarter-ohos\`
- 迁移报告：`<MIGRATION_PROJECT_ROOT>/quarter-ohos\MIGRATION_REPORT.md`
