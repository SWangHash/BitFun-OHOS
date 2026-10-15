---
id: problem-build-fail-magic-enum-bracket-depth
type: problem
domain: build
tags: [magic-enum, bracket-depth, clang, fold-expression, cmake]
created: 2026-08-08
updated: 2026-08-08
status: solved
severity: medium
audience: public
refs: [semantic-qt-harmonyos-golden-rules]
summary: >
  使用 magic_enum 的 C++ 项目在 OHOS clang 下编译失败：fold 表达式嵌套层数超
  clang 默认 bracket-depth 限制（256）。CMakeLists 添加 -fbracket-depth=1000 解决。
leader_summary: >
  沉淀 magic_enum fold 表达式在 OHOS clang 上的 bracket-depth 编译失败解决方案。
impact: [编译排障, 迁移提效]
deliverables: [problem记录]
evidence: [xi-qt 编译日志]

error_message: >
  fatal error: bracket depth exceeded in evaluation of expression
  note: use -fbracket-depth=N to increase maximum nesting level
  constexpr int num_valid = ((valid[I] ? 1 : 0) + ...);
error_code: ""
keywords: [magic_enum, bracket-depth, fold-expression, fbracket-depth, clang]
symptoms: "编译含 magic_enum 的源文件时报 bracket depth exceeded"

environment: "macOS / OHOS clang 15 / Qt 5.15.16 OHOS SDK / magic_enum header-only"
---

# magic_enum fold 表达式 bracket-depth 超限

## 错误信息

```
magic_enum.hpp:162:51: note: use -fbracket-depth=N to increase maximum nesting level
  constexpr int num_valid = ((valid[I] ? 1 : 0) + ...);
                                                  ^
1 error generated.
```

## 场景

xi-qt 项目使用 magic_enum（header-only 枚举反射库），其 `line_cache.cpp` 中 `to_enum<xi::Op>` 触发 `magic_enum::enum_cast`，内部展开 257 元素的 fold 表达式，超出 clang 默认 bracket-depth（256）。

## 原因

magic_enum 对大枚举（如 xi::Op 有 257 个值）使用 C++17 fold 表达式展开所有枚举值。clang 默认 `fbracket-depth=256`，fold 表达式嵌套层数超过此限制。

## 解决方案

CMakeLists.txt 中给目标添加编译选项：

```cmake
target_compile_options(<target> PRIVATE -fbracket-depth=1000)
```

## 注意事项

- 仅影响含 magic_enum 且枚举值较多的项目
- GCC 默认 bracket-depth 更高，桌面平台可能不触发
- 值设 1000 足够覆盖大多数枚举

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 magic_enum fold 表达式在 OHOS clang 上的 bracket-depth 编译失败解决方案 |
| 影响面 | 使用 magic_enum 的 Qt 鸿蒙化迁移 |
| 交付物 | problem 记录 |
| 证据 | xi-qt 编译日志 |
| 可复用方式 | 编译报 `bracket depth exceeded` 且用了 magic_enum → 加 `-fbracket-depth=1000` |

## 相关

- [[qt-harmonyos-golden-rules]] §一（构建铁律）
