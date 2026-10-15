#!/bin/bash
# install-deps-linux.sh — Linux 平台依赖检查与安装引导
# 也适用于 Windows Git Bash 环境
#
# 用法: bash skills/kb-init/scripts/install-deps-linux.sh [INSTALL_BASE]
# 输出: 检查结果
# 退出码: 0=全部就绪, 1=需要用户手动安装

set -uo pipefail

PASS=0
FAIL=0
WARN=0

ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1${2:+ -- $2}"; FAIL=$((FAIL + 1)); }
warn() { echo "  WARN: $1${2:+ -- $2}"; WARN=$((WARN + 1)); }

# 检测是否为 Windows Git Bash
IS_WINDOWS="false"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS="true";;
esac

if [ "$IS_WINDOWS" = "true" ]; then
  echo "--- Windows (Git Bash) 依赖检查 ---"
else
  echo "--- Linux 依赖检查 ---"
fi
echo ""

# 1. git
if command -v git &>/dev/null; then
  ok "git ($(git --version 2>/dev/null))"
  GIT_NAME=$(git config --global user.name 2>/dev/null || true)
  GIT_EMAIL=$(git config --global user.email 2>/dev/null || true)
  if [ -z "$GIT_NAME" ]; then
    warn "git user.name 未配置" "运行: git config --global user.name \"你的名字\""
  fi
  if [ -z "$GIT_EMAIL" ]; then
    warn "git user.email 未配置" "运行: git config --global user.email \"你的邮箱\""
  fi
else
  if [ "$IS_WINDOWS" = "true" ]; then
    fail "git 未安装" "请访问 https://git-scm.com/download/win 下载 Git for Windows"
  else
    fail "git 未安装" "运行: sudo apt install git 或 sudo yum install git"
  fi
fi

# 2. curl / wget
if command -v curl &>/dev/null; then
  ok "curl"
elif command -v wget &>/dev/null; then
  ok "wget"
else
  if [ "$IS_WINDOWS" = "true" ]; then
    fail "curl 和 wget 均未安装" "Git for Windows 通常自带 curl"
  else
    fail "curl 和 wget 均未安装" "运行: sudo apt install curl"
  fi
fi

# 3. unzip（SDK 解压需要）
if command -v unzip &>/dev/null; then
  ok "unzip"
else
  if [ "$IS_WINDOWS" = "true" ]; then
    warn "unzip 未安装" "Git Bash 可能不自带 unzip，可用 7-Zip 替代"
  else
    fail "unzip 未安装" "运行: sudo apt install unzip"
  fi
fi

# 4. Node.js
if command -v node &>/dev/null; then
  ok "Node.js ($(node --version 2>/dev/null))"
else
  warn "Node.js 未安装" "DevEco 工具链自带 Node.js，如已安装可忽略"
fi

# 5. Java/JDK
if command -v java &>/dev/null; then
  ok "Java ($(java -version 2>&1 | head -1))"
else
  warn "Java 未安装" "DevEco 工具链自带 JDK，如已安装可忽略"
fi

# 6. cmake（Qt 编译和项目构建必需，知识库中引用 189 次）
if command -v cmake &>/dev/null; then
  ok "cmake ($(cmake --version 2>/dev/null | head -1))"
else
  if [ "$IS_WINDOWS" = "true" ]; then
    fail "cmake 未安装" "请访问 https://cmake.org/download/ 下载 Windows 版"
  else
    fail "cmake 未安装" "运行: sudo apt install cmake 或 sudo yum install cmake"
  fi
fi

# 7. DevEco Studio / 命令行工具
DEVECO_FOUND="false"
DEVECO_PATH=""
if [ "$IS_WINDOWS" = "true" ]; then
  # Windows: 检查常见安装路径
  for p in "/c/Program Files/Huawei/DevEco Studio" "/c/Program Files (x86)/Huawei/DevEco Studio" \
           "$LOCALAPPDATA/Programs/DevEco Studio" "/d/DevEco Studio"; do
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
else
  # Linux: 检查命令行工具
  for p in "$HOME/deveco-studio" "/opt/deveco-studio" "$HOME/DevEco-Studio" "$HOME/dev/deveco-studio"; do
    if [ -d "$p" ]; then
      DEVECO_FOUND="true"
      DEVECO_PATH="$p"
      ok "DevEco 工具链 ($p)"
      break
    fi
  done
  if [ "$DEVECO_FOUND" = "false" ]; then
    fail "DevEco 命令行工具未安装" "运行: bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=\$HOME/commandline-tools --url=<下载链接> 自动安装，或访问 https://developer.huawei.com/consumer/cn/download/ 手动下载"
  fi
fi

# 8. hdc
if command -v hdc &>/dev/null; then
  ok "hdc (PATH)"
else
  warn "hdc 未在 PATH 中" "安装 DevEco 后自带，需将 SDK toolchains 目录加入 PATH"
fi

# 9. DevEco CLI (devecocli)
if command -v devecocli &>/dev/null; then
  ok "DevEco CLI (PATH)"
elif [ "$DEVECO_FOUND" = "true" ]; then
  _cli="$DEVECO_PATH/tools/devecocli"
  if [ -f "$_cli" ]; then
    ok "DevEco CLI (DevEco 内置，未加入 PATH)"
    warn "devecocli 未加入 PATH" "建议将 $DEVECO_PATH/tools 加入 PATH"
  else
    warn "DevEco CLI 未找到" "DevEco 工具链应自带 devecocli"
  fi
else
  if [ "$IS_WINDOWS" = "true" ]; then
    warn "DevEco CLI 未找到" "安装 DevEco Studio 后自带"
  else
    warn "DevEco CLI 未找到" "安装 Command Line Tools 后自带"
  fi
fi

# 10. Windows 专属: PowerShell
if [ "$IS_WINDOWS" = "true" ]; then
  if command -v powershell.exe &>/dev/null; then
    ok "PowerShell (powershell.exe)"
  elif command -v pwsh &>/dev/null; then
    ok "PowerShell (pwsh)"
  else
    fail "PowerShell 未找到" "Windows 应自带 PowerShell"
  fi
fi

# 11. 磁盘空间
INSTALL_BASE="${1:-$HOME/dev}"
if [ -d "$(dirname "$INSTALL_BASE")" ]; then
  AVAIL_KB=$(df -k "$(dirname "$INSTALL_BASE")" 2>/dev/null | tail -1 | awk '{print $4}')
  if [ -n "$AVAIL_KB" ]; then
    AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
    if [ "$AVAIL_GB" -ge 5 ]; then
      ok "磁盘空间 (${AVAIL_GB}GB 可用)"
    else
      warn "磁盘空间不足 (${AVAIL_GB}GB 可用，建议至少 5GB)"
    fi
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
