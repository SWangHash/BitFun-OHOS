---
id: semantic-qt-harmonyos-build
type: semantic
domain: tech
tags: [qt, harmonyos, build, configure, cmake, deveco, mingw, perl]
created: 2026-06-02
updated: 2026-07-03
status: active
audience: public
refs: [semantic-qt-harmonyos-overview]
summary: >
  Qt for HarmonyOS 构建指南：macOS/Windows 编译环境搭建、configure 参数、
  Qt Creator Kit 配置、DevEco Studio 集成、OpenSSL/OpenGL 配置、Qt 5.15 skip 列表。
---

# Qt for HarmonyOS 构建指南

## 前置依赖

### macOS (Sonoma 14.0+)
- git ≥ 2.39.3
- python ≥ 3.12.0
- DevEco Studio（自带 SDK）

### Windows
- **MinGW 工具链**：推荐 `llvm-mingw-20230919-ucrt-x86_64.zip`（解压到如 `D:\`）
- **Perl**：[Strawberry Perl](https://strawberryperl.com/)
- **DevEco Studio** + HarmonyOS SDK
- 将 MinGW 和 Perl 加入 PATH，并设置 `MINGW_ROOT`、`PERL_ROOT`

## 环境变量

```bash
# macOS
export NATIVE_OHOS_SDK=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native

# Windows (cmd)
SET NATIVE_OHOS_SDK=<LOCAL_PATH>
SET OHOS_SDK_SYSROOT=%NATIVE_OHOS_SDK%\sysroot
SET LLVM_INSTALL_DIR=%NATIVE_OHOS_SDK%\llvm
SET QT5_ROOT_DIR=<LOCAL_PATH>
```

## Configure 命令

### macOS (arm64-v8a)

```bash
#!/bin/sh
ARCH="arm64-v8a"
QT5_ROOT_DIR=<PATH_TO>/tqtc-qt5
QT5_BUILD_DIR="$QT5_ROOT_DIR/build_${ARCH}"

mkdir "$QT5_BUILD_DIR"
cd "$QT5_BUILD_DIR"

../configure \
 -v \
 -xplatform ohos-clang \
 -prefix /data/storage/el1/bundle/libs/arm64 \
 -extprefix ${NATIVE_OHOS_SDK}/opt/Qt/5.12.12/ohos-${ARCH}-clang/ \
 -opensource -confirm-license -release \
 -no-use-gold-linker -no-gcc-sysroot \
 -ohos-arch ${ARCH} \
 -skip qt3d -skip qtactiveqt -skip qtandroidextras -skip qtcanvas3d \
 -skip qtconnectivity -skip qtdatavis3d -skip qtdoc -skip qtdocgallery \
 -skip qtfeedback -skip qtgamepad -skip qtgraphicaleffects -skip qtlocation \
 -skip qtmacextras -skip qtnetworkauth -skip qtpim -skip qtpurchasing \
 -skip qtqa -skip qtremoteobjects -skip qtrepotools -skip qtscript \
 -skip qtscxml -skip qtsensors -skip qtserialbus -skip qtserialport \
 -skip qtspeech -skip qtsystems -skip qttools -skip qttranslations \
 -skip qtvirtualkeyboard -skip qtwayland -skip qtwebchannel \
 -skip qtwebengine -skip qtwebglplugin -skip qtwebsockets \
 -skip qtwebview -skip qtwinextras -skip qtx11extras -skip doc \
 -no-dbus -c++std c++14 \
 -nomake examples -nomake tests

make -j16
make install
```

### Windows (arm64-v8a)

```bat
REM Skip modules
SET QT_SKIPS=-skip qt3d -skip qtactiveqt -skip qtandroidextras -skip qtcanvas3d -skip qtconnectivity -skip qtdatavis3d -skip qtdoc -skip qtdocgallery -skip qtfeedback -skip qtgamepad -skip qtgraphicaleffects -skip qtlocation -skip qtmacextras -skip qtnetworkauth -skip qtpim -skip qtpurchasing -skip qtqa -skip qtremoteobjects -skip qtrepotools -skip qtscript -skip qtscxml -skip qtsensors -skip qtserialbus -skip qtserialport -skip qtspeech -skip qtsystems -skip qttools -skip qttranslations -skip qtvirtualkeyboard -skip qtwayland -skip qtwebchannel -skip qtwebengine -skip qtwebglplugin -skip qtwebsockets -skip qtwebview -skip qtwinextras -skip qtx11extras -no-dbus -skip doc

REM Configure
call ..\tqtc-qt5\configure.bat -v -xplatform ohos-clang ^
 -device-option CROSS_COMPILE=%LLVM_INSTALL_DIR%\bin ^
 -prefix /data/storage/el1/bundle/libs/arm64 ^
 -extprefix c:\Qt\qt-5.12.12-ohos ^
 -opensource -confirm-license -debug ^
 -no-use-gold-linker %QT_SKIPS% ^
 -nomake tests -nomake examples ^
 -no-gcc-sysroot -c++std c++14 -ohos-arch arm64-v8a
```

### Qt 5.15.16 Skip 列表（更精简）

```
-skip doc -skip qtactiveqt -skip qtandroidextras -skip qtcanvas3d
-skip qtdoc -skip qtfeedback -skip qtgamepad -skip qtlocation
-skip qtmacextras -skip qtnetworkauth -skip qtpim -skip qtpurchasing
-skip qtqa -skip qtremoteobjects -skip qtrepotools -skip qtscript
-skip qtsystems -skip qttools -skip qtwayland -skip qtwebchannel
-skip qtwebengine -skip qtwebglplugin -skip qtwinextras -skip qtx11extras
-skip qtopcua -skip qtknx -skip qtconnectivity -skip coap
```

## OpenSSL 配置

如需 OpenSSL 支持，configure 时追加：
```
-openssl-runtime -I"${QT_SOURCE_DIR_OPENSSL}" -ssl
```
头文件来源：[gitee.com/openharmony/third_party_openssl](https://gitee.com/openharmony/third_party_openssl/tree/master/include/)

## OpenGL 配置

- **此 commit 之前**（qtbase c5de1b3d）：必须显式指定 `-opengles3`
- **此 commit 之后**：
  - 自动检测：`./configure` 不带参数
  - 强制 Desktop OpenGL：`-opengl desktop`
  - 强制 OpenGL ES：`-opengl es2 -opengles3`

**Desktop OpenGL 构建失败的解决**：
1. 确保 SDK 和设备版本 ≥ API 20
2. 从 [gitee.com/inkuu/opengl](https://gitee.com/inkuu/opengl/tree/mesa_headers_all) 下载 `libGLv4.so`
3. 复制到 SDK：`sysroot/usr/lib/aarch64-linux-ohos/` 替换现有文件
4. 重新编译
5. 在 `app.json5` 中设置 `NEED_OPENGL` 环境变量

## Qt Creator Kit 配置

### 1. 添加 Qt Version
Preferences → Kits → Qt Versions → Add → 选择编译生成的 `qmake`

### 2. 配置编译器
Compilers → Add → Custom → C：
- **Name**: OHOS Clang
- **Compiler path**: `<SDK>/native/llvm/bin/clang`
- **ABI**: `arm - linux - generic - elf - 64bit`

C++ 同理，选 `clang++`，Name 设为 `OHOS Clang++`

### 3. 创建 Kit
Kits → Add → 选择上面配置的 Qt Version 和编译器

### 4. 设置环境变量
Preferences → Environment → System → Change：
```
NATIVE_OHOS_SDK=<SDK路径>/native
```

## Qt5 源码增量编译与 install

> 应用诊断补丁/加日志后，需重新编译 Qt 并 install 到 SDK，demo 才能链到带改动的 libqohos.so。
> 初次 configure 全量编译见上文 §Configure 命令；本节聚焦**增量编译 + install**（日常排查框架问题的高频操作）。

### Windows（主力环境）

从 **PowerShell 或 cmd** 执行；若在 bash/git-bash，加 `SHELL=cmd.exe` 覆盖——`mingw32-make` 默认调 `/usr/bin/sh` 会把反斜杠路径（`C:\...`）当转义吞掉，`SHELL=cmd.exe` 强制用 cmd.exe 作 shell，bash/PowerShell/cmd 三端通吃：

```powershell
# build 目录从 ENV.md 取（QT5_12_BUILD；5.15 用 ${QT_BUILD_ROOT}/build_5.15.16_arm64-v8a）
cd ${QT5_12_BUILD}
mingw32-make.exe SHELL=cmd.exe -j64 install
```

`install` 目标把编译产物（含改过的 `libqohos.so`、Qt5 模块 .so）传播到已安装 SDK（`QT5_12_OHOS_SDK`，真实值见 ENV.md）。之后重新编译 demo，它链到的就是带日志/改动的 libqohos.so。

### macOS

```bash
cd <QT_BUILD_DIR>   # 如 tqtc-qt5/build_arm64-v8a
make -j16 install
```

### 完整链路（patch → 日志生效）

```
qtbase 工作树改源码（加 qOhosPrintfWarning 等）
  → mingw32-make install（PowerShell）
    → SDK 下 libqohos.so 更新
      → demo 重新 hvigorw assembleHap
        → lib<app>.so 链入新 libqohos.so
          → 部署设备 → hilog 抓日志
```

### 常见坑

| 现象 | 根因 | 解决 |
|------|------|------|
| 改了源码但 hilog 无新日志 | 只 `make` 没 `install`，SDK 下 libqohos.so 未更新 | 必须带 `install` 目标 |
| bash/git-bash 里 mingw32-make 报路径错误 | mingw32-make 调 `/usr/bin/sh` 吞反斜杠路径 | 加 `SHELL=cmd.exe` 参数，或切 PowerShell/cmd |
| demo 链到的还是旧 libqohos.so | install 后没重新编译 demo | install 后重跑 `hvigorw assembleHap` |
| `mingw32-make: command not found` | MINGW_ROOT 未加 PATH | ENV.md 的 `MINGW_ROOT` 加 PATH |

> 编译 Qt 源码加日志排查框架问题的完整流程见框架问题分析方法论阶段二。

## 参考来源

- [Building Qt for HarmonyOS](https://wiki.qt.io/Building_Qt_for_HarmonyOS)
