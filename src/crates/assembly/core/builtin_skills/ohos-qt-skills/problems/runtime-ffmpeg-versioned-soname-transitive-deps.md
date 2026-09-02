---
id: problem-runtime-ffmpeg-versioned-soname-transitive-deps
type: problem
domain: runtime
tags: [ffmpeg, dlopen, soname, stub, harmonybrew, arm64-ohos]
created: 2026-08-24
updated: 2026-08-24
status: solved
severity: critical
audience: public
refs: [semantic-qt-harmonyos-third-party-libs, procedural-fetch-ohos-third-party-lib]
summary: >
  Harmonybrew 预编译 FFmpeg .so 的 NEEDED 引用版本化 SONAME（libavcodec.so.63 等）和大量传递依赖
 （libvpx/libdav1d/liblzma/libx264/libx265/libopus/libSvtAv1Enc/libbz2/libasound/libxcb/libz.so.1），
  OHOS 动态链接器在加载时立即解析所有 NEEDED 和符号，缺失任一即 dlopen 失败。
  解决：复制全部版本化 .so + 从设备拉取 libz.so.1 + 为不可用编解码器创建空 stub .so。
leader_summary: >
  沉淀 FFmpeg 预编译 bottle 在 OHOS 上的完整传递依赖部署方案，避免 dlopen 级联失败。
impact: [迁移提效, 编译排障, 运行时排障]
deliverables: [problem记录, HAP]
evidence: [QCTools 真机运行, devecocli run 日志]

error_message: >
  dlopen() failed to open library 'libOhosApp.so': Error loading shared library libavcodec.so.63
  dlopen() failed to open library 'libOhosApp.so': Error loading shared library libvpx.so.12
  dlopen() failed to open library 'libOhosApp.so': Error loading shared library libz.so.1
  Error relocating libavcodec.so.63: opus_multistream_decoder_create: symbol not found
  Error relocating libavcodec.so.63: svt_av1_enc_parse_parameter: symbol not found
error_code: ""
keywords: [ffmpeg, dlopen, NEEDED, SONAME, stub, harmonybrew, libz, libvpx, libopus, libx264]
symptoms: 应用启动后立即崩溃，hilog 显示 dlopen failed 或 symbol not found
environment: Qt 5.15.16 OHOS SDK (arm64-v8a), FFmpeg 9.0.1 (Harmonybrew), OHOS 5.0.0(12) 真机
---

# FFmpeg 预编译 .so 在 OHOS 上的传递依赖部署

## 错误信息

```
# 阶段1：版本化 SONAME 未部署
dlopen() failed: Error loading shared library libavcodec.so.63: (needed by libOhosApp.so)

# 阶段2：传递依赖缺失
dlopen() failed: Error loading shared library libvpx.so.12: (needed by libavcodec.so.63)

# 阶段3：系统库 namespace 不可见
dlopen() failed: Error loading shared library libz.so.1: (needed by libavcodec.so.63)

# 阶段4：stub 库缺少符号（OHOS 立即符号解析）
Error relocating libavcodec.so.63: opus_multistream_decoder_create: symbol not found
```

## 场景

使用 Harmonybrew 预编译 FFmpeg bottle（`fetch-ohos-bottle.sh -f ffmpeg`）链接到 Qt OHOS 应用，构建成功但运行时 dlopen 失败。

## 原因

1. **版本化 SONAME**：FFmpeg .so 的 NEEDED 引用 `libavcodec.so.63`（版本化），CMakeLists.txt 只复制了 `libavcodec.so`（无版本后缀）
2. **传递依赖**：`libavcodec.so.63` NEEDED `libvpx.so.12`/`libdav1d.so.7`/`liblzma.so.5`/`libx264.so.165` 等，Harmonybrew 拉取了部分但非全部
3. **libz namespace**：设备有 `/usr/lib/libz.so.1` 但应用 namespace（`namespace=ndk no inherits`）无法访问系统库路径
4. **OHOS 立即符号解析**：OHOS 动态链接器在 dlopen 时解析所有符号（非 lazy binding），空 stub 库缺少导出符号导致 relocation 失败

## 解决方案

### 1. 复制全部版本化 .so 文件
CMakeLists.txt 用 `file(GLOB ... *.so*)` 而非硬编码文件名，覆盖 `libavcodec.so`/`libavcodec.so.63`/`libavcodec.so.63.1.101` 等。

### 2. 复制 Harmonybrew 传递依赖
```cmake
file(GLOB _ALL_SO_FILES
    "${_OHOS_LIBS_ROOT}/ffmpeg/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/dav1d/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/lame/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/libvpx/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/mpg123/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/libvmaf/*/lib/lib*.so*"
    "${_OHOS_LIBS_ROOT}/openssl/*/lib/lib*.so*"
)
```

### 3. 从设备拉取 libz.so.1
```bash
hdc file recv /usr/lib/libz.so.1.2.13 ohos-stubs/libz.so.1
```
设备有 libz.so.1 但应用 namespace 不可见，需复制到 `entry/libs/arm64-v8a/`。

### 4. 为不可用编解码器创建带符号导出的 stub .so
用 OHOS 交叉编译器创建包含所有 NEEDED 符号的空实现：
```bash
CLANG=aarch64-unknown-linux-ohos-clang
# libopus stub
cat > opus_stub.c << 'EOF'
#define S(x) int x(){return -1;}
S(opus_multistream_decode) S(opus_multistream_decoder_create) ...
EOF
$CLANG -shared -o libopus.so.0 opus_stub.c -Wl,-soname,libopus.so.0
```
需要为 libopus/liblzma（带版本符号 @XZ_5.0）/libbz2/libasound（带版本符号 @ALSA_0.9）/libSvtAv1Enc/libx264/libx265/libxcb/libxcb-shm/libxcb-shape/libxcb-xfixes 创建 stub。

用 `llvm-readelf --dyn-syms` 扫描所有 FFmpeg .so 的 UND 符号，按库名前缀分组生成完整 stub。

## 注意事项

- **FFmpeg .a 不可用**：Harmonybrew .a 未用 `-fPIC` 编译，链接到 .so 会报 `relocation R_AARCH64_ADR_PREL_PG_HI21 cannot be used`，只能用 .so
- **stub 运行时风险**：stub 返回 0/-1，FFmpeg 调用 x264/x265 编码器会失败，但不影响解码和分析功能
- **libz.so.1 版本**：必须从目标设备拉取，不同设备版本可能不同
- **版本符号**：liblzma 的符号有 `@XZ_5.0` 版本标记，libasound 有 `@ALSA_0.9` 和 `@ALSA_0.9.0rc4`，stub 必须用 `-Wl,--version-script` 匹配

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 FFmpeg 预编译 bottle 在 OHOS 上的完整传递依赖部署方案，解决 dlopen 级联失败 |
| 影响面 | 所有依赖 FFmpeg 的 Qt OHOS 应用迁移 |
| 交付物 | problem 记录、QCTools HAP 真机运行 |
| 证据 | QCTools 真机运行 PID 存活、hilog 无 dlopen 错误 |
| 可复用方式 | 遇到 `dlopen failed` + FFmpeg 相关错误时直接匹配本页 |

## 相关

- [[semantic-qt-harmonyos-third-party-libs]] — 三方库鸿蒙化指南
- [[procedural-fetch-ohos-third-party-lib]] — Harmonybrew bottle 拉取
