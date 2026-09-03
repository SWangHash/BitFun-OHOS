#!/bin/bash
# detect-env.sh — 确定性环境检测
# 检测知识库位置、操作系统、已安装工具、Qt 源码/SDK
#
# 用法: bash skills/kb-init/scripts/detect-env.sh
# 输出: key=value 格式，每行一个检测结果
# 退出码: 0=成功

set -uo pipefail

# ═══════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════
detect_os() {
  # 鸿蒙检测：uname 可能返回 Linux，但 HarmonyBrew 存在说明是鸿蒙
  if [ -d "/storage/Users/currentUser/.harmonybrew" ] || { command -v brew &>/dev/null && brew --prefix 2>/dev/null | grep -q harmonybrew; }; then
    echo "harmonyos"
    return
  fi
  case "$(uname -s)" in
    Darwin*) echo "macos";;
    Linux*)
      # 进一步检测鸿蒙：检查 /etc/os-release 或 hdc 环境
      if [ -f "/etc/ohos-release" ] || [ -f "/etc/openharmony-release" ] || grep -qi "openharmony\|harmonyos" /etc/os-release 2>/dev/null; then
        echo "harmonyos"
      else
        echo "linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows";;
    *) echo "unknown";;
  esac
}

cmd_exists() { command -v "$1" &>/dev/null && echo "true" || echo "false"; }

cmd_version() {
  local cmd="$1"; shift
  command -v "$cmd" &>/dev/null && "$cmd" "$@" 2>/dev/null | head -1 || echo ""
}

# ═══════════════════════════════════════════════════════════
# 0. 知识库检测
# ═══════════════════════════════════════════════════════════
# 从脚本位置推算 KB_ROOT（scripts/ → kb-init/ → skills/ → KB root）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KB_ROOT="$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd || echo "")"

# 验证是否在 ohos-qt-skills 内置或外部知识库中
KB_FOUND="false"
if [ -n "$KB_ROOT" ] && [ -f "$KB_ROOT/SKILL.md" ] && [ -d "$KB_ROOT/skills/kb-init" ] && [ -d "$KB_ROOT/semantic" ]; then
  KB_FOUND="true"
fi

echo "KB_FOUND=$KB_FOUND"
echo "KB_ROOT=$KB_ROOT"

# workspace 目录
WORKSPACE_DIR="$KB_ROOT/workspace"
echo "WORKSPACE_DIR=$WORKSPACE_DIR"

# ═══════════════════════════════════════════════════════════
# 1. 操作系统
# ═══════════════════════════════════════════════════════════
OS=$(detect_os)
echo "OS=$OS"
echo "ARCH=$(uname -m)"

# BitFun 用户级 Qt 迁移资源目录。BitFun 启动的进程优先通过环境变量传入
# 与 PathManager 完全一致的路径；独立运行脚本时使用平台默认值。
if [ -n "${BITFUN_QT_MIGRATION_ROOT:-}" ]; then
  QT_MIGRATION_ROOT="$BITFUN_QT_MIGRATION_ROOT"
elif [ "$OS" = "windows" ]; then
  CONFIG_ROOT="${BITFUN_USER_ROOT:-${APPDATA:-${HOME:-}/AppData/Roaming}/BitFun}"
  QT_MIGRATION_ROOT="$CONFIG_ROOT/data/qt-migration"
elif [ "$OS" = "macos" ]; then
  CONFIG_ROOT="${BITFUN_USER_ROOT:-${HOME}/Library/Application Support/BitFun}"
  QT_MIGRATION_ROOT="$CONFIG_ROOT/data/qt-migration"
elif [ "$OS" = "harmonyos" ]; then
  QT_MIGRATION_ROOT="${BITFUN_USER_ROOT:-/data/storage/el2/base/files/bitfun}/data/qt-migration"
else
  DATA_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}"
  CONFIG_ROOT="${BITFUN_USER_ROOT:-$DATA_ROOT/BitFun}"
  QT_MIGRATION_ROOT="$CONFIG_ROOT/data/qt-migration"
fi
echo "QT_MIGRATION_ROOT=$QT_MIGRATION_ROOT"
echo "QT_MIGRATION_TOOLCHAINS_DIR=$QT_MIGRATION_ROOT/toolchains"
echo "QT_MIGRATION_TEMPLATES_DIR=$QT_MIGRATION_ROOT/templates"

# ═══════════════════════════════════════════════════════════
# 2. DevEco Studio + HarmonyOS SDK + DevEco CLI
# ═══════════════════════════════════════════════════════════
DEVECO_PATH=""
DEVECO_FOUND="false"
DEVECO_VERSION=""
DEVECO_CLI_FOUND="false"
DEVECO_CLI_PATH=""
OHOS_SDK_NATIVE_PATH=""
OHOS_SDK_NATIVE_FOUND="false"
HDC_PATH=""
HDC_FOUND="false"
OHPM_FOUND="false"
HVIGORW_FOUND="false"
NODE_FOUND=$(cmd_exists node)
NODE_VERSION=$(cmd_version node --version)
JDK_FOUND=$(cmd_exists java)
JDK_VERSION=""
[ "$JDK_FOUND" = "true" ] && JDK_VERSION=$(java -version 2>&1 | head -1)

if [ "$OS" = "macos" ]; then
  for p in "/Applications/DevEco-Studio.app" "$HOME/Applications/DevEco-Studio.app"; do
    [ -d "$p" ] && { DEVECO_PATH="$p"; DEVECO_FOUND="true"; break; }
  done
  if [ "$DEVECO_FOUND" = "true" ]; then
    _native="$DEVECO_PATH/Contents/sdk/default/openharmony/native"
    [ -d "$_native" ] && { OHOS_SDK_NATIVE_PATH="$_native"; OHOS_SDK_NATIVE_FOUND="true"; }
    _hdc="$DEVECO_PATH/Contents/sdk/default/openharmony/toolchains/hdc"
    [ -f "$_hdc" ] && { HDC_PATH="$_hdc"; HDC_FOUND="true"; }
    _cli="$DEVECO_PATH/Contents/tools/devecocli"
    [ -f "$_cli" ] && { DEVECO_CLI_PATH="$_cli"; DEVECO_CLI_FOUND="true"; }
    [ -f "$DEVECO_PATH/Contents/sdk/default/openharmony/ohpm/bin/ohpm" ] && OHPM_FOUND="true"
    [ -f "$DEVECO_PATH/Contents/tools/hvigor/bin/hvigorw.js" ] && HVIGORW_FOUND="true"
    _pkg="$DEVECO_PATH/Contents/Resources/app/package.json"
    [ -f "$_pkg" ] && DEVECO_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$_pkg" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
  fi
elif [ "$OS" = "windows" ]; then
  for p in "/c/Program Files/Huawei/DevEco Studio" "/c/Program Files (x86)/Huawei/DevEco Studio" \
           "$LOCALAPPDATA/Programs/DevEco Studio" "/d/DevEco Studio"; do
    [ -d "$p" ] && { DEVECO_PATH="$p"; DEVECO_FOUND="true"; break; }
  done
  if [ "$DEVECO_FOUND" = "true" ]; then
    _native="$DEVECO_PATH/sdk/default/openharmony/native"
    [ -d "$_native" ] && { OHOS_SDK_NATIVE_PATH="$_native"; OHOS_SDK_NATIVE_FOUND="true"; }
    _hdc="$DEVECO_PATH/sdk/default/openharmony/toolchains/hdc.exe"
    [ -f "$_hdc" ] && { HDC_PATH="$_hdc"; HDC_FOUND="true"; }
    _cli="$DEVECO_PATH/tools/devecocli.bat"
    [ -f "$_cli" ] && { DEVECO_CLI_PATH="$_cli"; DEVECO_CLI_FOUND="true"; }
    [ -f "$DEVECO_PATH/sdk/default/openharmony/ohpm/bin/ohpm" ] && OHPM_FOUND="true"
    [ -f "$DEVECO_PATH/tools/hvigor/bin/hvigorw.js" ] && HVIGORW_FOUND="true"
    # Windows 版本检测
    _pkg="$DEVECO_PATH/resources/app/package.json"
    [ -f "$_pkg" ] && DEVECO_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$_pkg" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
    # 备用路径
    if [ -z "$DEVECO_VERSION" ]; then
      _pkg="$DEVECO_PATH/Contents/Resources/app/package.json"
      [ -f "$_pkg" ] && DEVECO_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$_pkg" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
    fi
  fi
elif [ "$OS" = "linux" ]; then
  for p in "$HOME/deveco-studio" "/opt/deveco-studio" "$HOME/DevEco-Studio" "$HOME/dev/deveco-studio"; do
    [ -d "$p" ] && { DEVECO_PATH="$p"; DEVECO_FOUND="true"; break; }
  done
  if [ "$DEVECO_FOUND" = "true" ]; then
    _native="$DEVECO_PATH/sdk/default/openharmony/native"
    [ -d "$_native" ] && { OHOS_SDK_NATIVE_PATH="$_native"; OHOS_SDK_NATIVE_FOUND="true"; }
    _hdc="$DEVECO_PATH/sdk/default/openharmony/toolchains/hdc"
    [ -f "$_hdc" ] && { HDC_PATH="$_hdc"; HDC_FOUND="true"; }
    _cli="$DEVECO_PATH/tools/devecocli"
    [ -f "$_cli" ] && { DEVECO_CLI_PATH="$_cli"; DEVECO_CLI_FOUND="true"; }
    [ -f "$DEVECO_PATH/sdk/default/openharmony/ohpm/bin/ohpm" ] && OHPM_FOUND="true"
    [ -f "$DEVECO_PATH/tools/hvigor/bin/hvigorw.js" ] && HVIGORW_FOUND="true"
  fi
elif [ "$OS" = "harmonyos" ]; then
  for p in "$HOME/deveco-studio" "/opt/deveco-studio" "$HOME/commandline-tools" "$HOME/dev/commandline-tools" "/usr/local/commandline-tools"; do
    [ -d "$p" ] && { DEVECO_PATH="$p"; DEVECO_FOUND="true"; break; }
  done
  if [ "$DEVECO_FOUND" = "true" ]; then
    _native="$DEVECO_PATH/sdk/default/openharmony/native"
    [ -d "$_native" ] && { OHOS_SDK_NATIVE_PATH="$_native"; OHOS_SDK_NATIVE_FOUND="true"; }
    _hdc="$DEVECO_PATH/sdk/default/openharmony/toolchains/hdc"
    [ -f "$_hdc" ] && { HDC_PATH="$_hdc"; HDC_FOUND="true"; }
    _cli="$DEVECO_PATH/tools/devecocli"
    [ -f "$_cli" ] && { DEVECO_CLI_PATH="$_cli"; DEVECO_CLI_FOUND="true"; }
    [ -f "$DEVECO_PATH/sdk/default/openharmony/ohpm/bin/ohpm" ] && OHPM_FOUND="true"
    [ -f "$DEVECO_PATH/tools/hvigor/bin/hvigorw.js" ] && HVIGORW_FOUND="true"
  fi
fi

# hdc 也可能在 PATH 中
if [ "$HDC_FOUND" = "false" ]; then
  HDC_FOUND=$(cmd_exists hdc)
  [ "$HDC_FOUND" = "true" ] && HDC_PATH="$(command -v hdc)"
fi

# devecocli 也可能在 PATH 中
if [ "$DEVECO_CLI_FOUND" = "false" ]; then
  DEVECO_CLI_FOUND=$(cmd_exists devecocli)
  [ "$DEVECO_CLI_FOUND" = "true" ] && DEVECO_CLI_PATH="$(command -v devecocli)"
fi

echo "DEVECO_FOUND=$DEVECO_FOUND"
echo "DEVECO_PATH=$DEVECO_PATH"
echo "DEVECO_VERSION=$DEVECO_VERSION"
echo "DEVECO_CLI_FOUND=$DEVECO_CLI_FOUND"
echo "DEVECO_CLI_PATH=$DEVECO_CLI_PATH"

DEVECO_CLI_OSS_FOUND="false"
DEVECO_CLI_OSS_PATH=""
DEVECO_CLI_OSS_VERSION=""
if command -v deveco-cli &>/dev/null; then
  DEVECO_CLI_OSS_FOUND="true"
  DEVECO_CLI_OSS_PATH="$(command -v deveco-cli)"
  DEVECO_CLI_OSS_VERSION=$(deveco-cli --version 2>/dev/null || echo "")
fi
echo "DEVECO_CLI_OSS_FOUND=$DEVECO_CLI_OSS_FOUND"
echo "DEVECO_CLI_OSS_PATH=$DEVECO_CLI_OSS_PATH"
echo "DEVECO_CLI_OSS_VERSION=$DEVECO_CLI_OSS_VERSION"

echo "OHOS_SDK_NATIVE_FOUND=$OHOS_SDK_NATIVE_FOUND"
echo "OHOS_SDK_NATIVE_PATH=$OHOS_SDK_NATIVE_PATH"
echo "HDC_FOUND=$HDC_FOUND"
echo "HDC_PATH=$HDC_PATH"
echo "OHPM_FOUND=$OHPM_FOUND"
echo "HVIGORW_FOUND=$HVIGORW_FOUND"
echo "NODE_FOUND=$NODE_FOUND"
echo "NODE_VERSION=$NODE_VERSION"
echo "JDK_FOUND=$JDK_FOUND"
echo "JDK_VERSION=$JDK_VERSION"

# ═══════════════════════════════════════════════════════════
# 3. 基础工具链
# ═══════════════════════════════════════════════════════════
echo "GIT_FOUND=$(cmd_exists git)"
echo "GIT_VERSION=$(cmd_version git --version)"
echo "CMAKE_FOUND=$(cmd_exists cmake)"
echo "CMAKE_VERSION=$(cmd_version cmake --version)"

# ═══════════════════════════════════════════════════════════
# 4. 平台特定工具
# ═══════════════════════════════════════════════════════════
MINGW_FOUND="false"; MINGW_PATH=""
PERL_FOUND="false"; PERL_PATH=""
POWERSHELL_FOUND="false"
XCODE_CLT_FOUND="false"

if [ "$OS" = "windows" ]; then
  MINGW_FOUND=$(cmd_exists mingw32-make)
  [ "$MINGW_FOUND" = "true" ] && MINGW_PATH="$(dirname "$(command -v mingw32-make)")"
  for p in "/c/Strawberry" "C:/Strawberry"; do
    [ -d "$p" ] && { PERL_FOUND="true"; PERL_PATH="$p"; break; }
  done
  [ "$PERL_FOUND" = "false" ] && { PERL_FOUND=$(cmd_exists perl); [ "$PERL_FOUND" = "true" ] && PERL_PATH="$(dirname "$(dirname "$(command -v perl)")")"; }
  if command -v powershell.exe &>/dev/null; then
    POWERSHELL_FOUND="true"
  elif command -v pwsh &>/dev/null; then
    POWERSHELL_FOUND="true"
  else
    POWERSHELL_FOUND="false"
  fi
elif [ "$OS" = "macos" ]; then
  xcode-select -p &>/dev/null && XCODE_CLT_FOUND="true"
fi

echo "MINGW_FOUND=$MINGW_FOUND"
echo "MINGW_PATH=$MINGW_PATH"
echo "PERL_FOUND=$PERL_FOUND"
echo "PERL_PATH=$PERL_PATH"
echo "POWERSHELL_FOUND=$POWERSHELL_FOUND"
echo "XCODE_CLT_FOUND=$XCODE_CLT_FOUND"

# ═══════════════════════════════════════════════════════════
# 5. Qt 源码/SDK 检测（在 workspace/ 下）
# ═══════════════════════════════════════════════════════════
QT5_12_SRC_FOUND="false"; QT5_12_SRC_PATH=""
QT5_15_SRC_FOUND="false"; QT5_15_SRC_PATH=""
QT5_12_SDK_FOUND="false"; QT5_12_OHOS_SDK_PATH=""
QT5_15_SDK_FOUND="false"; QT5_15_OHOS_SDK_PATH=""

if [ "$KB_FOUND" = "true" ]; then
  WS="$KB_ROOT/workspace"
  # 源码
  for d in "$WS/qt-src/qt5.12" "$WS/qt-src/qt-harmonyos-src"; do
    [ -d "$d/qtbase" ] && { QT5_12_SRC_FOUND="true"; QT5_12_SRC_PATH="$d"; }
  done
  [ -d "$WS/qt-src/qt5.15/qtbase" ] && { QT5_15_SRC_FOUND="true"; QT5_15_SRC_PATH="$WS/qt-src/qt5.15"; }
  # 兼容旧的知识库 workspace 安装位置
  for d in "$WS"/qt-sdk/Qt5.12*; do
    [ -d "$d" ] && { QT5_12_SDK_FOUND="true"; QT5_12_OHOS_SDK_PATH="$d"; break; }
  done
  for d in "$WS"/qt-sdk/Qt5.15*; do
    [ -d "$d" ] && { QT5_15_SDK_FOUND="true"; QT5_15_OHOS_SDK_PATH="$d"; break; }
  done
fi

# BitFun 用户级共享工具链优先于旧 workspace 位置。
for d in "$QT_MIGRATION_ROOT"/toolchains/qt5.12*/* "$QT_MIGRATION_ROOT"/toolchains/qt5.12*; do
  [ -d "$d" ] && { QT5_12_SDK_FOUND="true"; QT5_12_OHOS_SDK_PATH="$d"; break; }
done
for d in "$QT_MIGRATION_ROOT"/toolchains/qt5.15*/* "$QT_MIGRATION_ROOT"/toolchains/qt5.15*; do
  [ -d "$d" ] && { QT5_15_SDK_FOUND="true"; QT5_15_OHOS_SDK_PATH="$d"; break; }
done

echo "QT5_12_SRC_FOUND=$QT5_12_SRC_FOUND"
echo "QT5_12_SRC_PATH=$QT5_12_SRC_PATH"
echo "QT5_15_SRC_FOUND=$QT5_15_SRC_FOUND"
echo "QT5_15_SRC_PATH=$QT5_15_SRC_PATH"
echo "QT5_12_SDK_FOUND=$QT5_12_SDK_FOUND"
echo "QT5_12_OHOS_SDK_PATH=$QT5_12_OHOS_SDK_PATH"
echo "QT5_15_SDK_FOUND=$QT5_15_SDK_FOUND"
echo "QT5_15_OHOS_SDK_PATH=$QT5_15_OHOS_SDK_PATH"

# 5b. 独立模板归档检测（BitFun 用户级共享资源目录）
# ═══════════════════════════════════════════════════════════
TEMPLATE_STANDALONE_FOUND="false"
TEMPLATE_STANDALONE_PATH=""
_tpl="$QT_MIGRATION_ROOT/templates"
for candidate in "$_tpl"/*/* "$_tpl"/*; do
  if [ -d "$candidate/entry" ] && [ -f "$candidate/build-profile.json5" ]; then
    TEMPLATE_STANDALONE_FOUND="true"
    TEMPLATE_STANDALONE_PATH="$candidate"
    break
  fi
done
echo "TEMPLATE_STANDALONE_FOUND=$TEMPLATE_STANDALONE_FOUND"
echo "TEMPLATE_STANDALONE_PATH=$TEMPLATE_STANDALONE_PATH"

# ═══════════════════════════════════════════════════════════
# 6. ENV.local.md 状态
# ═══════════════════════════════════════════════════════════
ENV_LOCAL_EXISTS="false"
[ "$KB_FOUND" = "true" ] && [ -f "$KB_ROOT/ENV.local.md" ] && ENV_LOCAL_EXISTS="true"
echo "ENV_LOCAL_EXISTS=$ENV_LOCAL_EXISTS"

# ═══════════════════════════════════════════════════════════
# 7. 就绪度快速判断
# ═══════════════════════════════════════════════════════════
APP_READY="true"
[ "$KB_FOUND" = "false" ] && APP_READY="false"
[ "$DEVECO_FOUND" = "false" ] && APP_READY="false"
[ "$OHOS_SDK_NATIVE_FOUND" = "false" ] && APP_READY="false"
[ "$QT5_12_SDK_FOUND" = "false" ] && [ "$QT5_15_SDK_FOUND" = "false" ] && APP_READY="false"
echo "APP_DEVELOPER_READY=$APP_READY"
