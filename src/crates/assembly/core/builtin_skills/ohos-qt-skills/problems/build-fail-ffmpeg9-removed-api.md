---
id: problem-build-fail-ffmpeg9-removed-api-av-stream-get-codec-timebase
type: problem
domain: build
tags: [ffmpeg, api-change, ffmpeg9, av_stream_get_codec_timebase]
created: 2026-08-24
updated: 2026-08-24
status: solved
severity: medium
audience: public
refs: [semantic-qt-harmonyos-third-party-libs]
summary: >
  FFmpeg 9.x 移除了 av_stream_get_codec_timebase() 函数，使用旧 API 的代码编译失败。
  替换为 st->time_base（stream time base），功能等价。
leader_summary: >
  沉淀 FFmpeg 9.x API 兼容性修复方案。
impact: [迁移提效, 编译排障]
deliverables: [problem记录]
evidence: [QCTools 编译通过]
error_message: >
  error: use of undeclared identifier 'av_stream_get_codec_timebase'
error_code: ""
keywords: [ffmpeg, av_stream_get_codec_timebase, time_base, api-removal, ffmpeg9]
symptoms: 编译 FFmpeg 相关代码时报 undeclared identifier
environment: FFmpeg 9.0.1 (Harmonybrew arm64_ohos), OHOS clang 15
---

# FFmpeg 9.x 移除 av_stream_get_codec_timebase

## 错误信息

```
error: use of undeclared identifier 'av_stream_get_codec_timebase'
```

## 场景

QCTools 使用 `av_stream_get_codec_timebase(stream->stream())` 获取编解码器时基，FFmpeg 9.0.1 中该函数已移除。

## 原因

FFmpeg 5+ 移除了 `AVStream->codec` 字段，`av_stream_get_codec_timebase()` 返回的 codec time base 也不再可用。函数在 FFmpeg 9.x 中完全移除。

## 解决方案

替换为 `stream->time_base`（stream time base）：

```cpp
// 旧（FFmpeg < 9）
rational_to_string(av_stream_get_codec_timebase(stream->stream()), '/')

// 新（FFmpeg 9.x）
rational_to_string(stream->stream()->time_base, '/')
```

两者在大多数情况下返回相同值。

## 注意事项

- 其他 FFmpeg API 变化：`av_init_packet` 在 9.x 标记 deprecated（warning 非 error）
- 建议用 `llvm-readelf --dyn-syms` 检查所有 UND 符号是否在新版 FFmpeg 头文件中存在

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | FFmpeg 9.x API 兼容性修复 |
| 影响面 | 使用旧 FFmpeg API 的 Qt OHOS 应用 |
| 交付物 | problem 记录 |
| 证据 | QCTools 编译通过 |
| 可复用方式 | 遇到 av_stream_get_codec_timebase undeclared 时直接替换 |

## 相关

- [[semantic-qt-harmonyos-third-party-libs]] — 三方库鸿蒙化指南
