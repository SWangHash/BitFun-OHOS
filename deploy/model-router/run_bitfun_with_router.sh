#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../.." && pwd)

: "${ROUTER_API_URL:?Set ROUTER_API_URL to the Router base URL or chat/completions endpoint}"

# 默认执行本仓库已编译的 BitFun；也可通过 BITFUN_BIN 指定其他二进制。
bitfun_bin=${BITFUN_BIN:-$repo_root/target/debug/bitfun}

router_endpoint=${ROUTER_API_URL%/}
if [[ "$router_endpoint" != */chat/completions ]]; then
  router_endpoint=$router_endpoint/chat/completions
fi

export BITFUN_ROUND_ROUTER_URL=$router_endpoint
export BITFUN_ROUND_ROUTER_MODEL=${ROUTER_MODEL:-router-best}
export BITFUN_ROUND_ROUTER_PROMPT=${ROUTER_SYSTEM_PROMPT:-$script_dir/router_system_prompt.txt}
# Optional compatibility override; normal operation uses local estimates and usage feedback.
if [[ -n ${ROUTER_TOKENIZER_PATH:-} ]]; then
  export BITFUN_ROUND_ROUTER_TOKENIZER_PATH=$ROUTER_TOKENIZER_PATH
fi
export BITFUN_ROUND_ROUTER_TIMEOUT_MS=${ROUTER_TIMEOUT_MS:-10000}
export BITFUN_ROUND_ROUTER_RECENT_ROUNDS=${ROUTER_RECENT_ROUNDS:-3}
export BITFUN_ROUND_ROUTER_MAX_INPUT_TOKENS=${ROUTER_MAX_INPUT_TOKENS:-65536}
export BITFUN_ROUND_ROUTER_CONTEXT_WINDOW=${ROUTER_CONTEXT_WINDOW:-65536}
export BITFUN_ROUND_ROUTER_SUMMARY_ENABLED=${ROUTER_SUMMARY_ENABLED:-true}
export BITFUN_ROUND_ROUTER_SUMMARY_TRIGGER_TOKENS=${ROUTER_SUMMARY_TRIGGER_TOKENS:-8192}
export BITFUN_ROUND_ROUTER_SUMMARY_MAX_TOKENS=${ROUTER_SUMMARY_MAX_TOKENS:-16384}
# Let Core derive a compatible target when an older generation limit is supplied.
if [[ -n ${ROUTER_SUMMARY_TARGET_TOKENS:-} ]]; then
  export BITFUN_ROUND_ROUTER_SUMMARY_TARGET_TOKENS=$ROUTER_SUMMARY_TARGET_TOKENS
fi
export BITFUN_ROUND_ROUTER_SUMMARY_REASONING_PRESET=${ROUTER_SUMMARY_REASONING_PRESET:-auto}
export BITFUN_ROUND_ROUTER_SUMMARY_TIMEOUT_MS=${ROUTER_SUMMARY_TIMEOUT_MS:-120000}
export BITFUN_ROUND_ROUTER_SIMPLE_THRESHOLD=${ROUTER_SIMPLE_THRESHOLD:-0.75}

if [[ -n ${ROUTER_API_KEY:-} ]]; then
  export BITFUN_ROUND_ROUTER_API_KEY=$ROUTER_API_KEY
else
  unset BITFUN_ROUND_ROUTER_API_KEY
fi

if [[ -n ${ROUTER_TRACE_PATH:-} ]]; then
  export BITFUN_ROUND_ROUTER_TRACE=$ROUTER_TRACE_PATH
fi

# 不添加参数时保持 BitFun 原本的交互模式；传入 exec 等参数时则原样转发。
exec "$bitfun_bin" "$@"
