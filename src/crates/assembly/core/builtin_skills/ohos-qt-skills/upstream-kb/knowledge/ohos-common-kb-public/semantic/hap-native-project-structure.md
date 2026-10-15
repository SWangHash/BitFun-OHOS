---
id: hap-native-project-structure
title: HAP 原生工程结构与签名关系
status: active
confidence: 0.7
sources:
  - type: experience
    name: "Qt、Tauri 与 AWT/Swing HAP 工程实践"
    date: 2026-08-06
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-06
review_by: null
superseded_by: null
tags: [hap, appscope, module-json5, build-profile, signing, native-libs]
refs: [hap-application-identity, ohos-native-third-party-libraries]
summary: "AppScope、module.json5、build-profile、native libs、product 与 signingConfig 的平台关系。"
audience: public
---

# HAP 原生工程结构与签名关系

## 配置层次

| 文件/目录 | 平台职责 |
|---|---|
| `AppScope/app.json5` | 应用级身份与展示元数据，例如 bundleName |
| `build-profile.json5` | products、modules、build mode、SDK 与 signingConfigs |
| `<module>/src/main/module.json5` | module/Ability、设备类型、权限、skills 与 native/executable 声明 |
| `<module>/libs/<abi>/` | 随模块打包的目标 ABI native libraries/binaries |
| `<module>/src/main/ets/` | Ability、页面和 ArkTS glue |
| `<module>/src/main/cpp/` | Node-API/native module 与 CMake 工程 |
| resources/rawfile/resfile | 随包资源；运行时是否可写/可执行由沙箱契约决定 |

框架模板可以增加自己的常量、生成脚本和 glue，但不能改变这些平台层次的所有权。

## Native artifact 契约

- 目录 ABI 必须与构建 target 和设备一致。
- HAP 中的库名必须与 ArkTS `libraryname`、Node-API module、框架 loader 或 CMake 产物一致。
- `.so` 依赖闭包必须随包或由目标系统提供；主机构建成功不证明设备 loader 可解析。
- 需要 `execve` 的 bin 与普通 `.so` 使用不同的声明、权限和签名检查；具体运行时集成由对应框架 adapter 与受控交付流程维护。

## Product 与签名

定义 `signingConfigs` 本身不会让 product 自动采用签名。目标 product 必须引用对应 `signingConfig`，profile 还必须匹配 bundleName、设备与权限授权。

签名材料不得提交。共享页只记录字段关系、生成方式和验证步骤，不记录证书路径、密码、设备身份或可复用 profile。

## 验证顺序

1. schema/配置检查；
2. product/module/SDK/ABI 对齐；
3. native artifact 与依赖闭包；
4. signingConfig 引用和应用身份；
5. build 产物中实际包含目标文件；
6. 安装、启动与系统日志；
7. fresh clone/fresh package 重建。
