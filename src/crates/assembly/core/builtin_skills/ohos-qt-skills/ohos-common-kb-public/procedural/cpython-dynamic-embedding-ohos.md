---
id: cpython-dynamic-embedding-ohos
title: CPython 动态库嵌入 HarmonyOS 应用
status: active
confidence: 0.5
sources: [{type: experience, name: "expressPython Qt/OHOS 动态嵌入验证", date: 2026-08-04}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-04
review_by: null
superseded_by: null
tags: [cpython, embedding, shared-library, ohos, runtime]
refs: [application-sandbox-paths, ohos-native-third-party-libraries]
summary: "以 libpython + C API 在 HarmonyOS 进程内嵌入 CPython，部署 stdlib/依赖并验证初始化、线程与路径。"
audience: public
---

# CPython 动态库嵌入 HarmonyOS 应用

## Why:

进程内 SO 模式避免额外 executable/bin 签名和 IPC，但 Python ABI、stdlib、扩展模块、路径、GIL 与 host 生命周期都进入同一进程故障域。

## How to apply:

1. 使用 OHOS NDK 构建或取得同 ABI、同 Python minor version 的 `libpython`、stdlib 与所需 extension modules。
2. 将 `.so` 及完整 `NEEDED` 闭包放入 HAP native library 目录，将 Python stdlib 放入只读资源目录。
3. 运行时从平台/框架 context 得到 bundle/resource 与 writable data 路径，不硬编码 hdc shell 路径。
4. 在 `Py_Initialize` 前通过受支持的 Python config API 设置 home、module search paths、program name 和 argv。
5. 初始化后导入最小标准库模块，再加载业务脚本；extension module 逐个验证 ABI/符号。
6. host 多线程调用 Python 时明确 GIL 获取/释放；shutdown 时停止回调/线程后再 finalize。
7. clean install 验证无外部 `PYTHONHOME/PYTHONPATH`、开发机文件或缓存依赖。

## 部署检查

- Python minor version、stdlib 与 `libpython` 完全匹配；
- encodings/importlib 等启动必需模块存在；
- `.pyc`/cache 写入指向可写数据目录，不能污染 bundle；
- extension `.so` 使用 OHOS ABI 且依赖闭包完整；
- locale、UTF-8、证书、时区和文件系统需求单独验证。

## Adapter 边界

common 维护 CPython C API 初始化和平台部署 invariant。Qt main thread/event loop、Tauri command、JVM bridge 或 .NET host 代码留在对应框架仓。当前证据来自 Qt host，因此其他 host 采用前必须做最小原生复验。
