#!/usr/bin/env bash
# Source fallback for the SSH deployment wizard. Requires mirror.sh and
# release-download.sh; container start/health/rollback remain shared with images.

bitfun_build_relay_from_source() (
  set -euo pipefail
  local source_root="$1" platform="$2" checkout revision image_id repository
  command -v git >/dev/null 2>&1 || {
    echo ">>> ERROR: source fallback needs Git; install Git on this host and retry." >&2
    return 1
  }
  mkdir -p "$source_root"
  checkout="$(mktemp -d "$source_root/build-XXXXXXXX")"
  # Freeze the path into the trap: Bash may unwind function locals before EXIT
  # when errexit fires. Never let cleanup depend on a vanished local variable.
  trap "rm -rf -- $(printf '%q' "$checkout")" EXIT
  trap 'exit 1' INT TERM

  echo ">>> Building current BitFun Relay from source. This can take several minutes."
  echo ">>> The existing Relay will keep running until the build completes."
  export GIT_TERMINAL_PROMPT=0
  git init -q "$checkout"
  # Regional routing is shared with Docker installation. Each attempt fetches
  # into a fresh task-owned checkout, never resetting a user's source tree.
  local fetched=0
  for repository in "${BITFUN_GITHUB_GIT_URL:-$BITFUN_REPO_GIT_URL}" "$BITFUN_REPO_GIT_URL"; do
    echo ">>> Fetching current source from $repository"
    if git -C "$checkout" -c core.hooksPath=/dev/null \
      -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 \
      fetch --depth 1 "$repository" refs/heads/main; then
      fetched=1
      break
    fi
  done
  if [ "$fetched" != 1 ]; then
    echo ">>> ERROR: source download failed on every route." >&2
    return 1
  fi
  git -C "$checkout" -c core.hooksPath=/dev/null checkout -q --detach FETCH_HEAD
  revision="$(git -C "$checkout" rev-parse HEAD)"
  echo ">>> Building Relay source commit $revision for $platform"
  test -f "$checkout/src/apps/relay-server/Dockerfile"

  export DOCKER_BUILDKIT=1 DOCKER_DEFAULT_PLATFORM="$platform"
  bitfun_image_docker build --progress plain --platform "$platform" \
    --iidfile "$checkout/relay-image.id" \
    --build-arg "CARGO_BUILD_JOBS=${RELAY_CARGO_BUILD_JOBS:-1}" \
    --build-arg "RELAY_GIT_COMMIT=$revision" \
    --build-arg "BITFUN_USE_CN_MIRROR=${BITFUN_USE_CN_MIRROR:-0}" \
    --build-arg "BITFUN_APT_MIRROR=${BITFUN_APT_MIRROR:-mirrors.aliyun.com}" \
    --build-arg "BITFUN_CARGO_SPARSE_URL=${BITFUN_CARGO_SPARSE_URL:-sparse+https://rsproxy.cn/index/}" \
    -f "$checkout/src/apps/relay-server/Dockerfile" "$checkout"
  image_id="$(cat "$checkout/relay-image.id")"
  if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo ">>> ERROR: source build did not produce an immutable image ID." >&2
    return 1
  fi
  local actual_arch
  actual_arch="$(bitfun_image_docker image inspect -f '{{.Architecture}}' "$image_id")"
  if [ "$actual_arch" != "${platform#linux/}" ]; then
    echo ">>> ERROR: source image architecture does not match $platform." >&2
    return 1
  fi
  export BITFUN_RELAY_IMAGE="source:$revision"
  export BITFUN_RELAY_IMAGE_DIGEST="$image_id"
  # Starts by local image ID, with the same volumes, port, health and rollback
  # contract as the published-image path. No Compose or host Rust is needed.
  bitfun_run_relay_image "$image_id" "$platform"
)

bitfun_deploy_with_source_fallback() {
  local mode="$1" source_root="$2" platform
  platform="$(bitfun_relay_native_platform)" || return 1
  if [ "$mode" = image ]; then
    if bitfun_try_release_deploy; then return 0; fi
    echo ">>> Published Relay deployment failed; falling back to a source build."
  else
    echo ">>> No published image is available for current BitFun Relay; falling back to a source build."
  fi
  bitfun_build_relay_from_source "$source_root" "$platform"
}
