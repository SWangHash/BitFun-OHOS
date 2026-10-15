---
id: semantic-qt-harmonyos-pyqt-status
type: semantic
domain: tech
tags: [qt, pyqt, python, harmonyos, ohos, runtime, cpython, feasibility]
created: 2026-08-26
updated: 2026-08-26
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-build, semantic-qt-harmonyos-modules, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-third-party-libs]
summary: >
  PyQt5 for HarmonyOS 可行性状态：已通过 pyqt5-demo 验证可行（Qt 5.15.16）。
  架构与标准 C++ Qt 完全一致（libqohos.so QPA 插件），差异仅在 C++ launcher 层
  嵌入 CPython 3.12 运行时解释执行 Python 脚本。依赖 DevPython-OH（CPython 交叉编译）
  和 PythonForArkUI（PyQt5 site-packages）。已知坑：openblas 需二进制补丁、
  sys.exit() 触发 appspawn 崩溃日志、仅支持 tablet/2in1。
leader_summary: >
  完成 PyQt5 for HarmonyOS 可行性调研与 demo 分析，确认 PyQt5 应用可在 OHOS 上运行，
  为 PyQt 开源应用鸿蒙化提供了技术路径参考。
impact: [迁移提效, 框架支撑]
deliverables: [知识库页面]
evidence: [pyqt5-demo 仓库分析（https://gitcode.com/ohos-qt/pyqt5-demo）]
---

# PyQt5 for HarmonyOS 状态

> **一句话**：PyQt5 在 HarmonyOS 上可行，架构复用标准 Qt for OHOS QPA 插件，差异仅在 C++ launcher 嵌入 CPython 运行时。

## 可行性结论

| 项目 | 结论 |
|------|------|
| **CPython 交叉编译到 OHOS** | ✅ 可行 — [DevPython-OH](https://gitcode.com/OpenHarmonyPCDeveloper/DevPython-OH) 提供 Python 3.12 OHOS 构建 |
| **PyQt5 在 OHOS 上运行** | ✅ 已验证 — pyqt5-demo（glmark2 GPU 基准测试 GUI）真机运行通过 |
| **QPA 架构复用** | ✅ 完全复用标准架构 — libqohos.so + XComponent，与 C++ Qt 应用无差异 |
| **OpenGL ES 渲染** | ✅ 通过 PyOpenGL 使用 OpenGL ES 2.0 |
| **Demo 来源** | [ohos-qt/pyqt5-demo](https://gitcode.com/ohos-qt/pyqt5-demo)（commit 798669d） |

## 架构（调用链）

```
HarmonyOS UIAbility (QAbility.ets)
  → libqohos.so (Qt QPA 平台插件，标准架构)
    → libpyqtlauncher.so (C++ main 入口)
      → Py_Initialize()
      → PyRun_SimpleFileEx("app.py")
        → Python 3.12 运行时 (CPython)
          → PyQt5 (QtWidgets, QtCore, QtGui)
          → PyOpenGL (OpenGL ES 2.0)
            → 用户 Python 应用代码
```

### 与标准 C++ Qt 应用的差异

| 层 | C++ Qt 应用 | PyQt5 应用 |
|----|-------------|-----------|
| ArkTS 层（QAbility.ets / XComponent） | ✅ 完全一致 | ✅ 完全一致 |
| QPA 插件（libqohos.so） | ✅ 完全一致 | ✅ 完全一致 |
| C++ main 入口 | `main()` → `QApplication` + 业务逻辑 | `main()` → `Py_Initialize()` + `PyRun_SimpleFileEx()` |
| 应用代码 | C++ 编译进 .so | Python 脚本放 resfile/，运行时解释执行 |
| 额外依赖 | 无 | libpython3.12.so + PyQt5 site-packages（~1.8 GB） |

## 依赖清单

### 外部依赖（均需手动组装，gitignored）

| 依赖 | 来源 | 放置位置 |
|------|------|----------|
| Qt 5.15.16 OHOS | `tqtc/harmonyos-5.15.16` 分支编译 | `entry/libs/arm64-v8a/*.so` + `libqohos.so` |
| Python 3.12 运行时 | [DevPython-OH](https://gitcode.com/OpenHarmonyPCDeveloper/DevPython-OH) | 头文件 → `cpp/thirdparty/include/`，.so → `libs/arm64-v8a/` |
| PyQt5 site-packages | [PythonForArkUI](https://gitcode.com/OpenHarmonyPCDeveloper/PythonForArkUI) `other/site-packages` | `libs/arm64-v8a/Python/lib/python3.12/site-packages/` |

### Python 包依赖（requirements.txt）

| 包 | 版本要求 | 用途 |
|----|---------|------|
| PyQt5 | ≥ 5.15.0 | Qt Python 绑定 |
| PyOpenGL | ≥ 3.1.5 | OpenGL Python 绑定 |
| PyOpenGL-accelerate | ≥ 3.1.5 | OpenGL 加速 |
| numpy | ≥ 1.19.0 | 数值计算 |

### 依赖组装步骤

```bash
# 1. Python 3.12 头文件和运行时
cp -r python-wheel-3.12/include entry/src/main/cpp/thirdparty/include
cp python-wheel-3.12/lib/*.so* entry/libs/arm64-v8a/
mv entry/libs/arm64-v8a/python3.12 entry/libs/arm64-v8a/Python/lib/python3.12

# 2. Qt 5.15.16 运行时
cp <qt-install>/lib/*.so entry/libs/arm64-v8a/
cp <qt-install>/plugins/platforms/libqohos.so entry/libs/arm64-v8a/

# 3. PyQt5 site-packages
cp -r <PythonForArkUI>/other/site-packages \
  entry/libs/arm64-v8a/Python/lib/python3.12/site-packages

# 4. openblas 二进制补丁（必须在 Linux/WSL 下执行）
openblas_so=entry/libs/arm64-v8a/Python/lib/python3.12/site-packages/numpy.libs/libopenblasp-r0-76071c68.3.27.so
printf '\x1f\x20\x03\xd5' | dd of=$openblas_so bs=1 seek=2464508 conv=notrunc
```

## C++ Launcher 实现要点

PyQt5 应用的 C++ 入口（`pyqtlauncher.cpp`）核心逻辑：

```cpp
int main(int argc, char *argv[]) {
    // 1. 设置 PYTHONHOME 指向 HAP 内的 Python 运行时
    setenv("PYTHONHOME", "/data/storage/el1/bundle/libs/arm64/Python", 1);

    // 2. 初始化 Python 解释器
    Py_Initialize();

    // 3. 设置 sys.argv
    wchar_t *pyArgv0 = Py_DecodeLocale(scriptPath, NULL);
    PySys_SetArgvEx(1, &pyArgv0, 1);

    // 4. 执行 Python 脚本
    FILE *pyFile = fopen(scriptPath, "r");
    int ret = PyRun_SimpleFileEx(pyFile, scriptPath, 1);

    // 5. 清理
    PyMem_RawFree(pyArgv0);
    Py_Finalize();
    return ret;
}
```

**关键点**：
- `PYTHONHOME` 必须指向 HAP 包内的 Python 运行时目录（`libs/arm64/Python`）
- 脚本路径是 HAP 解压后的绝对路径（`/data/storage/el1/bundle/entry/resources/resfile/...`）
- 用 RAII guard 管理 `Py_Initialize` / `Py_Finalize` 生命周期

### CMake 配置

```cmake
add_library(pyqtlauncher SHARED pyqtlauncher.cpp hilog-easy.c)
target_link_libraries(pyqtlauncher PUBLIC libace_napi.z.so libhilog_ndk.z.so)

set(PYTHON_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/include/python3.12)
set(PYTHON_LIBRARIES -l:libpython3.12.so.1.0)

target_include_directories(pyqtlauncher PRIVATE ${PYTHON_INCLUDE_DIR})
target_link_directories(pyqtlauncher PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/${OHOS_ARCH})
target_link_libraries(pyqtlauncher PRIVATE ${PYTHON_LIBRARIES})
```

## 已知问题与限制

| # | 严重度 | 问题 | 原因 | 解决方案 |
|---|:------:|------|------|---------|
| 1 | 🟠 | numpy openblas 在 OHOS 上崩溃 | openblas 中一条 ARM 指令在 HarmonyOS 运行时触发异常 | 二进制补丁 NOP（`\x1f\x20\x03\xd5` at offset 2464508） |
| 2 | 🟡 | `sys.exit()` 产生崩溃日志 | appspawn 拦截 `exit()` 系统调用 | 功能不受影响，日志可忽略；或改用 `QApplication.quit()` |
| 3 | 🟠 | 仅支持 tablet / 2in1 | phone 设备存在窗口最小化后无法恢复的 bug（QTFOROH-1076） | module.json5 中 deviceTypes 排除 phone |
| 4 | 🟡 | HAP 包体积大（~1.8 GB） | CPython + PyQt5 + numpy + Qt 全部打入 | 裁剪不需要的 site-packages；考虑只打包实际使用的模块 |
| 5 | 🟡 | Python 路径硬编码 | launcher 中 `PYTHONHOME` 和脚本路径写死为绝对路径 | 可通过环境变量或配置文件参数化 |

## 鸿蒙化 PyQt 应用的决策树

```
收到 PyQt 应用鸿蒙化需求
  │
  ├─ 应用仅用 QtWidgets/QtCore/QtGui？ ──────────────→ ✅ 可行，参考 demo 架构
  │
  ├─ 应用用 QML/QtQuick？ ────────────────────────────→ ⚠️ 未验证
  │   │                                                   PyQML 绑定需要额外构建
  │   └─ 可改写为 QtWidgets？ ────────────────────────→ ✅ 可行
  │
  ├─ 应用用 QtMultimedia？ ───────────────────────────→ 🔴 阻断
  │                                                       Qt Multimedia 在 OHOS SDK 中未包含
  │
  ├─ 应用依赖大量 C 扩展模块？ ────────────────────────→ ⚠️ 需逐个验证
  │   │                                                   每个 C 扩展需交叉编译到 OHOS
  │   └─ 有纯 Python 替代？ ──────────────────────────→ ✅ 替换后按标准流程
  │
  └─ 应用依赖平台特定功能（dbus, system tray 等）？ ──→ 🔴 需逐 API 替换
                                                          参考 [[qt-harmonyos-api-mapping]]
```

## 与 C++ Qt 迁移工作流的关系

PyQt 应用鸿蒙化的 **ArkTS 层、QPA 层、HAP 打包层** 与 C++ Qt 应用完全一致，[[qt-harmonyos-golden-rules]] 中的铁律（B1–B12 构建部署、W1–W5 窗口管理、L1–L4 生命周期）全部适用。

差异仅在 **launcher 层**：
- C++ Qt：`main()` 直接创建 `QApplication` 和业务窗口
- PyQt5：`main()` 启动 CPython，由 Python 脚本创建 `QApplication` 和业务窗口

因此 PyQt 迁移复用 [[qt-app-harmonyos-migration]] 工作流的阶段 1–4（pre-flight → 可行性 → 构建部署 → 验证），仅需在阶段 0 增加 Python 运行时和 site-packages 的准备步骤。

## 相关上下文

- [[qt-harmonyos-overview]] — Qt for HarmonyOS 总体架构
- [[qt-harmonyos-build]] — Qt 编译构建流程
- [[qt-harmonyos-modules]] — Qt 模块支持矩阵
- [[qt-harmonyos-platform-limits]] — 平台限制
- [[qt-harmonyos-project-structure]] — 工程结构
- [[qt-harmonyos-third-party-libs]] — 三方库接入
- [[qt-harmonyos-golden-rules]] — 铁律速查

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 完成 PyQt5 for HarmonyOS 可行性验证，确认 PyQt5 开源应用可鸿蒙化，扩展了迁移支撑范围 |
| 影响面 | PyQt 开源应用迁移评估、商业 PyQt 项目咨询 |
| 交付物 | 知识库页面、demo 仓库分析 |
| 证据 | pyqt5-demo 仓库（commit 798669d）源码分析 |
| 可复用方式 | 收到 PyQt 应用鸿蒙化需求时，先扫描此页判断可行性和技术路径 |
