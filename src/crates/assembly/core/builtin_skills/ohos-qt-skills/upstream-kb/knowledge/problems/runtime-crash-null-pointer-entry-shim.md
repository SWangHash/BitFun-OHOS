---
id: problem-runtime-crash-null-pointer-entry-shim
type: problem
domain: runtime
tags: [qt, harmonyos, null-pointer, sigsegv, entry-shim, main-cpp, crash]
created: 2026-07-08
updated: 2026-07-10
status: solved
severity: critical
audience: public
refs: [semantic-qt-harmonyos-build-run-workflow, procedural-qt-ohos-run-test]
summary: >
  OHOS入口shim（main.cpp）跳过原始登录流程直接传nullptr给MainWindow，
  下游initSet()未做空指针保护导致SIGSEGV崩溃。修复：对业务指针加if-null守卫+安全默认值。
leader_summary: >
  解决OHOS入口shim跳过初始化流程导致的空指针崩溃，提炼为entry shim设计模式。
impact: [迁移提效]
deliverables: [problem记录, 源码修复]
evidence: [RedisView真机验证commit, 崩溃日志]
error_message: >
  Signal:SIGSEGV(SEGV_MAPERR)@0x0000000000000040  probably caused by NULL pointer dereference
  #00 QString::QString(QString const&)
  #01 RedisCluster::getConnectName() const
  #02 MainWidget::initSet(RedisCluster*)
  #03 MainWidget::MainWidget(RedisCluster*, QWidget*)
  #04 MainWindow::mainWidget()
  #05 MainWindow::init(RedisCluster*)
  #06 MainWindow::MainWindow(RedisCluster*, QWidget*)
  #07 main+224
error_code: ""
keywords: [SIGSEGV, NULL pointer, nullptr, entry shim, main.cpp, OHOS, MainWindow, initSet]
symptoms: "应用启动后约1秒崩溃（C++ SIGSEGV），QtMainThread栈帧显示空指针解引用"
environment: "Qt 5.15.16 OHOS / HarmonyOS 6.0 / HUAWEI MateBook 14"
---

# OHOS 入口 shim 传 nullptr 导致业务代码空指针崩溃

## 错误信息

```
Reason:Signal:SIGSEGV(SEGV_MAPERR)@0x0000000000000040  probably caused by NULL pointer dereference
Fault thread info:
Tid:57608, Name:QtMainThread
#00 pc 000000000015ec68 libOhosRedisView.so(QString::QString(QString const&)+32)
#01 pc 00000000001c3638 libOhosRedisView.so(RedisCluster::getConnectName() const+52)
#02 pc 00000000001cb55c libOhosRedisView.so(MainWidget::initSet(RedisCluster*)+996)
#03 pc 00000000001caeb0 libOhosRedisView.so(MainWidget::MainWidget(RedisCluster*, QWidget*)+472)
#04 pc 000000000017ebfc libOhosRedisView.so(MainWindow::mainWidget()+48)
#05 pc 00000000001769fc libOhosRedisView.so(MainWindow::init(RedisCluster*)+192)
#06 pc 00000000001768e0 libOhosRedisView.so(MainWindow::MainWindow(RedisCluster*, QWidget*)+132)
#07 pc 000000000016eab4 libOhosRedisView.so(main+224)
```

## 场景

Qt 鸿蒙化应用构建成功、安装成功、`libqohos.so` 加载成功，但启动后约 1 秒 C++ 层崩溃。

## 原因

**原始应用流程**：`AppMain.cpp` → 弹出 `LoginDialog` → 用户输入 Redis 连接信息 → 创建 `RedisCluster` 对象 → 传给 `MainWindow`。

**OHOS 入口 shim**（`OhosExampleApp/main.cpp`）：为了简化鸿蒙化验证，跳过了登录对话框，直接传 `nullptr`：

```cpp
// OhosExampleApp/main.cpp
MainWindow w(nullptr);  // ← 传空指针
w.show();
return app.exec();
```

**崩溃链**：
```
main(nullptr)
  → MainWindow::init(nullptr)        // _redisClient = nullptr
    → MainWindow::mainWidget()        // new MainWidget(nullptr)
      → MainWidget::initSet(nullptr)  // _redisClient = nullptr
        → _redisClient->getConnectName()  // ← 解引用 nullptr → SIGSEGV
```

`initSet()` 中第 111 行直接调用 `_redisClient->getConnectName()` 而未检查空指针。偏移 0x40 对应 `RedisCluster` 类中 `_ConnectName`（QString）成员的偏移量。

## 解决方案

在 `MainWidget::initSet()` 中对 `_redisClient` 加空指针保护：

```cpp
_redisClient = redisClient;
if(_redisClient) {
    _strConnectName = _redisClient->getConnectName();
    _isClusterMode = _redisClient->getClusterMode();
    _isReplicationMode = _redisClient->getReplicationMode();
    _isCustomMode = _redisClient->getCustomMode();
    // ... 原有初始化逻辑 ...
    _vClients = _redisClient->getClients(false);
    _vMasterClients = _redisClient->getClients(true);
} else {
    _strConnectName = "";
    _isClusterMode = false;
    _isReplicationMode = false;
    _isCustomMode = false;
    _idbNums = 16;
}
```

## 通用排查方法

对于所有使用 OHOS 入口 shim 的迁移项目：

1. **检查 main.cpp 传入的参数**：如果原始 `main()` 通过对话框/配置文件创建对象后传给 MainWindow，shim 中传 `nullptr` 时下游必须有保护
2. **搜索所有解引用点**：`grep "_redisClient->" *.cpp` 确认哪些在启动路径上（构造函数/init 函数）
3. **区分启动路径 vs 交互路径**：只有启动路径上的解引用需要立即保护，slot 函数中的可以延迟到用户操作时

## 注意事项

- 这是 OHOS 入口 shim 的通用问题模式，不限于 RedisView
- 任何原始应用依赖「先初始化后创建窗口」流程的项目，shim 中都需要添加空指针守卫
- 长期方案：在 shim 中实现最小化的初始化流程（如从配置文件读取连接信息）

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 解决 OHOS 入口 shim 跳过初始化导致的空指针崩溃，提炼为通用设计模式 |
| 影响面 | 所有使用 entry shim 模式的 Qt 鸿蒙化项目 |
| 交付物 | problem 记录 + 源码修复 |
| 证据 | RedisView 真机验证 commit |
| 可复用方式 | 遇到 entry shim + SIGSEGV + 业务代码栈帧时直接复用 |

## 相关

- [[qt-harmonyos-build-run-workflow]] — 构建运行工作流
