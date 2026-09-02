#!/bin/bash
# generate-env-local.sh — 确定性生成 ENV.local.md
#
# 用法: bash skills/kb-init/scripts/generate-env-local.sh [OPTIONS]
# 选项:
#   --deveco-path=PATH         DevEco Studio 路径
#   --qt5-12-src=PATH          Qt 5.12 源码路径
#   --qt5-15-src=PATH          Qt 5.15 源码路径
#   --qt-build-root=PATH       Qt 编译输出根目录
#   --qt5-12-ohos-sdk=PATH     Qt 5.12 OHOS SDK 路径
#   --qt5-15-ohos-sdk=PATH     Qt 5.15 OHOS SDK 路径
#   --ohos-sdk-native=PATH     OHOS SDK native 路径
# 输出: 生成 ENV.local.md 到知识库根目录
# 退出码: 0=成功

set -uo pipefail

# 从 scripts/ 向上三级到 KB root
KB_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUTPUT="$KB_ROOT/ENV.local.md"

DEVECO_PATH=""
QT5_12_SRC=""
QT5_15_SRC=""
QT_BUILD_ROOT=""
QT5_12_OHOS_SDK=""
QT5_15_OHOS_SDK=""
OHOS_SDK_NATIVE=""
OHOS_TEMPLATE_SRC=""

for arg in "$@"; do
  case "$arg" in
    --deveco-path=*) DEVECO_PATH="${arg#*=}";;
    --qt5-12-src=*) QT5_12_SRC="${arg#*=}";;
    --qt5-15-src=*) QT5_15_SRC="${arg#*=}";;
    --qt-build-root=*) QT_BUILD_ROOT="${arg#*=}";;
    --qt5-12-ohos-sdk=*) QT5_12_OHOS_SDK="${arg#*=}";;
    --qt5-15-ohos-sdk=*) QT5_15_OHOS_SDK="${arg#*=}";;
    --ohos-sdk-native=*) OHOS_SDK_NATIVE="${arg#*=}";;
    --ohos-template-src=*) OHOS_TEMPLATE_SRC="${arg#*=}";;
    *) echo "未知选项: $arg" >&2; exit 2;;
  esac
done

cat > "$OUTPUT" << HEADER
# ENV.local.md — 本地路径配置

> 本文件由 \`skills/kb-init/\` 初始化 skill 生成。
> 知识页中以变量名引用路径，Agent 读取时以本文件中的值覆盖 \`ENV.md\` 的默认值。
> 本文件已 gitignore，不入库。
>
> 生成时间: $(date +%F)

---

HEADER

# IDE 与工具路径
echo "## IDE 与工具路径" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| 变量名 | 你的值 |" >> "$OUTPUT"
echo "|--------|--------|" >> "$OUTPUT"
[ -n "$DEVECO_PATH" ] && echo "| \`DEVECO_PATH\` | \`$DEVECO_PATH\` |" >> "$OUTPUT"
[ -n "$OHOS_SDK_NATIVE" ] && echo "| \`OHOS_SDK_NATIVE\` | \`$OHOS_SDK_NATIVE\` |" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Qt 源码路径（如果有）
if [ -n "$QT5_12_SRC" ] || [ -n "$QT5_15_SRC" ]; then
  echo "## Qt 源码路径" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| 变量名 | 你的值 |" >> "$OUTPUT"
  echo "|--------|--------|" >> "$OUTPUT"
  [ -n "$QT5_12_SRC" ] && echo "| \`QT5_12_SRC\` | \`$QT5_12_SRC\` |" >> "$OUTPUT"
  [ -n "$QT5_15_SRC" ] && echo "| \`QT5_15_SRC\` | \`$QT5_15_SRC\` |" >> "$OUTPUT"
  echo "" >> "$OUTPUT"

  # 模板路径：显式指定 > 5.15 源码 > 5.12 源码
  _tpl_src=""
  if [ -n "$OHOS_TEMPLATE_SRC" ]; then
    _tpl_src="$OHOS_TEMPLATE_SRC"
  elif [ -n "$QT5_15_SRC" ]; then
    _tpl_src="$QT5_15_SRC/qtbase/src/harmonyos/templates"
  elif [ -n "$QT5_12_SRC" ]; then
    _tpl_src="$QT5_12_SRC/qtbase/src/harmonyos/templates"
  fi
  if [ -n "$_tpl_src" ]; then
    echo "## 模板" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    echo "| 变量名 | 你的值 |" >> "$OUTPUT"
    echo "|--------|--------|" >> "$OUTPUT"
    echo "| \`OHOS_TEMPLATE_SRC\` | \`$_tpl_src\` |" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
  fi
fi

# 独立模板（无源码时）
if [ -z "$QT5_12_SRC" ] && [ -z "$QT5_15_SRC" ] && [ -n "$OHOS_TEMPLATE_SRC" ]; then
  echo "## 模板" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
  echo "| 变量名 | 你的值 |" >> "$OUTPUT"
  echo "|--------|--------|" >> "$OUTPUT"
  echo "| \`OHOS_TEMPLATE_SRC\` | \`$OHOS_TEMPLATE_SRC\` |" >> "$OUTPUT"
  echo "" >> "$OUTPUT"
fi

# 编译产物与 SDK
echo "## 编译产物与 SDK" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| 变量名 | 你的值 |" >> "$OUTPUT"
echo "|--------|--------|" >> "$OUTPUT"
[ -n "$QT_BUILD_ROOT" ] && echo "| \`QT_BUILD_ROOT\` | \`$QT_BUILD_ROOT\` |" >> "$OUTPUT"
[ -n "$QT5_12_OHOS_SDK" ] && echo "| \`QT5_12_OHOS_SDK\` | \`$QT5_12_OHOS_SDK\` |" >> "$OUTPUT"
[ -n "$QT5_15_OHOS_SDK" ] && echo "| \`QT5_15_OHOS_SDK\` | \`$QT5_15_OHOS_SDK\` |" >> "$OUTPUT"
echo "" >> "$OUTPUT"

echo "ENV.local.md 已生成: $OUTPUT"
