---
id: stage-uiability-lifecycle
title: Stage 模型与 UIAbility 生命周期
status: active
confidence: 0.7
sources:
  - type: official
    name: "HarmonyOS Stage 模型与 UIAbility 开发指南"
    date: 2026-08-03
    uri: "https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/uiability-overview"
  - type: experience
    name: "Qt Stage/UIAbility、Want 与生命周期适配实践"
    date: 2026-08-03
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-03
review_by: null
superseded_by: null
tags: [stage, uiability, lifecycle, want, skills, launch-type]
refs: []
summary: "Stage/UIAbility 的创建、WindowStage、Want 路由、launchType、skills 与保存恢复平台语义。"
audience: public
---

# Stage 模型与 UIAbility 生命周期

Stage 模型以应用、module、AbilityStage 和 UIAbility 组织带界面应用。跨平台框架通常把自己的 event loop、窗口和启动参数接到这一生命周期上，但不能替代平台回调及 manifest 路由。

## 核心对象

| 对象 | 作用 | Adapter 不应混淆的概念 |
|---|---|---|
| `AbilityStage` | module 级运行上下文与生命周期入口 | 不等同于框架 application singleton |
| `UIAbility` | 带界面的应用组件，接收 Want 和生命周期事件 | 不等同于任意一个框架 window |
| `WindowStage` | UIAbility 的窗口舞台与主窗口承载 | 框架可能在一个 WindowStage 中管理多个内部窗口 |
| `Want` | 指定目标、action、URI、类型与 parameters 的启动描述 | 框架 argv/IPC 是 adapter 映射，不是 Want 本身 |

## 启动与恢复

典型顺序为：系统根据 `module.json5` 创建/复用 UIAbility → `onCreate(want, launchParam)` → `onWindowStageCreate(windowStage)` → 页面/原生内容加载 → 前后台生命周期变化。

冷启动与热启动必须分别处理：新实例从 `onCreate` 获得初始 Want；已存在实例可能通过 `onNewWant` 接收后续请求。不要只验证冷启动后宣称 deep link、打开文件或分享接收完整可用。

状态保存与恢复受系统回调时机和资源限制约束。需要持久化的业务数据应写入应用数据层，不能依赖进程持续存活或在终止回调中执行长操作。

## Want 路由

- **显式 Want** 通常给出 bundle/module/ability，目标明确；
- **隐式 Want** 通过 action、entities、URI/MIME 等与目标 Ability 的 `skills` 匹配；
- 可被外部启动的能力还需满足平台的 exported、权限和 skills 配置；
- URI/parameters 的数据结构与访问权限要按目标 API 处理，不能把它们直接当普通文件路径或命令行字符串。

`module.json5` 中的 actions/entities/uris 定义系统如何发现目标。框架页面应保留“如何把 Want 映射到框架事件/参数”，common 维护匹配与生命周期 invariant。

## launchType 与实例

平台支持的 launchType 决定新 Want 创建新实例还是路由到已有实例。进程数、任务数、UIAbility 实例数和框架顶层窗口数是不同维度；多窗口框架不得用“创建第二个框架窗口”推断一定创建第二个 Ability 或系统任务。

## 关闭与后台

窗口关闭、UIAbility 终止、任务移除、系统回收和进程强杀不是同一事件。Adapter 可把部分事件映射为框架 close/background 回调，但必须：

1. 记录触发来源；
2. 区分可交互关闭与限时保存；
3. 不承诺强杀可拦截；
4. 用系统生命周期和进程日志验证，而不只观察框架 window 状态。

## 验证矩阵

至少覆盖冷启动、热启动新 Want、前后台切换、任务中心关闭、窗口关闭、进程被系统终止后的恢复、显式/隐式 Want、无匹配目标、权限拒绝和多实例配置。

