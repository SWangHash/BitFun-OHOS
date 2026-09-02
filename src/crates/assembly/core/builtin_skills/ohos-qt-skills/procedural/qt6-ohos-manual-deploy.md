---
id: procedural-qt6-ohos-manual-deploy
type: procedural
domain: deploy
tags: [qt6, qt6.12, harmonyos, ohos, deploy, manual, harmonydeployqt6, workaround, qml, hap, windows]
created: 2026-08-06
updated: 2026-08-06
status: active
audience: public
refs: [procedural-qt6-ohos-windows-cli-deploy, semantic-qt-harmonyos-qt6-status, semantic-qt-harmonyos-project-structure]
summary: >
  规避 harmonydeployqt6（Qt6.12 Beta2）5 个部署缺陷的手动部署流程：从 SDK templates 复制 DevEco 工程骨架
  + 手动部署业务 .so + libqohos + Qt6 运行时 + QML 模块 qmldir + QML 插件 .so + QML 插件 Qt6 依赖
  到正确位置（libs/ vs resfile/qml/）+ 配置 APP_LIBRARY_NAME + 签名 build。完全不调 harmonydeployqt6。
---

# Qt6.12 OHOS 手动部署（规避 harmonydeployqt6 5 bug）

> **目的**：`harmonydeployqt6`（Qt6.12 Beta2 预构建）有 5 个部署缺陷（详见 [[qt6-ohos-windows-cli-deploy]] §8 踩坑表 / 上游交付的 harmonydeployqt6 缺陷报告）：
> 1. rawfile/qml 递归复制（HAP 爆炸 7.8GB + 工具卡死）
> 2. 不部署 `libqohos.so`（QPA 插件）→ 启动崩 `load libqohos.so failed`
> 3. 不部署 `resfile/qml` 的 QML 模块 `qmldir` → 白屏 `module not installed`
> 4. QML 插件 `.so` 路径错（放 `resfile/qml` 被 MUSL-LDSO namespace 拒绝 `errno=22`，应放 `libs/`）
> 5. 不部署 QML 插件的 Qt6 依赖（111 个库缺失）→ `Cannot load library Invalid argument`
>
> 本文档**完全不调 `harmonydeployqt6`**，从 SDK templates 手动生成 DevEco 工程 + 部署所有运行时资源，规避全部 5 bug。

---

## 前置

| 项 | 要求 |
|----|------|
| Qt 6.12.0 Beta2 预构建 SDK | `${QT6_INSTALL_ROOT}`（预构建安装根），含 `harmonyos_arm64_v8a/`（交叉目标）+ `mingw_64/`（host） |
| 业务 `.so` 已编译 | `qt-cmake.bat` configure + `cmake --build` 产出 `build/lib<TARGET>.so`（NEEDED 裸名 + `main GLOBAL DEFAULT`，预构建免 patch） |
| DevEco Studio | 无空格 junction `${DEVECO_STUDIO}` = `C:/DevecoStudio`，含 OHOS native SDK（API 23, Clang 15.0.4）+ hvigor + node + jbr |
| 设备 | 开发者模式 + USB 调试（真机/模拟器） |

> 业务 .so 编译见 [[qt6-ohos-windows-cli-deploy]] §3-4（qt-cmake configure + cmake --build）。

---

## SDK 资源清单

| 资源 | SDK 路径 | 用途 |
|------|---------|------|
| DevEco 工程模板 | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/src/harmonyos/templates/` | 骨架：AppScope + build-profile + hvigor + oh-package + **ets 胶水**（QAbility/QtUtils/OhosExportModules/QAbilityStage/QChildProcess/NativeNode pages）+ qt/libqohos.d.ts + cpp/CMakeLists + ohosTest |
| `libqohos.so`（QPA 插件） | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/plugins/platforms/libqohos.so` | Qt OHOS 平台插件（4.3MB） |
| Qt6 库（150 个 `.so`） | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/lib/` | libQt6Core/Gui/Quick/Qml/CanvasPainter/Canvas2D/Charts/Quick3D/QuickControls2 等 |
| QML 模块 | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/qml/` | QtQuick/QtCanvas2D/QtQuick.Controls 等 20+ 模块（含 `qmldir`+`.qmltypes`+插件 `.so`） |
| `llvm-readelf` | `${DEVECO_STUDIO}/sdk/default/openharmony/native/llvm/bin/llvm-readelf.exe` | 扫描 `.so` NEEDED |

---

## 步骤

> 下文 `$HAP` = 工程输出目录（如 `build/hap`），`$TARGET` = 业务 target 名（如 `qcpainterbench`），`$SDK` = `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a`。

### §1 从 SDK templates 复制 DevEco 工程骨架（规避 Bug 1）

```bash
SDK=${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a
HAP=build/hap
rm -rf "$HAP"
cp -r "$SDK/src/harmonyos/templates/." "$HAP/"
# templates 含 cmake_install.cmake/CTestTestfile.cmake（cmake 产物，删）
rm -f "$HAP/cmake_install.cmake" "$HAP/CTestTestfile.cmake"
```

骨架结构（复制后）：
```
$HAP/
├── AppScope/app.json5 + resources/
├── build-profile.json5
├── hvigor/hvigor-config.json5
├── hvigorfile.ts
├── oh-package.json5
└── entry/
    ├── build-profile.json5 + hvigorfile.ts + oh-package.json5
    └── src/main/
        ├── cpp/CMakeLists.txt + hello.cpp + types/libentry/   ← §2 替换为业务 .so 配置
        ├── ets/（common/QtAppConstants + pages/* + process/QChildProcess
        │        + qability/QAbility/QtUtils/OhosExportModules/QEmbeddedComponentCreator
        │        + qabilitystage/QAbilityStage）
        ├── module.json5
        ├── qt/libqohos.d.ts + oh-package.json5                ← §4 补 libqohos.so
        └── resources/ + ohosTest/
```

> ets 胶水（QAbility/QtUtils/OhosExportModules 等）随 templates 一起复制，无需手写。

### §2 配置 APP_LIBRARY_NAME + 删 cpp 模板

```bash
TARGET=qcpainterbench  # 改为你的 target
# QtAppConstants.ets 设业务 .so 名
sed -i "s/export const APP_LIBRARY_NAME = .*/export const APP_LIBRARY_NAME = 'lib${TARGET}.so';/" \
  "$HAP/entry/src/main/ets/common/QtAppConstants.ets"
# 删 cpp 模板（hello.cpp + CMakeLists，业务 .so 已在 §3 部署到 libs/，不需 entry cpp 编译）
rm -rf "$HAP/entry/src/main/cpp"
# entry/build-profile.json5 的 externalNativeOptions.path 指向 cpp/CMakeLists.txt，删 cpp 后改或删该字段
```

> 若保留 cpp/CMakeLists（让 hvigor 编译业务源码），改为引用业务源；本文档假设业务 .so 已在 §3 部署（不 hvigor 编译）。

### §3 部署业务 .so + Qt6 运行时到 entry/libs/arm64-v8a/

```bash
SDK=${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a
READELF=C:/DevecoStudio/sdk/default/openharmony/native/llvm/bin/llvm-readelf.exe
LIBS=$HAP/entry/libs/arm64-v8a
mkdir -p "$LIBS"

# 业务 .so
cp build/lib${TARGET}.so "$LIBS/"

# 业务 .so 的 Qt6 直接依赖（从 NEEDED 扫描）
for lib in $("$READELF" -d "build/lib${TARGET}.so" | grep NEEDED | sed 's/.*\[\(.*\)\]/\1/'); do
  [[ "$lib" == libQt6* ]] && cp "$SDK/lib/$lib" "$LIBS/" 2>/dev/null
done

# Qt6 非 Qt 依赖运行时（icu/fontconfig/freetype/png/jpeg/brotli/expat/uuid/c++_shared）
for lib in libicudata libicui18n libicuuc libfontconfig libfreetype libpng16 libjpeg \
            libturbojpeg libbrotlicommon libbrotlidec libbrotlienc libexpat libc++_shared; do
  cp "$SDK/lib/$lib.so" "$LIBS/" 2>/dev/null
done
# uuid 可能是 .a（静态），按需
cp "$SDK/lib/libuuid.so" "$LIBS/" 2>/dev/null
```

### §4 部署 libqohos.so（QPA 插件，规避 Bug 2）

```bash
# qt/ 模块目录（.d.ts + oh-package.json5 已从 templates 复制，补 .so 二进制）
cp "$SDK/plugins/platforms/libqohos.so" "$HAP/entry/src/main/qt/libqohos.so"
# libs/ 也放一份（运行时 dlopen 路径，QAbility.ets import qpa from 'libqohos.so' 解析）
cp "$SDK/plugins/platforms/libqohos.so" "$LIBS/libqohos.so"
```

### §5 部署 QML 模块 qmldir+.qmltypes 到 resfile/qml/（规避 Bug 3）

```bash
RESFILE=$HAP/entry/src/main/resources/resfile/qml
mkdir -p "$RESFILE"
# 复制整个 SDK qml/（含 qmldir+.qmltypes+.so，§6 会把 .so 移走）
cp -r "$SDK/qml/." "$RESFILE/"
```

### §6 QML 插件 .so 移到 libs/，resfile 只留 qmldir+.qmltypes（规避 Bug 4）

```bash
# QML 插件 .so 从 resfile/qml/<Module>/ 移到 libs/（HarmonyOS MUSL-LDSO 只允许 libs/ dlopen）
find "$RESFILE" -name "*.so" -exec cp {} "$LIBS/" \;
# resfile 只留 qmldir + .qmltypes + .qml（删 .so）
find "$RESFILE" -name "*.so" -delete
```

> `qmldir` 用 `optional plugin <name>`（插件名，非路径），Qt 从 `LD_LIBRARY_PATH`（含 `libs/arm64-v8a/`）找 `lib<name>.so`。

### §7 部署 QML 插件的 Qt6 依赖（扫描 NEEDED 补全，规避 Bug 5）

```bash
# 扫描 libs/ 所有 .so（业务 + libqohos + QML 插件）的 NEEDED，补全缺失 Qt6 库
for so in "$LIBS"/*.so; do
  "$READELF" -d "$so" 2>/dev/null | grep NEEDED | sed 's/.*\[\(.*\)\]/\1/'
done | sort -u | while read lib; do
  if [[ "$lib" == libQt6* ]] && [ ! -f "$LIBS/$lib" ]; then
    echo "补全: $lib"
    cp "$SDK/lib/$lib" "$LIBS/" 2>/dev/null
  fi
done
```

> 实测 qcpainterbench 补全 111 个 Qt6 库（libQt6Canvas2D/Charts/Quick3D*/QuickControls2* 等）。全量复制 SDK lib/ 也行（150 .so，省扫描）：
> `cp "$SDK/lib/"libQt6*.so "$LIBS/"`（但会含未用模块，HAP 变大）。

### §8 配置 build-profile + app.json5 + module.json5

- **`AppScope/app.json5`**：`bundleName`（如 `org.qtproject.example.<TARGET>`）+ `versionCode`/`versionName`
- **`entry/src/main/module.json5`**：permissions（按需，如 `ohos.permission.INTERNET`）
- **根 `build-profile.json5` signingConfigs**：DevEco 自动签名（§9 步骤 2 填）

### §9 DevEco 打开 + 签名 + build HAP + install + start

1. DevEco Studio → Open → 选 `$HAP/`
2. File > Project Structure (Ctrl+Alt+Shift+S) > Signing Configs > 勾 "Automatically generate signature" > Apply（DevEco 自动填 `signingConfigs` + 生成 debug 证书）
3. Run ▶（DevEco `hvigor assembleHap` build signed HAP + install + start）
   - 或 CLI build：`hvigorw assembleHap`（环境变量见 [[qt6-ohos-windows-cli-deploy]] §2.2）
   - 或 CLI install/start：`hdc file send <signed.hap> /data/local/tmp/app.hap && hdc shell bm install -r -p /data/local/tmp/app.hap && hdc shell aa start -b <bundleName> -a QAbility`

---

## 验证

### 静态（部署后 build 前）

```bash
READELF=C:/DevecoStudio/sdk/default/openharmony/native/llvm/bin/llvm-readelf.exe
LIBS=$HAP/entry/libs/arm64-v8a
# 业务 .so NEEDED 裸名（无 C:/ 绝对路径）
"$READELF" -d "$LIBS/lib${TARGET}.so" | grep NEEDED
# main GLOBAL DEFAULT
"$READELF" --dyn-syms "$LIBS/lib${TARGET}.so" | grep -E " main$"
# libs/ .so 数量（业务 + libqohos + Qt6 运行时 + QML 插件 + Qt6 依赖，通常 200+）
ls "$LIBS"/*.so | wc -l
# resfile/qml 无 .so（只 qmldir+.qmltypes）
find "$HAP/entry/src/main/resources/resfile/qml" -name "*.so" | wc -l  # 应为 0
# qt/ 有 libqohos.so
ls "$HAP/entry/src/main/qt/libqohos.so"
```

### 运行时（设备）

- 进程存活（`hilog` 无 `load libqohos.so failed` / `module ... not installed` / `MUSL-LDSO ... check ns accessible` / `Cannot load library`）
- Qt 渲染（hilog `RSNode::AddChild` + `SurfaceNode`）
- 截图非白屏

---

## 5 Bug 规避对照

| Bug | harmonydeployqt6 行为 | 本文档规避 |
|-----|----------------------|-----------|
| 1 rawfile 递归 | `qml-root-path` 含工程根+`build/` 不排除 → HAP 7.8GB | §1 从 SDK templates 复制骨架（**不调 harmonydeployqt6**，无 qml-root-path 复制） |
| 2 libqohos.so 未部署 | `qt/` 只有 `.d.ts` + 坏符号链接 | §4 手动复制 `libqohos.so` 到 `qt/` + `libs/` |
| 3 QML 模块 qmldir 未部署 | `resfile/qml` 空 | §5 复制 SDK `qml/` 到 `resfile/qml/` |
| 4 QML 插件 .so 路径错 | `resfile` 被 MUSL-LDSO 拒绝 | §6 QML 插件 .so 移到 `libs/`，`resfile` 只留 `qmldir`+`.qmltypes` |
| 5 QML 插件 Qt6 依赖未部署 | 只部署业务直接依赖 | §7 扫描所有 .so NEEDED 补全 Qt6 库 |

---

## 与 harmonydeployqt6 对比

| 维度 | harmonydeployqt6 | 本文档（手动） |
|------|------------------|---------------|
| 工程骨架 | 从 SDK templates 复制 ✅ | 从 SDK templates 复制 ✅（§1） |
| 业务 .so 直接依赖 | 部署 ✅ | 部署 ✅（§3） |
| libqohos.so | ❌ 不部署（Bug 2） | ✅ 部署（§4） |
| resfile/qml qmldir | ❌ 不部署（Bug 3） | ✅ 部署（§5） |
| QML 插件 .so 路径 | ❌ resfile（Bug 4） | ✅ libs/（§6） |
| QML 插件 Qt6 依赖 | ❌ 不部署（Bug 5） | ✅ 扫描补全（§7） |
| rawfile 递归 | ❌ Bug 1 | ✅ 无（不调 harmonydeployqt6） |
| HAP 大小 | 7.8GB（Bug 1）或 89MB（清理后但缺 QML） | ~190MB（含全 Qt6 + QML 运行时，正常） |

---

## 备注

- 本文档假设业务 .so 已编译（`qt-cmake` + `cmake --build`，见 [[qt6-ohos-windows-cli-deploy]] §3-4）。预构建 SDK 免 `patch_needed.py`（NEEDED 已裸名）+ 免手动 `visibility("default")`（`qt_add_executable` 自动 `main GLOBAL DEFAULT`）。
- QML 已 AOT 编译进 `.so` qrc（`qmlcache_loader.cpp`），`resfile/qml` 的 `.qml` 文件仅供非 AOT 回退，实际运行从 qrc 加载。
- 若应用不用 QML（纯 Widgets），§5-7 可跳过（只 §1-4 + §8-9）。
- 本文档的 5 bug 规避已用 `qcpainterbench`（Qt6.12 QML 应用）端到端验证：应用启动 + QML 加载 + Qt 渲染（hilog `RSNode`/`SurfaceNode`）+ 截图 456KB（vs 白屏 153KB）。

---

## 相关

- [[qt6-ohos-windows-cli-deploy]] — Qt6.12 CLI 部署（含 harmonydeployqt6 流程 + 5 bug 踩坑表 §8）
- [[qt-harmonyos-qt6-status]] — Qt6 鸿蒙化状态（预构建策略 B'）
- [[qt-harmonyos-project-structure]] — 工程结构 / CMake 关键配置 / .so 部署
- 上游交付的 harmonydeployqt6 5 bug 缺陷报告（ISSUE.md）

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 2026-08-06 qcpainterbench 鸿蒙化端到端验证（规避 harmonydeployqt6 5 bug，手动部署 + 渲染成功） |
| 🔍 工具实测 | SDK templates 结构 + libqohos.so/qml/lib 路径 + llvm-readelf NEEDED 扫描 + MUSL-LDSO namespace 拒绝 resfile dlopen |
| 📖 Qt 文档 | harmonydeployqt6 5 bug 缺陷报告（上游交付） |
