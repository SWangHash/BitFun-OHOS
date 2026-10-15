#!/bin/bash
# install-deps-macos.sh — macOS 平台依赖检查与安装引导
#
# 用法: bash skills/kb-init/scripts/install-deps-macos.sh
# 输出: key=value 格式的检查结果
# 退出码: 0=全部就绪, 1=需要用户手动安装

set -uo pipefail

PASS=0
FAIL=0
WARN=0

ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1${2:+ -- $2}"; FAIL=$((FAIL + 1)); }
warn() { echo "  WARN: $1${2:+ -- $2}"; WARN=$((WARN + 1)); }

echo "--- macOS 依赖检查 ---"
echo ""

# 1. Homebrew
if command -v brew &>/dev/null; then
  ok "Homebrew ($(brew --version 2>/dev/null | head -1))"
else
  fail "Homebrew 未安装" "请访问 https://brew.sh 安装，或运行: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi

# 2. Xcode Command Line Tools
if xcode-select -p &>/dev/null; then
  ok "Xcode Command Line Tools ($(xcode-select -p))"
else
  fail "Xcode Command Line Tools 未安装" "请运行: xcode-select --install"
fi

# 3. git
if command -v git &>/dev/null; then
  ok "git ($(git --version 2>/dev/null))"
  # 检查 git 配置
  GIT_NAME=$(git config --global user.name 2>/dev/null || true)
  GIT_EMAIL=$(git config --global user.email 2>/dev/null || true)
  if [ -z "$GIT_NAME" ]; then
    warn "git user.name 未配置" "运行: git config --global user.name \"你的名字\""
  fi
  if [ -z "$GIT_EMAIL" ]; then
    warn "git user.email 未配置" "运行: git config --global user.email \"你的邮箱\""
  fi
else
  fail "git 未安装" "安装 Xcode Command Line Tools 后自带"
fi

# 4. curl
if command -v curl &>/dev/null; then
  ok "curl"
else
  fail "curl 未安装" "macOS 应自带 curl"
fi

# 5. Node.js（hvigor 构建依赖）
if command -v node &>/dev/null; then
  ok "Node.js ($(node --version 2>/dev/null))"
else
  warn "Node.js 未安装" "DevEco Studio 自带 Node.js，如已安装 DevEco 可忽略"
fi

# 6. Java/JDK（hvigor 构建依赖）
if command -v java &>/dev/null; then
  ok "Java ($(java -version 2>&1 | head -1))"
else
  warn "Java 未安装" "DevEco Studio 自带 JDK，如已安装 DevEco 可忽略"
fi

# 7. cmake（Qt 编译和项目构建必需，知识库中引用 189 次）
if command -v cmake &>/dev/null; then
  ok "cmake ($(cmake --version 2>/dev/null | head -1))"
else
  fail "cmake 未安装" "运行: brew install cmake 或访问 https://cmake.org/download/"
fi

# 8. DevEco Studio
DEVECO_FOUND="false"
DEVECO_PATH=""
for p in "/Applications/DevEco-Studio.app" "$HOME/Applications/DevEco-Studio.app"; do
  if [ -d "$p" ]; then
    DEVECO_FOUND="true"
    DEVECO_PATH="$p"
    ok "DevEco Studio ($p)"
    break
  fi
done
if [ "$DEVECO_FOUND" = "false" ]; then
  fail "DevEco Studio 未安装" "运行: bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=\$HOME/dev/deveco-installer 自动下载安装包，或访问 https://developer.huawei.com/consumer/cn/deveco-studio/ 手动下载"
fi

# 9. hdc（HarmonyOS Device Connector）
if command -v hdc &>/dev/null; then
  ok "hdc (PATH)"
elif [ "$DEVECO_FOUND" = "true" ]; then
  _hdc="$DEVECO_PATH/Contents/sdk/default/openharmony/toolchains/hdc"
  if [ -f "$_hdc" ]; then
    ok "hdc (DevEco SDK 内置)"
  else
    warn "hdc 未找到" "DevEco SDK 中应包含 hdc"
  fi
else
  warn "hdc 未找到" "安装 DevEco Studio 后自带"
fi

# 10. DevEco CLI (devecocli)
DEVECO_CLI_FOUND="false"
if command -v devecocli &>/dev/null; then
  DEVECO_CLI_FOUND="true"
  ok "DevEco CLI (PATH)"
elif [ "$DEVECO_FOUND" = "true" ]; then
  _cli="$DEVECO_PATH/Contents/tools/devecocli"
  if [ -f "$_cli" ]; then
    DEVECO_CLI_FOUND="true"
    ok "DevEco CLI (DevEco Studio 内置，未加入 PATH)"
    warn "devecocli 未加入 PATH" "建议运行: echo 'export PATH=\"$DEVECO_PATH/Contents/tools:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  else
    warn "DevEco CLI 未找到" "DevEco Studio 应自带 devecocli"
  fi
else
  warn "DevEco CLI 未找到" "安装 DevEco Studio 后自带"
fi

# 11. 磁盘空间
INSTALL_BASE="${1:-$HOME/dev}"
if [ -d "$(dirname "$INSTALL_BASE")" ]; then
  AVAIL_KB=$(df -k "$(dirname "$INSTALL_BASE")" 2>/dev/null | tail -1 | awk '{print $4}')
  AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
  if [ "$AVAIL_GB" -ge 5 ]; then
    ok "磁盘空间 (${AVAIL_GB}GB 可用)"
  else
    warn "磁盘空间不足 (${AVAIL_GB}GB 可用，建议至少 5GB)"
  fi
fi

echo ""
echo "--- 结果 ---"
echo "  PASS: $PASS  FAIL: $FAIL  WARN: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "STATUS=not-ready"
  echo "请修复上述 FAIL 项后重新运行。"
  exit 1
else
  echo "STATUS=ready"
  exit 0
fi
