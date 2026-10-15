#!/bin/bash
# install-deps-harmonyos.sh — 鸿蒙平台依赖检查与安装引导
# 使用 HarmonyBrew (https://gitcode.com/Harmonybrew) 作为包管理器
#
# 鸿蒙平台限制：
#   - DevEco Studio 无鸿蒙版，未上架应用市场
#   - Command Line Tools 需在统一工单平台提单申请遥测版本
#   - deveco-cli 仓库未声明鸿蒙支持，但可尝试 npm 安装
#
# 状态分级：
#   PASS    — 已就绪
#   FAIL    — 可自动修复但失败了
#   PENDING — 需用户手动操作（提单申请等）
#   WARN    — 非阻塞性提示
#
# 用法: bash skills/kb-init/scripts/install-deps-harmonyos.sh
# 退出码: 0=全部就绪或仅 PENDING, 1=有 FAIL

set -uo pipefail

PASS=0
FAIL=0
WARN=0
PENDING=0

ok()      { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail()    { echo "  FAIL: $1${2:+ -- $2}"; FAIL=$((FAIL + 1)); }
warn()    { echo "  WARN: $1${2:+ -- $2}"; WARN=$((WARN + 1)); }
pending() { echo "  PENDING: $1${2:+ -- $2}"; PENDING=$((PENDING + 1)); }

echo "--- 鸿蒙平台依赖检查 ---"
echo ""
echo "  提示: DevEco Studio / Command Line Tools 当前在鸿蒙平台需手动申请。"
echo "  可自动安装的依赖会正常安装，不可自动的标记为 PENDING。"
echo ""

# 1. HarmonyBrew
if command -v brew &>/dev/null; then
  BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "")
  if echo "$BREW_PREFIX" | grep -q "harmonybrew"; then
    ok "HarmonyBrew ($(brew --version 2>/dev/null | head -1))"
  else
    warn "检测到 Homebrew 而非 HarmonyBrew" "鸿蒙平台建议使用 HarmonyBrew: zsh -c \"\$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)\""
  fi
else
  fail "HarmonyBrew 未安装" "运行: zsh -c \"\$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)\""
fi

# 2. git
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
  if command -v brew &>/dev/null; then
    fail "git 未安装" "运行: brew install git"
  else
    fail "git 未安装" "请先安装 HarmonyBrew，然后运行: brew install git"
  fi
fi

# 3. curl
if command -v curl &>/dev/null; then
  ok "curl"
else
  if command -v brew &>/dev/null; then
    fail "curl 未安装" "运行: brew install curl"
  else
    fail "curl 未安装" "请先安装 HarmonyBrew，然后运行: brew install curl"
  fi
fi

# 4. Node.js
if command -v node &>/dev/null; then
  ok "Node.js ($(node --version 2>/dev/null))"
else
  if command -v brew &>/dev/null; then
    fail "Node.js 未安装" "运行: brew install node（deveco-cli 和 hvigor 依赖 Node.js）"
  else
    fail "Node.js 未安装" "请先安装 HarmonyBrew，然后运行: brew install node"
  fi
fi

# 5. Java/JDK
if command -v java &>/dev/null; then
  ok "Java ($(java -version 2>&1 | head -1))"
else
  if command -v brew &>/dev/null; then
    warn "Java 未安装" "运行: brew install openjdk"
  else
    warn "Java 未安装" "请先安装 HarmonyBrew，然后运行: brew install openjdk"
  fi
fi

# 6. cmake
if command -v cmake &>/dev/null; then
  ok "cmake ($(cmake --version 2>/dev/null | head -1))"
else
  if command -v brew &>/dev/null; then
    fail "cmake 未安装" "运行: brew install cmake"
  else
    fail "cmake 未安装" "请先安装 HarmonyBrew，然后运行: brew install cmake"
  fi
fi

# 7. DevEco Studio / Command Line Tools
DEVECO_FOUND="false"
DEVECO_PATH=""
for p in "/opt/deveco-studio" "$HOME/deveco-studio" "$HOME/commandline-tools" "/usr/local/commandline-tools" "$HOME/dev/commandline-tools" "$HOME/DevEco-Studio"; do
  if [ -d "$p" ]; then
    DEVECO_FOUND="true"
    DEVECO_PATH="$p"
    ok "DevEco Studio/CLT ($p)"
    break
  fi
done
if [ "$DEVECO_FOUND" = "false" ]; then
  if command -v devecocli &>/dev/null; then
    DEVECO_FOUND="true"
    DEVECO_PATH=$(dirname "$(dirname "$(command -v devecocli)")")
    ok "DevEco CLI (PATH: $DEVECO_PATH)"
  else
    pending "DevEco Studio / Command Line Tools 未安装" "鸿蒙平台需手动申请：访问 https://developer.huawei.com/consumer/cn/ 统一工单平台，提单申请 Command Line Tools for HarmonyOS 遥测版本。获得后运行: bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=\$HOME/commandline-tools --url=<下载链接>"
  fi
fi

# 8. hdc
if command -v hdc &>/dev/null; then
  ok "hdc (PATH)"
elif [ "$DEVECO_FOUND" = "true" ] && [ -n "$DEVECO_PATH" ]; then
  _hdc="$DEVECO_PATH/sdk/default/openharmony/toolchains/hdc"
  if [ -f "$_hdc" ]; then
    ok "hdc (SDK 内置)"
  else
    warn "hdc 未找到" "SDK 中应包含 hdc"
  fi
else
  pending "hdc 未找到" "随 Command Line Tools 一起获取"
fi

# 9. devecocli (DevEco 内置)
DEVECO_CLI_FOUND="false"
if command -v devecocli &>/dev/null; then
  DEVECO_CLI_FOUND="true"
  ok "devecocli (PATH)"
elif [ "$DEVECO_FOUND" = "true" ] && [ -n "$DEVECO_PATH" ]; then
  _cli="$DEVECO_PATH/tools/devecocli"
  if [ -f "$_cli" ]; then
    DEVECO_CLI_FOUND="true"
    ok "devecocli (内置，未加入 PATH)"
    warn "devecocli 未加入 PATH" "建议将 $DEVECO_PATH/tools 加入 PATH"
  else
    pending "devecocli 未找到" "随 Command Line Tools 一起获取"
  fi
else
  pending "devecocli 未找到" "随 Command Line Tools 一起获取"
fi

# 10. deveco-cli (开源工具)
DEVECO_CLI_OSS_FOUND="false"
if command -v deveco-cli &>/dev/null; then
  DEVECO_CLI_OSS_FOUND="true"
  ok "deveco-cli ($(deveco-cli --version 2>/dev/null || echo 'installed'))"
else
  if command -v npm &>/dev/null; then
    echo "  INFO: 尝试自动安装 deveco-cli..."
    if npm install -g deveco-cli &>/dev/null 2>&1; then
      if command -v deveco-cli &>/dev/null; then
        DEVECO_CLI_OSS_FOUND="true"
        ok "deveco-cli (自动安装成功)"
      else
        warn "deveco-cli npm install 完成但未找到命令" "可能需要重新打开终端"
      fi
    else
      warn "deveco-cli 自动安装失败" "仓库未声明鸿蒙支持。手动安装: npm install -g deveco-cli 或 git clone https://gitcode.com/openharmony-sig/deveco-cli.git"
    fi
  else
    warn "deveco-cli 未安装 (npm 不可用)" "先安装 Node.js，然后运行: npm install -g deveco-cli"
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
echo "  PASS: $PASS  FAIL: $FAIL  PENDING: $PENDING  WARN: $WARN"
echo ""

if [ "$PENDING" -gt 0 ]; then
  echo "PENDING 项需要手动操作："
  echo "  DevEco Studio / Command Line Tools 在鸿蒙平台需通过统一工单平台申请。"
  echo "  申请地址: https://developer.huawei.com/consumer/cn/"
  echo "  获得下载链接后运行: bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=<目录> --url=<链接>"
  echo ""
fi

if [ "$FAIL" -gt 0 ]; then
  echo "STATUS=not-ready"
  echo "请修复上述 FAIL 项后重新运行。"
  exit 1
else
  echo "STATUS=ready"
  exit 0
fi
