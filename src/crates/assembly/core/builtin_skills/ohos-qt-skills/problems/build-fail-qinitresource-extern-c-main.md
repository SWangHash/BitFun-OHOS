---
id: problem-build-fail-qinitresource-extern-c-main
type: problem
domain: build
tags: [build, link, qresource, rcc, extern-c, main, ohos, porting, lld]
created: 2026-07-10
updated: 2026-07-10
status: solved
severity: medium
audience: public
refs: [semantic-qt-harmonyos-project-structure, procedural-qt-app-harmonyos-migration, problem-build-fail-glibc-internal-symbols-ohos-musl]
summary: >
  Qt OHOS 入口 shim 用 `extern "C" int main`（供胶水 dlsym("main") 可见）。在 extern "C" main 内调
  `Q_INIT_RESOURCE(name)` 会让宏内部 `extern int qInitResources_##name()` 声明继承 C 链接，与 rcc 生成
  的 C++ 链接定义不匹配，ld.lld 报 undefined symbol: qInitResources_<name>。首选解：省略 Q_INIT_RESOURCE
  ——共享库中 qrc 的 static initializer 在 .so 加载时自动注册资源。
leader_summary: 沉淀 Qt OHOS 入口 shim（extern "C" main）与 Q_INIT_RESOURCE 的链接冲突标准解法
impact: [迁移提效, 编译排障]
deliverables: [problem记录, tcpview HAP, veles HAP]
evidence: [tcpview-ohos attempt2 build.log (qInitResources_tcpview undefined), attempt3 BUILD SUCCESSFUL; veles-ohos build.log (qInitResources_veles undefined) → split veles_run(C++)+extern-C-main → BUILD SUCCESSFUL]

error_message: >
  ld.lld: error: undefined symbol: qInitResources_tcpview
  >>> referenced by main.cpp:17
  >>>               CMakeFiles/.../main.cpp.o:(main)
  >>> did you mean to declare qInitResources_tcpview() as extern "C"?
  >>> defined in: CMakeFiles/.../qrc_tcpview.cpp.o
error_code: ""
keywords: [Q_INIT_RESOURCE, qInitResources, extern "C" main, rcc, qrc, ld.lld, undefined symbol, link, language linkage]
symptoms: Qt OHOS app 入口 shim 用 extern "C" main + 有 .qrc 资源，链接报 undefined symbol: qInitResources_<name>
environment: OHOS Qt5.15.16 + lld（aarch64-linux-ohos）；tcpview（tcpview.qrc + 原 main.cpp 有 Q_INIT_RESOURCE）
---

# Q_INIT_RESOURCE 与 extern "C" main 的链接冲突

## 错误信息

```
ld.lld: error: undefined symbol: qInitResources_tcpview
>>> referenced by main.cpp:17 (.../OhosExampleApp/main.cpp:17)
>>>               CMakeFiles/OhosTcpView.dir/main.cpp.o:(main)
>>> did you mean to declare qInitResources_tcpview() as extern "C"?
>>> defined in: CMakeFiles/OhosTcpView.dir/OhosTcpView_autogen/.../qrc_tcpview.cpp.o
clang++: error: linker command failed with exit code 1
```

## 场景

Qt OHOS 应用入口 shim（场景二，复制自 Qt 模板）标准写法是 `extern "C" int main(int argc, char*argv[])`，
保证 `main` 以 C 链接出现在动态符号表，供 Qt OHOS 胶水 `dlsym("main")` 找到。若该 main 内调
`Q_INIT_RESOURCE(name)`（应用原 main.cpp 常有，注册 .qrc 资源），链接阶段报上述 undefined symbol。

## 原因

`Q_INIT_RESOURCE(name)` 宏展开含 `extern int qInitResources_##name();` 声明。该声明位于
`extern "C" int main() { ... }` 函数体内时继承 C 语言链接（unmangled 裸名），main.o 引用裸名
`qInitResources_<name>`；而 rcc 生成的 `qrc_<name>.cpp` 把该函数定义成 C++ 链接（mangled）。lld 找不到
裸名 → undefined symbol，并提示 "did you mean to declare ... as extern C?"。

## 解决方案

**首选：省略 Q_INIT_RESOURCE。** 共享库（OHOS Qt app 是 .so）中，rcc 生成的 `qrc_<name>.cpp` 含
namespace-scope static initializer `qRegisterResourceData(...)`，在 .so 加载时自动注册资源（其 .o 已在
链接行）。Q_INIT_RESOURCE 仅用于强制从静态 archive 拉入资源（"唯一引用是 Q_INIT_RESOURCE" 场景），
共享库里冗余。从 extern "C" main 中删掉 `Q_INIT_RESOURCE(name);` 即解链接错误，资源照常注册。

```cpp
// OhosExampleApp/main.cpp —— 删除 Q_INIT_RESOURCE(tcpview);
extern "C" int main(int argc, char *argv[]) {
#if QT_VERSION < QT_VERSION_CHECK(6, 0, 0)
    QCoreApplication::setAttribute(Qt::AA_EnableHighDpiScaling);
#endif
    // Q_INIT_RESOURCE(tcpview);  // 省略：.so 自动注册 + 避免与 extern "C" main 链接冲突
    QApplication app(argc, argv);
    ...
}
```

**次选**（需保留显式注册）：把 Q_INIT_RESOURCE 移到一个 C++ 链接的 helper（非 extern "C"），由 main 调：
```cpp
static void initResources() { Q_INIT_RESOURCE(name); }   // C++ 链接，与 rcc 定义匹配
extern "C" int main(...) { initResources(); ... }
```

## 注意事项

- 删除前确认 `qrc_<name>.cpp.o` 确在链接行（CMake AUTORCC ON + .qrc 在 target sources 即满足）。
  链接无 `--gc-sections` 时 static initializer 不会被回收。
- 原 Linux 构建 main 是普通 C++ `int main`（非 extern "C"），Q_INIT_RESOURCE 与 rcc 同为 C++ 链接，
  不冲突——故该问题只在 OHOS（extern "C" main shim）出现。
- 若运行时图标/翻译缺失，回退次选方案（helper）。
- 资源仍注册的判据：.so 链接了 qrc_<name>.cpp.o + 无 --gc-sections → static initializer 运行 → 资源注册。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 OHOS 入口 shim（extern "C" main）与 Q_INIT_RESOURCE 链接冲突的标准解法 |
| 影响面 | 所有带 .qrc 资源的 Qt 应用 OHOS 移植（入口 shim 都用 extern "C" main）|
| 交付物 | problem记录 + tcpview HAP |
| 证据 | attempt2 build.log（qInitResources_tcpview undefined）→ 删除 Q_INIT_RESOURCE → attempt3 BUILD SUCCESSFUL |
| 可复用方式 | 以后 OHOS app 链接报 `undefined symbol: qInitResources_<name>` 直接删 Q_INIT_RESOURCE |

## 相关

- [[semantic-qt-harmonyos-project-structure]] — OHOS 工程结构 + extern "C" main shim
- [[procedural-qt-app-harmonyos-migration]] — 迁移工作流
- [[build-fail-glibc-internal-symbols-ohos-musl]] — 同批次（tcpview）的另一编译问题
