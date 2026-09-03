#!/bin/bash
# compile-qt-sdk.sh — 从源码编译 Qt OHOS SDK
#
# 用法: bash skills/kb-init/scripts/compile-qt-sdk.sh \
#         --src=<Qt源码目录> \
#         --dest=<SDK输出目录> \
#         --render=<gl|gles> \
#         --build-type=<release|debug> \
#         --ohos-sdk-native=<OHOS SDK native路径>
# 输出: QT_OHOS_SDK=<SDK路径>
# 退出码: 0=成功, 1=失败

set -uo pipefail

SRC=""
DEST=""
RENDER="gl"
BUILD_TYPE="release"
OHOS_SDK_NATIVE=""

for arg in "$@"; do
  case "$arg" in
    --src=*) SRC="${arg#*=}";;
    --dest=*) DEST="${arg#*=}";;
    --render=*) RENDER="${arg#*=}";;
    --build-type=*) BUILD_TYPE="${arg#*=}";;
    --ohos-sdk-native=*) OHOS_SDK_NATIVE="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

if [ -z "$SRC" ] || [ -z "$DEST" ] || [ -z "$OHOS_SDK_NATIVE" ]; then
  echo "用法: bash compile-qt-sdk.sh --src=<源码> --dest=<输出> --render=<gl|gles> --build-type=<release|debug> --ohos-sdk-native=<路径>"
  exit 2
fi

# 检测 OS
OS="unknown"
case "$(uname -s)" in
  Darwin*) OS="macos";;
  Linux*)  OS="linux";;
  MINGW*|MSYS*|CYGWIN*) OS="windows";;
esac

echo "--- Qt OHOS SDK 编译 ---"
echo "  源码: $SRC"
echo "  输出: $DEST"
echo "  渲染: $RENDER"
echo "  类型: $BUILD_TYPE"
echo "  平台: $OS"
echo "  OHOS SDK: $OHOS_SDK_NATIVE"
echo ""

# 检查源码
if [ ! -d "$SRC/qtbase" ]; then
  echo "FAIL: Qt 源码目录无效（缺少 qtbase/）: $SRC"
  exit 1
fi

# 检查编译工具
if [ "$OS" = "windows" ]; then
  if ! command -v mingw32-make &>/dev/null; then
    echo "FAIL: mingw32-make 未安装"
    echo "  请安装 MinGW: https://www.mingw-w64.org/"
    exit 1
  fi
  if ! command -v perl &>/dev/null; then
    echo "FAIL: perl 未安装"
    echo "  请安装 Strawberry Perl: https://strawberryperl.com/"
    exit 1
  fi
  if ! command -v powershell.exe &>/dev/null && ! command -v pwsh &>/dev/null; then
    echo "FAIL: PowerShell 未找到"
    echo "  Windows 编译 Qt 必须在 PowerShell 中执行"
    exit 1
  fi
fi

if ! command -v cmake &>/dev/null; then
  echo "FAIL: cmake 未安装"
  echo "  macOS: brew install cmake"
  echo "  Windows: https://cmake.org/download/"
  echo "  Linux: sudo apt install cmake"
  exit 1
fi

# 检查 OHOS SDK
if [ ! -d "$OHOS_SDK_NATIVE/llvm/bin" ]; then
  echo "FAIL: OHOS SDK native 路径无效（缺少 llvm/bin/）: $OHOS_SDK_NATIVE"
  exit 1
fi

# 确定 Qt 版本（从源码目录名推断）
QT_VERSION="5.12"
echo "$SRC" | grep -q "5.15" && QT_VERSION="5.15"

# SDK 输出目录名
SDK_DIR_NAME="Qt${QT_VERSION}.12-arm64-v8a"
[ "$QT_VERSION" = "5.15" ] && SDK_DIR_NAME="Qt5.15.16-arm64-v8a"
[ "$RENDER" = "gles" ] && SDK_DIR_NAME="${SDK_DIR_NAME}-gles"
[ "$BUILD_TYPE" = "debug" ] && SDK_DIR_NAME="${SDK_DIR_NAME}-debug"

SDK_OUTPUT="$DEST/$SDK_DIR_NAME"
BUILD_DIR="$DEST/build-$SDK_DIR_NAME"

echo "  SDK 输出: $SDK_OUTPUT"
echo "  构建目录: $BUILD_DIR"
echo ""

# 创建目录
mkdir -p "$BUILD_DIR"
mkdir -p "$SDK_OUTPUT"

# 设置交叉编译环境变量
export NATIVE_OHOS_SDK="$OHOS_SDK_NATIVE"
export OHOS_SDK_SYSROOT="$OHOS_SDK_NATIVE/sysroot"
export LLVM_INSTALL_DIR="$OHOS_SDK_NATIVE/llvm"

echo "环境变量已设置:"
echo "  NATIVE_OHOS_SDK=$NATIVE_OHOS_SDK"
echo "  OHOS_SDK_SYSROOT=$OHOS_SDK_SYSROOT"
echo "  LLVM_INSTALL_DIR=$LLVM_INSTALL_DIR"
echo ""

# 构建配置参数
CONFIGURE_ARGS=""
[ "$BUILD_TYPE" = "debug" ] && CONFIGURE_ARGS="$CONFIGURE_ARGS -debug" || CONFIGURE_ARGS="$CONFIGURE_ARGS -release"
[ "$RENDER" = "gles" ] && CONFIGURE_ARGS="$CONFIGURE_ARGS -opengl es2" || CONFIGURE_ARGS="$CONFIGURE_ARGS -opengl desktop"

echo "=== 开始编译 ==="
echo "  这可能需要 30-60 分钟，请耐心等待..."
echo ""

if [ "$OS" = "windows" ]; then
  # Windows: 必须在 PowerShell 中编译
  echo "Windows 平台需要在 PowerShell 中执行编译。"
  echo "请打开 PowerShell 并运行以下命令："
  echo ""
  echo "  cd $SRC"
  echo "  \$env:NATIVE_OHOS_SDK = \"$OHOS_SDK_NATIVE\""
  echo "  \$env:OHOS_SDK_SYSROOT = \"\$env:NATIVE_OHOS_SDK/sysroot\""
  echo "  \$env:LLVM_INSTALL_DIR = \"\$env:NATIVE_OHOS_SDK/llvm\""
  echo "  configure.bat -xplatform ohos-clang $CONFIGURE_ARGS -prefix $SDK_OUTPUT"
  echo "  mingw32-make -j8"
  echo "  mingw32-make install"
  echo ""
  echo "编译完成后，SDK 将位于: $SDK_OUTPUT"
  echo ""
  echo "QT_OHOS_SDK=$SDK_OUTPUT"
  echo ""
  echo "注意：此脚本无法在 Git Bash 中自动执行 Windows 编译。"
  echo "请在 PowerShell 中手动执行上述命令，然后重新运行 verify-env.sh 验证。"
  exit 0
fi

# macOS / Linux: 可以直接编译
cd "$SRC"

echo "Step 1/3: configure..."
./configure -xplatform ohos-clang $CONFIGURE_ARGS \
  -prefix "$SDK_OUTPUT" \
  -nomake examples -nomake tests \
  -skip qtwebengine 2>&1 | tail -20

rc=$?
if [ $rc -ne 0 ]; then
  echo ""
  echo "FAIL: configure 失败 (exit $rc)"
  echo "  请检查上述错误信息"
  exit 1
fi

echo ""
echo "Step 2/3: make (这可能需要 30-60 分钟)..."
make -j$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4) 2>&1 | tail -5

rc=$?
if [ $rc -ne 0 ]; then
  echo ""
  echo "FAIL: make 失败 (exit $rc)"
  echo "  请检查上述错误信息"
  exit 1
fi

echo ""
echo "Step 3/3: make install..."
make install 2>&1 | tail -5

rc=$?
if [ $rc -ne 0 ]; then
  echo ""
  echo "FAIL: make install 失败 (exit $rc)"
  exit 1
fi

echo ""
echo "=== 编译完成 ==="
echo "QT_OHOS_SDK=$SDK_OUTPUT"
echo ""
echo "SDK 已安装到: $SDK_OUTPUT"
