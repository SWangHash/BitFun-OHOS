#!/bin/bash
# verify-env.sh — 确定性环境验证
#
# 用法: bash skills/kb-init/scripts/verify-env.sh
# 输出: 验证报告（pass / fail / skip 各项 + 整体 STATUS）
# 退出码: 0=成功（STATUS=ready 或 not-ready）

set -uo pipefail

# 从 scripts/ 向上三级到 KB root
KB_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_LOCAL="$KB_ROOT/ENV.local.md"

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  local result="$2"
  local detail="${3:-}"
  if [ "$result" = "pass" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  elif [ "$result" = "fail" ]; then
    echo "  FAIL: $name${detail:+ -- $detail}"
    FAIL=$((FAIL + 1))
  else
    echo "  SKIP: $name${detail:+ -- $detail}"
    SKIP=$((SKIP + 1))
  fi
}

echo "--- 环境验证 ---"
echo ""

# 1. ENV.local.md 存在
if [ -f "$ENV_LOCAL" ]; then
  check "ENV.local.md 存在" "pass"
else
  check "ENV.local.md 存在" "fail" "请先运行初始化 skill 生成 ENV.local.md"
  echo ""
  echo "STATUS=not-ready"
  echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
  exit 0
fi

# 2. 从 ENV.local.md 读取路径
read_env() {
  local key="$1"
  grep -E "^\| \`${key}\`" "$ENV_LOCAL" 2>/dev/null | sed 's/.*| `\([^`]*\)` |$/\1/' | head -1
}

DEVECO_PATH=$(read_env "DEVECO_PATH")
QT5_12_SRC=$(read_env "QT5_12_SRC")
QT5_15_SRC=$(read_env "QT5_15_SRC")
QT_BUILD_ROOT=$(read_env "QT_BUILD_ROOT")
QT5_12_OHOS_SDK=$(read_env "QT5_12_OHOS_SDK")
QT5_15_OHOS_SDK=$(read_env "QT5_15_OHOS_SDK")
OHOS_SDK_NATIVE=$(read_env "OHOS_SDK_NATIVE")

# 3. DevEco Studio
if [ -n "$DEVECO_PATH" ] && [ -d "$DEVECO_PATH" ]; then
  check "DevEco Studio 路径" "pass" "$DEVECO_PATH"
elif [ -n "$DEVECO_PATH" ]; then
  check "DevEco Studio 路径" "fail" "路径不存在: $DEVECO_PATH"
else
  check "DevEco Studio 路径" "fail" "未配置"
fi

# 4. OHOS SDK native
if [ -n "$OHOS_SDK_NATIVE" ] && [ -d "$OHOS_SDK_NATIVE" ]; then
  check "OHOS SDK native" "pass" "$OHOS_SDK_NATIVE"
  if [ -f "$OHOS_SDK_NATIVE/llvm/bin/clang" ] || [ -f "$OHOS_SDK_NATIVE/llvm/bin/clang.exe" ]; then
    check "OHOS clang 编译器" "pass"
  else
    check "OHOS clang 编译器" "fail" "llvm/bin/clang 不存在"
  fi
  if [ -d "$OHOS_SDK_NATIVE/sysroot" ]; then
    check "OHOS sysroot" "pass"
  else
    check "OHOS sysroot" "fail" "sysroot 目录不存在"
  fi
elif [ -n "$OHOS_SDK_NATIVE" ]; then
  check "OHOS SDK native" "fail" "路径不存在: $OHOS_SDK_NATIVE"
else
  check "OHOS SDK native" "fail" "未配置"
fi

# 5. Qt OHOS SDK（至少一个版本必须配置）
QT_SDK_COUNT=0
if [ -n "$QT5_12_OHOS_SDK" ] && [ -d "$QT5_12_OHOS_SDK" ]; then
  check "Qt 5.12 OHOS SDK" "pass" "$QT5_12_OHOS_SDK"
  QT_SDK_COUNT=$((QT_SDK_COUNT + 1))
elif [ -n "$QT5_12_OHOS_SDK" ]; then
  check "Qt 5.12 OHOS SDK" "fail" "路径不存在: $QT5_12_OHOS_SDK"
else
  check "Qt 5.12 OHOS SDK" "skip" "未配置"
fi

if [ -n "$QT5_15_OHOS_SDK" ] && [ -d "$QT5_15_OHOS_SDK" ]; then
  check "Qt 5.15 OHOS SDK" "pass" "$QT5_15_OHOS_SDK"
  QT_SDK_COUNT=$((QT_SDK_COUNT + 1))
elif [ -n "$QT5_15_OHOS_SDK" ]; then
  check "Qt 5.15 OHOS SDK" "fail" "路径不存在: $QT5_15_OHOS_SDK"
else
  check "Qt 5.15 OHOS SDK" "skip" "未配置"
fi

if [ "$QT_SDK_COUNT" -eq 0 ]; then
  check "Qt OHOS SDK (至少一个版本)" "fail" "未配置任何 Qt OHOS SDK"
fi

# 6. 基础工具
if command -v git &>/dev/null; then
  check "git" "pass" "$(git --version 2>/dev/null | head -1)"
else
  check "git" "fail" "未安装"
fi

if command -v cmake &>/dev/null; then
  check "cmake" "pass" "$(cmake --version 2>/dev/null | head -1)"
else
  check "cmake" "fail" "未安装 (brew install cmake 或 https://cmake.org/download/)"
fi

if command -v hdc &>/dev/null; then
  check "hdc" "pass"
else
  check "hdc" "skip" "未在 PATH 中 (DevEco SDK 中通常包含，用于设备调试)"
fi

# 7. Qt 源码（可选，仅编译框架时需要）
if [ -n "$QT5_12_SRC" ] && [ -d "$QT5_12_SRC" ]; then
  check "Qt 5.12 源码" "pass" "$QT5_12_SRC"
elif [ -n "$QT5_12_SRC" ]; then
  check "Qt 5.12 源码" "fail" "路径不存在: $QT5_12_SRC"
else
  check "Qt 5.12 源码" "skip" "未配置 (仅编译 Qt 框架时需要)"
fi

if [ -n "$QT5_15_SRC" ] && [ -d "$QT5_15_SRC" ]; then
  check "Qt 5.15 源码" "pass" "$QT5_15_SRC"
elif [ -n "$QT5_15_SRC" ]; then
  check "Qt 5.15 源码" "fail" "路径不存在: $QT5_15_SRC"
else
  check "Qt 5.15 源码" "skip" "未配置 (仅编译 Qt 框架时需要)"
fi

echo ""
echo "--- 验证结果 ---"
echo "  PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "STATUS=ready"
  echo ""
  echo "环境就绪，可以开始使用 Qt for HarmonyOS 知识库进行应用鸿蒙化开发。"
else
  echo "STATUS=not-ready"
  echo ""
  echo "环境未就绪，请修复上述 FAIL 项后重新运行验证。"
fi
