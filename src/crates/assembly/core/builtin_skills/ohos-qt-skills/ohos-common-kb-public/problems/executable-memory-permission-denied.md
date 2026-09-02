---
id: executable-memory-permission-denied
title: "JIT/运行时启动崩溃：可执行内存权限未授权"
status: active
confidence: 0.7
sources:
  - type: experience
    name: "AWT/Swing JVM CodeCache 真机验证"
    date: 2026-07-30
  - type: experience
    name: "Node V8 与 JVM hap-bin 真机验证"
    date: 2026-08-05
created: 2026-08-13
updated: 2026-08-15
last_confirmed: 2026-08-05
superseded_by: null
tags: [problem, runtime, jit, mmap, permission, signing]
refs: [native-runtime-embedding, hap-native-project-structure]
summary: "V8/HotSpot 等 JIT 因 writable executable memory 权限或 profile ACL 不成立而 ENOMEM/SIGABRT；声明权限并验证签名授权。"
audience: public
error_message: |
  Check failed: 12==errno (ENOMEM)
  CodeCache::initialize()
  JNI_CreateJavaVM
  Reason: Signal:SIGABRT
---

# JIT/运行时启动崩溃：可执行内存权限未授权

## 错误信息

```text
V8: Check failed: 12==errno (ENOMEM)
HotSpot: CodeCache::initialize -> JNI_CreateJavaVM -> SIGABRT
```

## 场景与原因

V8、HotSpot 等 JIT 需要动态生成机器码。平台安全策略限制可写/可执行内存；只在 `module.json5` 写权限名但签名 profile 没有相应 ACL，也不会获得授权。

## 解决方案

1. 确认失败确实发生在 JIT/code cache 的 executable-memory 分配，而不是普通内存不足；
2. 按目标系统要求声明 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`；
3. 使用获准该系统权限、与 bundle/设备匹配的 profile 完成签名；
4. clean install 后验证权限结果、进程启动和运行时日志。

不要宣称任意“自动签名”一定授予系统权限。是否可申请、授予和在哪类设备生效由平台策略、账号/证书类型与 profile 决定。

解释器模式或关闭 JIT 可作为运行时支持时的风险降低方案，但必须单独验证性能与功能，不能作为默认通用修复。

## 预防措施

运行时选型阶段列出 JIT/exec/mmap 要求；发布证书和调试证书分别验证，不复用其他项目 profile。
