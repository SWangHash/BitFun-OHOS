---
updated: 2026-09-29
counts:
  symptoms: 17
  causes: 18
  workarounds: 15
  tickets: 5
description: >
  故障登记总表（症状×根因×方案×跟踪单图的人类视图）。【自动生成，勿手改——
  python tools/faults-build.py build 重建】机读全量图见 _graph.yaml，规范见 _index.md。
---

# 故障登记总表

> 按表现查 §症状索引（主入口）；"归谁、是缺陷还是规格、修没修、怎么绕"看根因。
> 机读全量图（单文件一次加载）：[_graph.yaml](_graph.yaml) ｜ 规范：[_index](_index.md)
> **本文件为派生物**：真源在 `_data/*.yaml` 与 `C-*.md`，修改后跑 `python tools/faults-build.py build`。

## 统计

| 维度 | 分布 |
|------|------|
| 节点 | 症状 17（active 4 / mitigated 12 / resolved 1）｜根因 18（defect 11 / undetermined 3 / limitation 4）｜临时方案 15｜跟踪单 5 |
| 责任领域 | app 2 · ohos-ndk 1 · ohos-runtime 6 · ohos-toolchain 1 · qt-port 6 · third-party 1 · undetermined 1 |
| 处置分类 | 鸿蒙必须适配 4 · Qt 问题 6 · 系统问题 2 · 应用使用问题 2 · 三方库问题 1 · 待定性 3 |
| 链路闭环 | 根治 1 · 临时了结 6 · 未闭环 11（缺单 7 · 缺方案 2 · 双缺 2） |
| 严重度 | blocker 1 · critical 3 · high 6 · medium 7 · low 1 |

## 症状索引（主入口）

| S | 现象 | 域 | 严重度 | 状态 | 闭环 | 根因（nature） | 缓解（W） |
|---|------|----|:------:|------|------|---------------|----------|
| S-0001 | QML 平台守卫静默失效（Qt.platform.os 返回 \"linux\"… | api | 🟠 high | mitigated | 缺单 | [C-0001](C-0001-qqmlplatform-os-ohos-branch.md)（defect） | W-0001 |
| S-0002 | 拼音组合输入异常：键盘中途收起 + 拼音字母污染上屏文本 | input | 🟠 high | mitigated | 缺单 | [C-0002](C-0002-ime-reset-detach.md)（defect） | W-0002 |
| S-0003 | 输入框焦点切换后首字符偶发丢失 | input | 🟡 medium | **active** | 双缺 | [C-0003](C-0003-ime-focus-switch-race.md)（defect） | — |
| S-0004 | qApp->quit() 后应用卡死约 2 分钟（Ability 销毁 Prom… | lifecycle | 🔴 critical | mitigated | — | [C-0004](C-0004-ability-destroy-tsfn.md)（undetermined） | W-0003 |
| S-0005 | Qt6 OHOS target 构建连锁崩溃（nullptr_t / __pro… | build | ⬜ blocker | mitigated | 缺单 | [C-0005](C-0005-qt-cmake-isystem-injection.md)（defect） ×[C-0006](C-0006-libcxx-ohos-cmath-promote.md)（defect）（all_of） | W-0004；W-0004 |
| S-0006 | SURFACE 型 XComponent 原生渲染表面处于弃用轨道（API 20… | api | 🟡 medium | **active** | 缺方案 | [C-0007](C-0007-xcomponent-surface-deprecated.md)（limitation） | — |
| S-0007 | 运行时 chmod / symlink 失败（QFile::setPermiss… | filesystem | 🟡 medium | mitigated | — | [C-0008](C-0008-sandbox-chmod-symlink.md)（limitation） | W-0005；W-0006 |
| S-0008 | 无 parent 的 QDialog 关不掉且滚轮不响应（blockedByMo… | runtime | 🟠 high | mitigated | 缺单 | [C-0009](C-0009-qpa-syntheticparent-no-transientparent.md)（defect） | W-0007 |
| S-0009 | Qt5 鸿蒙应用触发 onAcceptWant 崩溃：Napi::Error g… | runtime | 🔴 critical | mitigated | 缺单 | [C-0010](C-0010-stale-template-ohos-bare-eval.md)（defect） | W-0008 |
| S-0010 | QWidget 应用 Debug 构建鼠标点击即崩：sendThroughApp… | runtime | 🟠 high | **active** | 缺方案 | [C-0011](C-0011-the-mainthread-mismatch.md)（undetermined） | — |
| S-0011 | 运行时 dlopen 从可写路径加载 .so 失败（errno=22 EINVA… | runtime | 🟠 high | mitigated | — | [C-0012](C-0012-loader-rejects-writable-path.md)（limitation） | W-0010 |
| S-0012 | 应用启动数秒后 SIGABRT 崩溃（exit(1)，栈指向配置/日志文件写入失… | runtime | 🔴 critical | mitigated | — | [C-0013](C-0013-sandbox-readonly-bundle-path.md)（limitation） | W-0011 |
| S-0013 | 多屏拖拽 MainWindow 跨屏时 Qt::Tool 子窗口闪烁 | render | 🟡 medium | **active** | 双缺 | [C-0014](C-0014-crossscreen-move-resize-conflict.md)（defect） | — |
| S-0014 | hvigor CLI (--mode module) 打包的 HAP 启动崩溃（… | deploy | 🟡 medium | mitigated | — | [C-0015](C-0015-hvigor-cli-ide-packaging-divergence.md)（undetermined） | W-0013 |
| S-0015 | 误为 QFileDialog 添加 Q_OS_OHOS 替代分支（守卫与平台插件… | api | 🟢 low | resolved | — | [C-0016](C-0016-qfiledialog-unnecessary-ohos-ifdef.md)（defect） | — |
| S-0016 | Windows Git Bash 下 curl 请求体中文乱码（API 返回 2… | toolchain | 🟡 medium | mitigated | — | [C-0017](C-0017-curl-gbk-terminal-mojibake.md)（defect） | W-0014 |
| S-0017 | Qt3D alpha-PNG(RGBA8) 贴图实体渲染纯黑（光照正常、RGB8… | render | 🟠 high | mitigated | 缺单 | [C-0018](C-0018-zink-rgba8-mipmap-black.md)（defect） | W-0015 |

## 按处置分类（开发者视角：遇到该怎么办）

> 派生视图（nature × responsible 自动计算，规范见 _index §三）：**鸿蒙必须适配**=平台/SDK 规格如此，改自己的代码，无上游修复可等；**Qt 问题**=等 Qt 修复/本地补丁/提 QTBUG；**系统问题**=等系统·SDK·工具链版本或提华为侧单；**应用使用问题**=改应用代码，非框架问题；**三方库问题**=三方库自身缺陷；**待定性**=等上游定性。

### 鸿蒙必须适配（must-adapt，4 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0007](C-0007-xcomponent-surface-deprecated.md) | ARKUI_XCOMPONENT_TYPE_SURFACE … | limitation/ohos-runtime | watching | ContentSlot（官方方向）：观察能力覆盖、Qt-po… |
| [C-0008](C-0008-sandbox-chmod-symlink.md) | 应用沙箱禁运行时 chmod/symlink（文件权限与链接… | limitation/ohos-runtime | wontfix | W-0005；W-0006 |
| [C-0012](C-0012-loader-rejects-writable-path.md) | 应用 loader 拒绝从可写路径加载动态库（代码加载仅限 … | limitation/ohos-runtime | wontfix | W-0010 |
| [C-0013](C-0013-sandbox-readonly-bundle-path.md) | OHOS 沙箱 bundle 安装路径只读，桌面式 curr… | limitation/ohos-runtime | wontfix | W-0011 |

### Qt 问题（qt-defect，6 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0001](C-0001-qqmlplatform-os-ohos-branch.md) | qqmlplatform os() 的 #ifdef 链缺 … | defect/qt-port | workaround | W-0001 |
| [C-0002](C-0002-ime-reset-detach.md) | QOhosInputContext::reset() Det… | defect/qt-port | workaround | W-0002 |
| [C-0003](C-0003-ime-focus-switch-race.md) | IME focus 切换瞬间 Detach→Attach 竞… | defect/qt-port | open | 同 C-0002 组件，随其修复合并提交（commit 前校… |
| [C-0005](C-0005-qt-cmake-isystem-injection.md) | Qt cmake 向每个 CXX 命令注入 -isystem… | defect/qt-port | workaround | W-0004 |
| [C-0009](C-0009-qpa-syntheticparent-no-transientparent.md) | OHOS QPA syntheticParent fallb… | defect/qt-port | workaround | W-0007 |
| [C-0010](C-0010-stale-template-ohos-bare-eval.md) | 陈旧胶水模板缺 @ohos.* eager import 注… | defect/qt-port | workaround | W-0008 |

### 系统问题（system-defect，2 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0006](C-0006-libcxx-ohos-cmath-promote.md) | libcxx-ohos <cmath> 使用 __promo… | defect/ohos-ndk | diagnosed | W-0004 |
| [C-0014](C-0014-crossscreen-move-resize-conflict.md) | ohos window 接口 moveWindowToGlo… | defect/ohos-runtime | diagnosed | W-0012 |

### 应用使用问题（app-usage，2 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0016](C-0016-qfiledialog-unnecessary-ohos-ifdef.md) | 应用误判 QFileDialog 无 OHOS 原生支持而添… | defect/app | closed | 改用法：直接使用标准 QFileDialog API，删除 … |
| [C-0017](C-0017-curl-gbk-terminal-mojibake.md) | 非 UTF-8 终端（Windows Git Bash/GB… | defect/app | workaround | W-0014 |

### 三方库问题（third-party，1 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0018](C-0018-zink-rgba8-mipmap-black.md) | Mesa ZINK 以 vkCmdBlitImage 实现 … | defect/third-party | workaround | W-0015 |

### 待定性（undetermined，3 条）

| CID | 根因 | nature/responsible | 状态 | 方案（W）/路径 |
|-----|------|--------------------|------|---------------|
| [C-0004](C-0004-ability-destroy-tsfn.md) | Ability 销毁窗口不处理 N-API TSFN 回调（… | undetermined/ohos-runtime | reported | W-0003 |
| [C-0011](C-0011-the-mainthread-mismatch.md) | theMainThread 与 QCoreApplicati… | undetermined/undetermined | diagnosed | W-0009 |
| [C-0015](C-0015-hvigor-cli-ide-packaging-divergence.md) | hvigor CLI (--mode module) 打包与… | undetermined/ohos-toolchain | diagnosed | W-0013 |

## 未闭环清单（链路完备性缺口——待补齐，规则见 _index §四）

> 闭环规则：**defect（外部责任）临时了结 = 采用中方案（W adopted）+ 在跟单（T）**；limitation / 应用问题 / 未定性 = 采用中方案；根治 = fix-confirmed 及之后。**缺口向上传播**：症状的了结宣称受根因链完备性约束（check 强制）。

### 缺跟踪单（方案已就位，待提单/在跟）（7）

| CID | 根因 | 处置 | 状态 | 方案（W） | 单（T） | 症状 |
|-----|------|------|------|-----------|---------|------|
| [C-0001](C-0001-qqmlplatform-os-ohos-branch.md) | qqmlplatform os() 的 #ifdef… | Qt 问题 | workaround | W-0001 | ✗ | S-0001 |
| [C-0002](C-0002-ime-reset-detach.md) | QOhosInputContext::reset()… | Qt 问题 | workaround | W-0002 | ✗ | S-0002 |
| [C-0005](C-0005-qt-cmake-isystem-injection.md) | Qt cmake 向每个 CXX 命令注入 -isy… | Qt 问题 | workaround | W-0004 | ✗ | S-0005 |
| [C-0006](C-0006-libcxx-ohos-cmath-promote.md) | libcxx-ohos <cmath> 使用 __p… | 系统问题 | diagnosed | W-0004 | ✗ | S-0005 |
| [C-0009](C-0009-qpa-syntheticparent-no-transientparent.md) | OHOS QPA syntheticParent f… | Qt 问题 | workaround | W-0007 | ✗ | S-0008 |
| [C-0010](C-0010-stale-template-ohos-bare-eval.md) | 陈旧胶水模板缺 @ohos.* eager impo… | Qt 问题 | workaround | W-0008 | ✗ | S-0009 |
| [C-0018](C-0018-zink-rgba8-mipmap-black.md) | Mesa ZINK 以 vkCmdBlitImage… | 三方库问题 | workaround | W-0015 | ✗ | S-0017 |

### 缺方案（无采用中的绕过/适配）（2）

| CID | 根因 | 处置 | 状态 | 方案（W） | 单（T） | 症状 |
|-----|------|------|------|-----------|---------|------|
| [C-0007](C-0007-xcomponent-surface-deprecated.md) | ARKUI_XCOMPONENT_TYPE_SURF… | 鸿蒙必须适配 | watching | ✗ | T-0002 | S-0006 |
| [C-0011](C-0011-the-mainthread-mismatch.md) | theMainThread 与 QCoreAppli… | 待定性 | diagnosed | ✗ | ✗ | S-0010 |

### 双缺（未解决）（2）

| CID | 根因 | 处置 | 状态 | 方案（W） | 单（T） | 症状 |
|-----|------|------|------|-----------|---------|------|
| [C-0003](C-0003-ime-focus-switch-race.md) | IME focus 切换瞬间 Detach→Atta… | Qt 问题 | open | ✗ | ✗ | S-0003 |
| [C-0014](C-0014-crossscreen-move-resize-conflict.md) | ohos window 接口 moveWindowT… | 系统问题 | diagnosed | ✗ | ✗ | S-0013 |

## 缺陷（defect——会修，跟修复版本与上游单）

| CID | 根因 | 领域 | 严重度 | 状态 | 临时方案（W） | 跟踪单（T） | 修复到达路径 | 复核到期 |
|-----|------|------|:------:|------|--------------|------------|-------------|---------|
| [C-0001](C-0001-qqmlplatform-os-ohos-branch.md) | qqmlplatform os() 的 #ifdef 链缺 Q_OS… | qt-port | 🟠 high | workaround | W-0001 | — | qtdeclarative 上游加分支 → harmonyo… | 2026-12-14 |
| [C-0002](C-0002-ime-reset-detach.md) | QOhosInputContext::reset() Detach/… | qt-port | 🟠 high | workaround | W-0002 | — | 对齐 Android 插件行为（reset 只 finali… | 2026-12-14 |
| [C-0003](C-0003-ime-focus-switch-race.md) | IME focus 切换瞬间 Detach→Attach 竞态，首字… | qt-port | 🟡 medium | open | — | — | 同 C-0002 组件，随其修复合并提交（commit 前校… | 2026-12-14 |
| [C-0005](C-0005-qt-cmake-isystem-injection.md) | Qt cmake 向每个 CXX 命令注入 -isystem sys… | qt-port | ⬜ blocker | workaround | W-0004 | — | 定位并去除 Qt 对 sysroot/usr/include… | 2026-10-15 |
| [C-0006](C-0006-libcxx-ohos-cmath-promote.md) | libcxx-ohos <cmath> 使用 __promote 但… | ohos-ndk | 🟡 medium | diagnosed | W-0004 | — | SDK/NDK 给 libcxx-ohos <cmath> … | 2026-10-15 |
| [C-0009](C-0009-qpa-syntheticparent-no-transientparent.md) | OHOS QPA syntheticParent fallback … | qt-port | 🟠 high | workaround | W-0007 | — | 上游合入 showImmediate() 反写 setTra… | 2026-12-15 |
| [C-0010](C-0010-stale-template-ohos-bare-eval.md) | 陈旧胶水模板缺 @ohos.* eager import 注册，li… | qt-port | 🔴 critical | workaround | W-0008 | — | Qt 侧模板与 libqohos 同批次更新（eager d… | 2026-12-15 |
| [C-0014](C-0014-crossscreen-move-resize-conflict.md) | ohos window 接口 moveWindowToGlobalD… | ohos-runtime | 🟡 medium | diagnosed | W-0012 | — | 系统侧保证跨屏迁移场景 move+resize 渲染原子性（… | 2026-12-15 |
| [C-0016](C-0016-qfiledialog-unnecessary-ohos-ifdef.md) | 应用误判 QFileDialog 无 OHOS 原生支持而添加 #i… | app | 🟢 low | closed | — | — | 改用法：直接使用标准 QFileDialog API，删除 … | 2026-12-15 |
| [C-0017](C-0017-curl-gbk-terminal-mojibake.md) | 非 UTF-8 终端（Windows Git Bash/GBK）下向… | app | 🟡 medium | workaround | W-0014 | — | 改用法：中文 JSON 写入 UTF-8 临时文件后 cur… | 2026-12-15 |
| [C-0018](C-0018-zink-rgba8-mipmap-black.md) | Mesa ZINK 以 vkCmdBlitImage 实现 glGe… | third-party | 🟠 high | workaround | W-0015 | — | 等 Mesa/ZINK 修复 RGBA8 mipmap 生成… | 2026-12-15 |

**未定（undetermined——等定性，跟上游答复；改判时 CID 不变）**

| CID | 根因 | 领域 | 严重度 | 状态 | 临时方案（W） | 跟踪单（T） | 定性去向 | 复核到期 |
|-----|------|------|:------:|------|--------------|------------|---------|---------|
| [C-0004](C-0004-ability-destroy-tsfn.md) | Ability 销毁窗口不处理 N-API TSFN 回调（Prom… | ohos-runtime | 🔴 critical | reported | W-0003 | T-0001 | 见 C 页 | 2026-12-14 |
| [C-0011](C-0011-the-mainthread-mismatch.md) | theMainThread 与 QCoreApplication::… | undetermined | 🟠 high | diagnosed | W-0009 | — | 见 C 页 | 2026-12-15 |
| [C-0015](C-0015-hvigor-cli-ide-packaging-divergence.md) | hvigor CLI (--mode module) 打包与 Dev… | ohos-toolchain | 🟡 medium | diagnosed | W-0013 | — | 见 C 页 | 2026-12-15 |

## 限制（limitation——规格如此，跟替代方案与演进）

| CID | 限制 | 定性证据 | 替代方案（W） | 演进 | 状态 |
|-----|------|---------|--------------|------|------|
| [C-0007](C-0007-xcomponent-surface-deprecated.md) | ARKUI_XCOMPONENT_TYPE_SURFACE 于 AP… | 华为官方弃用公告（API 20 起）+ ContentSlo… | — | ContentSlot（官方方向）：观察能力覆盖、Qt-… | watching |
| [C-0008](C-0008-sandbox-chmod-symlink.md) | 应用沙箱禁运行时 chmod/symlink（文件权限与链接属打包契… | 应用沙箱规格：文件权限与链接属打包契约（QTBUG-1466… | W-0005；W-0006 | —（规格稳定，无演进方向；若未来平台开放相应能力，复核时… | wontfix |
| [C-0012](C-0012-loader-rejects-writable-path.md) | 应用 loader 拒绝从可写路径加载动态库（代码加载仅限 HAP … | loader 安全规格：动态库仅可从 HAP 打包的 nat… | W-0010 | —（规格稳定，无演进方向；若平台未来开放受控的运行时代码… | wontfix |
| [C-0013](C-0013-sandbox-readonly-bundle-path.md) | OHOS 沙箱 bundle 安装路径只读，桌面式 currentP… | 应用沙箱规格：bundle 安装目录只读，可写区在 /dat… | W-0011 | —（规格稳定：bundle 只读属沙箱安全模型，可写区语… | wontfix |

## 临时方案清单（W）

| W | 方案 | 作用根因 | 状态 | 最近验证 | 退役条件 |
|---|------|---------|------|---------|---------|
| W-0001 | QML 用 Qt.platform.pluginName 判断平台（C++ 用 pr… | C-0001 | adopted | 2026-08-06 Qt 5.15.16 (962aa… | 上游修复进入所用 Qt OHOS SDK（os() 加 Q_… |
| W-0002 | 重编 libqohos.so（reset 只 finalize preedit，不 … | C-0002 | adopted | 2026-09-12 Qt 6.12-beta3 / H… | 上游版本含此修复后恢复官方 kit，移除本地重编流程 |
| W-0003 | 退出补丁：原子变量 s_qtAppThreadIdle + 独立线程并行轮询，绕过 … | C-0004 | adopted | 2026-06-09 Qt 5.12.12 / 真机 | 确认所用 HarmonyOS 版本已在销毁窗口处理 TSFN… |
| W-0004 | 换构建组合：MinGW g++ 13.1.0 host + API 23 SDK +… | C-0005；C-0006 | adopted | 2026-07-13 Qt 6.12.0 全量构建 + … | Qt 去除 -isystem 注入或 SDK 修 C-000… |
| W-0005 | 构建/打包期展开真实文件（替代运行时 symlink） | C-0008 | adopted | — | 无退役预期（wontfix：沙箱规格稳定） |
| W-0006 | 权限需求交平台打包契约，不作运行时业务成功条件 | C-0008 | adopted | — | 无退役预期（wontfix：沙箱规格稳定） |
| W-0007 | 重编 libqohos.so 打 transientParent 反写 patch（… | C-0009 | adopted | 2026-08-06 Qt 5.15.16 / OHOS… | 上游 harmonyos 分支合入 transientPar… |
| W-0008 | 钦定完整版参考模板替换胶水 4 文件（26+13 eager default-imp… | C-0010 | adopted | 2026-07-23 Qt 5.15.16（515 代际… | Qt 源码树模板与 libqohos 同批次更新（eager… |
| W-0009 | main() 约束：QApplication 必须是第一个 Qt API 调用（构造… | C-0011 | proposed | — | 根因确认并根治（或定性为使用约束并文档化转正）后，撤销临时约… |
| W-0010 | 插件 .so 随 HAP lib 目录打包交付（或固定集合静态链接），不做运行时下载… | C-0012 | adopted | — | 无退役预期（wontfix：loader 规格稳定）；若平台… |
| W-0011 | 路径获取加 Q_OS_OHOS 分支：QStandardPaths::writabl… | C-0013 | adopted | 2026-07-09 Qt 5.15.16 / Harm… | 无退役预期（wontfix：bundle 只读规格稳定）；若… |
| W-0012 | 去冗余 resize：size 未变时不触发 resizeAsync，规避跨屏闪烁 | C-0014 | proposed | 2026-06-05 HUAWEI MateBook F… | 系统侧保证跨屏 move+resize 渲染原子性（或提供原… |
| W-0013 | 放弃 hvigor CLI 打包，改用 DevEco Studio IDE Run … | C-0015 | adopted | 2026-08-06 OHOS + Qt 5.15.16… | hvigor CLI 打包差异查明并修复（或 CLI 提供等… |
| W-0014 | 中文 JSON 写入 UTF-8 临时文件后 curl -d @file 引用 | C-0017 | adopted | 2026-06-10 Windows 10/11 + G… | 终端环境可稳定保证 UTF-8（chcp 65001 在所用… |
| W-0015 | OHOS 上 alpha-PNG(RGBA8) 实体关 mipmap（generat… | C-0018 | adopted | 2026-07-14 Qt 5.12.12 OHOS S… | Mesa ZINK 修复 RGBA8 glGenerateM… |

## 跟踪单清单（T）

| T | 平台 | 单号 | 跟踪根因 | 状态 | 修复版本 | 提交日 | 说明 |
|---|------|------|---------|------|---------|--------|------|
| T-0001 | partner | — | C-0004 | submitted | — | 2026-06-09 | ISSUE.md（中英双语根因）+ patch + 可复现 de… |
| T-0002 | qt-bug | [QTBUG-146622](https://bugreports.qt.io/browse/QTBUG-146622) | C-0007 | submitted | — | — | Qt 侧 XComponent SURFACE → Conten… |
| T-0003 | qt-bug | [QTBUG-146619](https://bugreports.qt.io/browse/QTBUG-146619) | C-0008 | submitted | — | — | QFile::setPermissions 平台行为记录（Qt … |
| T-0004 | qt-bug | [QTBUG-146621](https://bugreports.qt.io/browse/QTBUG-146621) | C-0008 | submitted | — | — | QFile::link 平台行为记录（Qt 侧登记，非修复请求） |
| T-0007 | qt-bug | [QTBUG-146624](https://bugreports.qt.io/browse/QTBUG-146624) | C-0012 | submitted | — | — | Qt 侧平台行为记录：QPluginLoader/运行时 .so… |

## 关系速览

```
S-0001 QML 平台守卫静默失效（Qt.…   ──→ C-0001 qqmlplatform os() 的 … [defect/qt-port]
S-0002 拼音组合输入异常：键盘中途收起 …   ──→ C-0002 QOhosInputContext::r… [defect/qt-port]
S-0003 输入框焦点切换后首字符偶发丢失     ──→ C-0003 IME focus 切换瞬间 Detac… [defect/qt-port]
S-0004 qApp->quit() 后应用…   ──→ C-0004 Ability 销毁窗口不处理 N-AP… [undetermined/ohos-runtime]
S-0005 Qt6 OHOS target …   ──┬→ C-0005 Qt cmake 向每个 CXX 命令注… [defect/qt-port]  ← all_of（叠加）
                               └→ C-0006 libcxx-ohos <cmath> … [defect/ohos-ndk]
S-0006 SURFACE 型 XCompo…   ──→ C-0007 ARKUI_XCOMPONENT_TYP… [limitation/ohos-runtime]
S-0007 运行时 chmod / syml…   ──→ C-0008 应用沙箱禁运行时 chmod/symli… [limitation/ohos-runtime]
S-0008 无 parent 的 QDial…   ──→ C-0009 OHOS QPA syntheticPa… [defect/qt-port]
S-0009 Qt5 鸿蒙应用触发 onAcc…   ──→ C-0010 陈旧胶水模板缺 @ohos.* eage… [defect/qt-port]
S-0010 QWidget 应用 Debug…   ──→ C-0011 theMainThread 与 QCor… [undetermined/undetermined]
S-0011 运行时 dlopen 从可写路径…   ──→ C-0012 应用 loader 拒绝从可写路径加载动… [limitation/ohos-runtime]
S-0012 应用启动数秒后 SIGABRT …   ──→ C-0013 OHOS 沙箱 bundle 安装路径只… [limitation/ohos-runtime]
S-0013 多屏拖拽 MainWindow …   ──→ C-0014 ohos window 接口 moveW… [defect/ohos-runtime]
S-0014 hvigor CLI (--mo…   ──→ C-0015 hvigor CLI (--mode m… [undetermined/ohos-toolchain]
S-0015 误为 QFileDialog 添…   ──→ C-0016 应用误判 QFileDialog 无 O… [defect/app]
S-0016 Windows Git Bash…   ──→ C-0017 非 UTF-8 终端（Windows G… [defect/app]
S-0017 Qt3D alpha-PNG(R…   ──→ C-0018 Mesa ZINK 以 vkCmdBli… [defect/third-party]
C→C depends_on：暂无
孤儿症状（causes 为空）：无
```

## 按版本基线（升级检查清单）

换 Qt / OHOS 版本前查这里：目标版本下仍活跃的根因 + 必须随行携带的方案（W id）。

### Qt 5.12.12

| 根因 | 状态 | 携带项（W） |
|------|------|------------|
| C-0001 | workaround | W-0001 |
| C-0004 | reported | W-0003 |
| C-0018 | workaround | W-0015 |

### Qt 5.15.16

| 根因 | 状态 | 携带项（W） |
|------|------|------------|
| C-0001 | workaround | W-0001 |
| C-0009 | workaround | W-0007 |
| C-0010 | workaround | W-0008 |
| C-0011 | diagnosed | W-0009 |
| C-0013 | wontfix | W-0011 |
| C-0015 | diagnosed | W-0013 |

### Qt 6.12

| 根因 | 状态 | 携带项（W） |
|------|------|------------|
| C-0001 | workaround | W-0001 |
| C-0002 | workaround | W-0002 |
| C-0003 | open | — |
| C-0005 | workaround | W-0004 |

### 其他 Qt 版本

| 根因 | 状态 | 影响版本 | 携带项（W） |
|------|------|---------|------------|
| C-0014 | diagnosed | 未记录（源页仅记 libqohos.so 重编插桩采集日志，… | W-0012 |

### OHOS API / 系统版本

| 根因 | 受影响版本 | 携带项（W） |
|------|-----------|------------|
| C-0001 | 全版本（与系统/API 版本无关） | W-0001 |
| C-0002 | HarmonyOS PC（MateBook Pro，物理键盘 + 华为输入法） | W-0002 |
| C-0003 | HarmonyOS PC（华为输入法） | — |
| C-0004 | 真机（系统版本未记录） | W-0003 |
| C-0005 | API 22 (Release 6.0.2.130)；API 24 Beta1 … | W-0004 |
| C-0006 | API 22；API 24 Beta1（libcxx-ohos） | W-0004 |
| C-0007 | API 20+ | — |
| C-0008 | 全版本（沙箱规格） | W-0005；W-0006 |
| C-0009 | 真机（系统版本未记录） | W-0007 |
| C-0010 | HarmonyOS 6.0.0.29（HUAWEI MateBook Fold … | W-0008 |
| C-0011 | 未记录（伙伴反馈案例，设备/系统版本未留） | W-0009 |
| C-0012 | 全版本（loader 规格；源页记录 Qt 5.12/5.15 真机实证） | W-0010 |
| C-0013 | HarmonyOS 6.0（源页实证；bundle 只读为全版本沙箱规格） | W-0011 |
| C-0014 | 未记录（HUAWEI MateBook Fold 双屏真机实证，系统版本未记录） | W-0012 |
| C-0015 | 未记录（hvigor CLI / DevEco Studio 版本源页未记录） | W-0013 |
| C-0018 | 真机 HUAWEI MateBook Fold（NEED_OPENGL=1；AP… | W-0015 |

## 复核到期

| 到期日 | CID | 状态 | 复核要点 |
|--------|-----|------|---------|
| 2026-10-15 | C-0005 | workaround | 新 OHOS SDK / Qt 6.12 是否仍注入 -isystem；libcxx-o… |
| 2026-10-15 | C-0006 | diagnosed | libcxx-ohos <cmath> 是否补 __math/promote.h（随 C… |
| 2026-12-14 | C-0001 | workaround | harmonyos 分支 / qtdeclarative 是否已有 Q_OS_OHOS … |
| 2026-12-14 | C-0002 | workaround | Qt 6.12 下一版 OHOS kit 是否合入 reset 修复；顺手验证丢首字（C… |
| 2026-12-14 | C-0003 | open | 与 C-0002 一并验证（Qt 6.12 下一版 kit） |
| 2026-12-14 | C-0004 | reported | 伙伴/系统侧答复；新系统版本销毁窗口 TSFN 行为；定性改判（CID 不变） |
| 2026-12-14 | C-0007 | watching | ContentSlot 能力覆盖与 Qt-port 迁移节奏（T-0002）；平台对 S… |
| 2026-12-14 | C-0008 | wontfix | 沙箱规格有无变化（chmod/symlink 能力开放则改判） |
| 2026-12-15 | C-0009 | workaround | 查 harmonyos-5.15.16 分支是否已合入 transientParent … |
| 2026-12-15 | C-0010 | workaround | 查 harmonyos-5.15.16 模板是否已换完整版 OhosExportModu… |
| 2026-12-15 | C-0011 | diagnosed | 触发路径三假说未定（app 在 QApplication 前调 Qt API / Qt … |
| 2026-12-15 | C-0012 | wontfix | loader 可写路径限制有无松动（开放受控运行时加载则改判）；T-0007（QTBUG… |
| 2026-12-15 | C-0013 | wontfix | bundle 只读规格有无变化；应用其余写入点（plog/QSettings/临时文件）… |
| 2026-12-15 | C-0014 | diagnosed | severity 校准（商业 Qt 反馈、多屏必现）；向华为侧提单（当前无单号，提单材料… |
| 2026-12-15 | C-0015 | diagnosed | CLI vs IDE 差异的具体机制待调查（NAPI 模块注册环节）；定性改判（defe… |
| 2026-12-15 | C-0017 | workaround | 薄 C 页（app 使用问题）：与 Qt/HarmonyOS 无关（Windows 开发… |
| 2026-12-15 | C-0018 | workaround | Mesa 上游单未提（本库无单号；提单材料=planets-qml 对照实验现成）；Qt… |

## 已了结（verified / closed）

| CID | 根因 | 了结方式 | 修复/迁移版本 |
|-----|------|---------|--------------|
| C-0016 | 应用误判 QFileDialog 无 OHOS 原生支持而添… | closed | — |

## 待处理提醒（check 的 WARN）

- `C-0001`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
- `C-0001`：Qt-side defect evidenced only by 'source': 补最小复现 demo 或运行日志后更稳（提上游 T 前必备，对齐 qt-bug-report HARD 闸门）
- `C-0002`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
- `C-0005`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
- `C-0009`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
- `C-0010`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
- `C-0018`：status=workaround 但链路未闭环（缺 ticket）——按闭环规则不算临时了结，待补齐
