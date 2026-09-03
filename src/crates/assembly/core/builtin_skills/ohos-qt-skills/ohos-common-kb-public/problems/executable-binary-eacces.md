---
id: executable-binary-eacces
title: "HAP 内可执行文件启动失败：execve EACCES"
status: active
confidence: 0.7
sources: [{type: experience, name: "Python/Node/Java hap-bin 真机验证", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-15
last_confirmed: 2026-08-05
superseded_by: null
tags: [problem, runtime, execve, eacces, executableBinaryPaths, signing]
refs: [application-sandbox-paths, native-runtime-embedding]
summary: "HAP 内 ELF bin 因未声明 executableBinaryPaths、签名/permission/profile 不完整或路径视角错误而 execve EACCES。"
audience: public
error_message: |
  execve(...) = -1 EACCES (Permission denied)
  chmod(...) = -1 EPERM (Operation not permitted)
---

# HAP 内可执行文件启动失败：execve EACCES

## 错误信息

```text
execve(<bundle binary>, ...) -> EACCES / Permission denied
chmod(<bundle binary>, 0755) -> EPERM / Operation not permitted
```

## 场景

应用把 Python、Node、Java 或其他 ELF bin 放入 HAP 后启动失败。即使文件存在，执行权限、平台声明、签名完整性和 mount namespace 任一项不满足都可能表现为 Permission denied。

## 原因

按顺序区分：

1. `module.json5` 未通过 `executableBinaryPaths` 声明目标 bin，安装后没有执行属性；
2. bin 使用自签名或缺少平台要求的 profile/permission 信息，完整性校验拒绝；
3. 应用使用了只在 hdc shell namespace 可见的路径；
4. bin ABI、interpreter 或动态依赖不成立，错误被上层简化为启动失败。

## 解决方案

```json5
{
  "module": {
    "extractNativeLibs": true,
    "executableBinaryPaths": [
      { "path": "libs/arm64-v8a/<binary>" }
    ]
  }
}
```

然后重新构建、签名、卸载旧应用并 clean install。不要在应用代码中 `chmod` bundle 文件。若 bin 已有执行属性仍被拒，使用目标 SDK 的签名检查工具确认 profile、permission 与证书链，并核对 bundleName/设备授权；不要把证书、密码或 profile 内容写入日志/KB。

## 预防措施

把 executable 声明、签名检查、ELF/依赖检查和 fresh-install 启动纳入发布门禁；SO 不需要因 `dlopen` 而加入 executableBinaryPaths。
