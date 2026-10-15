---
id: semantic-qt-harmonyos-blocking-taxonomy
type: semantic
domain: tech
tags: [qt, harmonyos, blocking, root-cause, taxonomy, feasibility, assess]
created: 2026-09-08
updated: 2026-09-08
status: active
refs: [semantic-qt-harmonyos-modules, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-third-party-libs, semantic-qt-ohos-extras, procedural-qt-app-harmonyos-migration]
summary: >
  Qt 应用鸿蒙化「阻断根因」分类法与判定边界：先区分适配可解（QtOhosExtras 封装 /
  代码守卫 / .so 部署路径 / feature flag / shim）与不可适配，再归入 6 类根因代号
  （LIB-MISSING / MODULE-OUT-OF-SCOPE / PLATFORM-FEATURE-UNSUPPORTED /
  ABI-PERFORMANCE / CONCEPT-MISMATCH / OTHER）并路由后续动作。
  `qt-ohos-run.py assess` 的三态判定（portable/blocked/uncertain）遵循本页边界表。
---

# Qt 应用鸿蒙化阻断根因分类法

> 评估一个 Qt 应用**能否鸿蒙化**时查阅本页。`qt-ohos-run.py assess` 产出的阻断项
> 即按本页代号归类；机器可读版在 `knowledge/adaptation/blockers.yaml`。

---

## 边界声明：适配可解 vs 不可适配（必读）

**只有「无法通过鸿蒙化适配解决」的根因才算阻断点**——即只能靠换库 / 系统需求 /
Qt 补齐 / 不投入推进，应用层改不动的那种。

凡是能用以下**适配手段**解决的，**不属于阻断点**（记入迁移工作流与必须适配清单
`knowledge/adaptation/checklist.yaml`）：

| 适配手段 | 对应的常见"看起来像阻断其实能解"的场景 | QtOhosExtras / 平台封装接口 |
|---------|--------------------------------------|------------------------------|
| QtOhosExtras 封装接口 | 子进程启动、应用间通信、窗口子窗口标记、生命周期 closeEvent 分级、防截屏、暗色模式 | `startAppProcess` / `startNewAbilityInstance` / `startAbility(want)` / `setBundledAbilityAndQWindowBindingKeyForQWindow`（子窗口绑定） / `getCloseEventRootCause` / `QOhosAppContext` |
| 代码守卫 `#ifndef Q_OS_OHOS` | chmod/symlink/pthread_cancel/平台条件分支误命中 Linux（注意 `Q_OS_OHOS` 隐含 `Q_OS_LINUX`，禁止盲目扩写守卫） | 平台限制页 8 类 |
| .so 部署路径调整 | dlopen EINVAL（只读路径不可加载） | `.so` 打包进 `entry/libs/arm64-v8a/` |
| feature flag OFF / 裁剪非核心功能 | X11/HWND/Cocoa/Wayland 直调用、可选平台集成 | `#ifndef Q_OS_OHOS` + 桩 + CMake 开关 |
| shim 头文件 / 禁用加速路径 | musl 缺符号、Clang intrinsic 缺 | inline 函数 shim、`--disable-modules` 软件实现 |

**判定原则**：先确认根因确实「适配改不动」，再归入下方分类。沙箱约束多可经
QtOhosExtras / 部署路径 / 守卫解决，不作为阻断类别；仅当裁剪后核心功能不复存在时，
才升级为 `CONCEPT-MISMATCH`。

## 阻断根因分类（速查）

| 代号 | 类别 | 根因描述（适配改不动的那种） | 典型信号 | 后续动作 |
|------|------|------------------------------|----------|---------|
| `LIB-MISSING` | 三方库未鸿蒙化 | 依赖的 C/C++ 三方库无 OHOS arm64 预编译包、无交叉编译配方、无等价替代，且 shim/桩无法绕过 | `find_package(X REQUIRED)` 找不到、`undefined reference`、bottle 不存在 | 换库/立项补齐；整套框架栈见下方特判 |
| `MODULE-OUT-OF-SCOPE` | Qt 模块平台不支持（核心依赖） | 依赖的 Qt 模块在 OHOS SDK 完全缺失且承载核心功能无法裁剪（WebEngine/D-Bus/RemoteObjects/SerialBus 等） | `find_package(Qt5/6 <Module> REQUIRED)` 失败；模块矩阵标 out-of-scope | Qt 模块补齐或替代（WebEngine→CEF）；可裁剪则不算阻断 |
| `PLATFORM-FEATURE-UNSUPPORTED` | 平台能力根本不提供 | 鸿蒙平台某项系统能力空白，非库缺失、非沙箱权限 | native API/框架在 OHOS SDK 无对应头/库 | 系统需求 |
| `ABI-PERFORMANCE` | ABI/编译器不匹配（无 workaround） | OHOS Clang 缺 intrinsic、musl 缺符号、W^X 禁 JIT、性能问题，shim/禁用加速路径均失效 | `undefined symbol` intrinsic、JIT 类应用 | 重写/重选后端 |
| `CONCEPT-MISMATCH` | 问题域无移动端对应 | 应用核心问题域本身是桌面/系统管理能力，沙箱不暴露对应资源 | 问题域即桌面系统能力（系统监视器/窗口管理器类） | 不投入 |
| `OTHER` | 其他 | 暂不归入以上类别 | — | 进一步评估 |

> **KDE 框架栈特殊大实例**：当 `LIB-MISSING` 缺失的是一整套框架栈（KDE Frameworks：
> ECM + 多个 KF5/KF6 模块 + PolkitQt，`find_package(KF6 ... REQUIRED)` ≥5）时，
> 工作量数人年且部分子模块平台无对应——判不投入，`blocking_category` 仍填
> `LIB-MISSING`，注明「框架栈大实例」。

## 与 assess 三态结论的对应

| 命中 | assess 结论 |
|------|------------|
| `MODULE-OUT-OF-SCOPE` / `CONCEPT-MISMATCH` / `PLATFORM-FEATURE-UNSUPPORTED` / KDE 框架栈 | **blocked**（附阻断清单与证据） |
| `LIB-MISSING` / `ABI-PERFORMANCE` / `OTHER` | **uncertain**（附建议：换库/立项/重选后端） |
| 无阻断，仅清单命中与风险项 | **portable**（附必须适配清单 + 风险分级 + 工作量参考） |

## 相关

- [[semantic-qt-harmonyos-modules]] — 模块可用性矩阵（MODULE-OUT-OF-SCOPE 的判定依据）
- [[procedural-qt-app-harmonyos-migration]] — 阶段零预检与完整迁移工作流
- [[semantic-qt-harmonyos-third-party-libs]] — LIB-MISSING 的三方库可行性核对
- `knowledge/adaptation/blockers.yaml` — 本页机器可读版（assess 消费）
