---
domain: episodic
description: >
  情景知识域索引。项目复盘、决策记录。
---

# episodic

## 子目录

| 目录 | 用途 |
|------|------|
| postmortems/ | 踩坑与复盘 |
| decisions/ | 架构决策记录(ADR) |

## 本域知识页

- [coin3d-quarter-ohos](postmortems/coin3d-quarter-ohos.md) — Coin3D Quarter 鸿蒙化完整迁移：交叉编译 libQuarter.so (ARM aarch64) + Demo 应用构建 (37MB HAP) + 3D 渲染验证通过。关键发现：OHOS Qt5 不含 UiTools 模块、FindOpenGL 需自定义（OHOS 用 GLES/EGL）、 CMAKE_FIND_ROOT_PATH_MODE ONLY 需绝对路径绕过、hvigor 需 DEVECO_SDK_HOME。 可复用：OHOS 交叉编译 CMake 模板 + FindOpenGL 映射模式 + 预编译库集成模式。
- [ohostemplate-blockedbymodal-patch](postmortems/ohostemplate-blockedbymodal-patch.md) — ohostemplate matplotlib 三级窗口(Configure subplots->Export values)关不掉。根因：无 parent 的 QDialog 经 syntheticParent fallback 分类为 SubWindow，但 OHOS QPA 从不调 setTransientParent() 反写 Qt 层， 导致 blockedByModalWindow=1 拦截 close()。Qt 源码修复：showImmediate() 在 fallback 后反写 transientParent（约8 行 qohosview.cpp），设备日志验证 blockedByModalWindow=0、close()=1。 同时发现并修复 ArkTS 模板版本不匹配崩溃（modules->modulesFactories）。
- [quit-deadlock-tsfn](postmortems/quit-deadlock-tsfn.md) — 退出死锁复盘：<STAKEHOLDER>(<PRODUCT>) qApp->quit()后应用卡死~2分钟。 根因：HarmonyOS在Ability销毁阶段不处理N-API ThreadSafeFunction回调， 导致qWindowDestroyPromise的resolve回调永远不被执行，Promise永不resolve。 修复：外部补丁通过原子变量+并行轮询绕过TSFN机制，已验证有效。 关联确认：退出流程中sensor插件触发崩溃，伙伴确认移除即规避（2026-07-13）。
- [saribbon-ohos](postmortems/saribbon-ohos.md) — SARibbon v2.5.5 鸿蒙化完整迁移：独立构建文件 + MainWindowExample 应用编译 (48MB HAP) + 两个编译问题修复（QDesktopWidget::screen 类型不匹配 + lazy import 语法不兼容）。 关键发现：SARibbon 源码内 QDesktopWidget API 在 Qt 5.12 OHOS 下返回 QWidget* 而非 QScreen*、 模板 lazy import 语法需 API 12 beta3、需为项目创建独立 CMakeLists.txt 避免改源码。 可复用：三方 Qt 库鸿蒙化时保持源码完整性的独立构建文件模式。
- [toolwindow-crossscreen-flicker](postmortems/toolwindow-crossscreen-flicker.md) — ToolWindow跨屏闪烁系统问题分析：moveWindowToGlobalDisplay与resizeAsync在跨屏拖拽场景冲突， screenIdChanged仅拖拽结束时触发，Qt已通过完整调用链追踪定位根因，归属鸿蒙系统接口。
- [wa-nativewindow-leave-bug](postmortems/wa-nativewindow-leave-bug.md) — WA_NativeWindow Leave 事件不灵敏 Bug 完整分析：双重盲区根因（Qt Widget 层 internalWinId() 跳过 + OHOS QPA hover 回调不可靠）、完整调用链追踪、 修复策略评估（3 种方案对比）、10 场景风险矩阵、时序图。Qt 5.12 OHOS。 ✅ 手动验证通过，交付件已输出至 <WORK_DIR>/leave-event-fix/（2026-06-09 最终整理）。
