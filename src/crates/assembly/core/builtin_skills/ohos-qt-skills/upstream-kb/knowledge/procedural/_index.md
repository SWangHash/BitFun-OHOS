---
domain: procedural
description: >
  程序知识域索引。工作流、操作步骤。
---

# procedural

## 本域知识页

- [demo-generation](demo-generation.md) — 独立 Demo 生成工作流（六步闭环）：需求理解→技术设计→工程创建→代码编写→编译验证→文档沉淀。 适用于用户直接要求"写一个 demo"/"生成测试工程"等独立 demo 创建场景。 区别于框架问题分析中嵌入的复现 demo 生成。
- [fetch-ohos-third-party-lib](fetch-ohos-third-party-lib.md) — 从 Harmonybrew 一键下载 arm64-OpenHarmony 预编译 bottle（.so）并校验解压， 免交叉编译即可链接到 Qt 鸿蒙工程。含依赖递归、qmake/CMake 链接片段、版本解析陷阱。
- [framework-fix-verification](framework-fix-verification.md) — 框架问题修复验证工作流：获取验证清单→编写验证工程→人工手动验证→记录验证结果。 用于系统性地验证Qt框架bug修复的有效性。
- [framework-issue-analysis](framework-issue-analysis.md) — 框架内部问题分析工作流（四阶段闭环）：复现demo生成→编译修复迭代→问题定位(日志法)→根因分析(框架代码调用链)→系统接口验证→上游issue打包提交（工作流最终步骤）。 阶段四为工作流闭合点：生成clean patch、整理issue说明单、输出纯Qt复现demo、更新知识库索引。 适用于Qt框架在鸿蒙平台的bug分析。
- [llvm-ohos-cross-compile](llvm-ohos-cross-compile.md) — Qt/QLogo 接入 OHOS arm64 LLVM 15 静态库的 adapter：保留 Qt 目标链接、QLogo JIT 所需库闭包、部署与回归检查；通用 OHOS NDK/LLVM 交叉编译流程由 common 维护。
- [qt-app-harmonyos-completion](qt-app-harmonyos-completion.md) — 应用鸿蒙化完善工作流（功能级测试用例闭环,四阶段）：扫描应用源码识别核心功能点→生成10核心测试用例（AI扫源码+人工review）→ 人工测试/反馈问题/修复/回归循环→10用例全pass闭合。前置：运行测试(qt-ohos-run-test)通过。 含三件套(ASCII循环图/循环退出条件✅10用例全pass/门控检查⚠️)。
- [qt-app-harmonyos-full-pipeline](qt-app-harmonyos-full-pipeline.md) — 把 Qt 应用鸿蒙化分散工作流缝合为一份端到端编排：公共库提供 HarmonyOS 生命周期、窗口与平台限制的规范事实，本页负责将其落到 Qt 迁移、构建、签名、部署、测试和上库的 8 个阶段。覆盖 Qt5.12/5.15/6.12，并标注 Qt6 端到端 run+test 与应用分发缺口。
- [qt-app-harmonyos-migration](qt-app-harmonyos-migration.md) — Qt应用鸿蒙化迁移工作流：评估可行性→创建工程结构→按8步决策树逐步迁移→编译验证→知识积累。 将其他平台的Qt应用迁移到HarmonyOS平台的端到端流程。
- [qt-bug-report-generation](qt-bug-report-generation.md) — Bug report 生成工作流：从对话上下文或已有 problem 页提取信息→填内嵌模板→自检可复现性（HARD 闸门）→ 产出两种形态（form A 完整交付件交付华为 / form B 精简版贴 issue tracker）。外部伙伴只看本页 + 样例页即可学会写 bug report，模板结构内嵌于本页，不依赖任何内部模板文件。
- [qt-bug-report-sample](qt-bug-report-sample.md) — 样例（形态 A）：Qt5.15 鸿蒙应用触发 onAcceptWant 时 @ohos.deviceInfo 裸 eval 被 ArkTS 运行时拒致崩溃； triage 结论 Qt 框架（陈旧胶水模板未 eager-import 注册模块），已 Qt 侧修复。
- [qt-cef-ohos-dev-guide](qt-cef-ohos-dev-guide.md) — Qt + CEF 鸿蒙开发指导（公开·自含·版本中立）：鸿蒙 Qt 无 QtWebEngine（Out of scope），CEF for OpenHarmony （chromium_cef）是完整 Chromium 内核的 web 嵌入平替。**不绑定特定 Qt 版本**（Qt5.12/5.15/Qt6 通用，按 §5.1 读你 Qt OHOS SDK 头适配）。CEF 以**去版本化的组件包**提供——维护者从 chromium_cef 版本化下载剥离内核层（libcef.so+ wrapper+include+cmake+OHOS adapter）、按版本标注、与应用/胶水解耦，放指定位置供开发者下载；集成版本中立 （find_package(CEF)+CEF_ROOT，读组件 include/ 找该版本 API）。Part 1 版本稳定核心 + Part 2 集成实例（给定 CEF 组件包 + 你的 Qt OHOS SDK）。WebEngine→CEF API 映射 + 迁移步骤 + §5 版本升级适配方法论。
- [qt-ohos-run-test](qt-ohos-run-test.md) — 鸿蒙化运行测试工作流（CLI全流程,七阶段闭环）：环境SDK预检→构建静态预检(DT_NEEDED/符号可见性/QML插件部署)→ 签名安装→启动运行时测试(渲染黑屏三类定位/Ability生命周期退出/窗口行为回归/输入事件/平台限制回归)→ 崩溃日志分析→修复回归→Playbook B Demo。聚焦让应用在真机跑起来,非全量功能验证(功能用例闭环见应用鸿蒙化完善)。 含三件套(ASCII循环图/循环退出条件✅/门控检查⚠️)。被应用移植/构建排障/修复验证复用。
- [qt6-ohos-manual-deploy](qt6-ohos-manual-deploy.md) — 规避 harmonydeployqt6（Qt6.12 Beta2）5 个部署缺陷的手动部署流程：从 SDK templates 复制 DevEco 工程骨架 + 手动部署业务 .so + libqohos + Qt6 运行时 + QML 模块 qmldir + QML 插件 .so + QML 插件 Qt6 依赖 到正确位置（libs/ vs resfile/qml/）+ 配置 APP_LIBRARY_NAME + 签名 build。完全不调 harmonydeployqt6。
- [qt6-ohos-windows-cli-deploy](qt6-ohos-windows-cli-deploy.md) — 用预构建安装器装的 Qt 6.12.0 Beta2 在 Windows 命令行端到端编译 Qt 项目并生成鸿蒙 DevEco 工程： 官方 wiki CLI 工作流（qt-cmake → cmake --build → harmonydeployqt6 → DevEco 签名装设备） + 本机实际路径（${QT6_INSTALL_ROOT}、${DEVECO_STUDIO} junction、API 23 native）+ 预构建省 patch（NEEDED 已裸名、qt_add_executable 自动 main GLOBAL DEFAULT）。补 wiki 未覆盖的 QT_CHAINLOAD_TOOLCHAIN_FILE 必填、DevEco 空格陷阱、_make_hap 一键目标、签名六件套。
