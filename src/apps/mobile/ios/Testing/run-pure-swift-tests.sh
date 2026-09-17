#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IOS_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUTPUT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/bitfun-ios-pure-swift-tests.XXXXXX")
trap 'rm -rf "$OUTPUT_DIR"' EXIT HUP INT TERM

xcrun --sdk macosx swiftc \
  "$IOS_DIR/BitFun/Infrastructure/RemoteAuthorityGate.swift" \
  "$SCRIPT_DIR/RemoteAuthorityGateTests.swift" \
  -o "$OUTPUT_DIR/remote-authority-gate-tests"
"$OUTPUT_DIR/remote-authority-gate-tests"

xcrun --sdk macosx swiftc \
  "$IOS_DIR/BitFun/Infrastructure/AccountFailureCopy.swift" \
  "$SCRIPT_DIR/AccountFailureCopyTests.swift" \
  -o "$OUTPUT_DIR/account-failure-copy-tests"
"$OUTPUT_DIR/account-failure-copy-tests"

xcrun --sdk macosx swiftc \
  "$IOS_DIR/BitFun/Infrastructure/RemoteHomePresentation.swift" \
  "$SCRIPT_DIR/RemoteHomePresentationTests.swift" \
  -o "$OUTPUT_DIR/remote-home-presentation-tests"
"$OUTPUT_DIR/remote-home-presentation-tests"


xcrun --sdk macosx swiftc \
  "$IOS_DIR/BitFun/Infrastructure/StreamingTextState.swift" \
  "$SCRIPT_DIR/StreamingTextStateTests.swift" \
  -o "$OUTPUT_DIR/streaming-text-state-tests"
"$OUTPUT_DIR/streaming-text-state-tests"

xcrun --sdk macosx swiftc \
  "$IOS_DIR/BitFun/Presentation/Models/MobilePresentationModels.swift" \
  "$SCRIPT_DIR/MobileProcessGroupTests.swift" \
  -o "$OUTPUT_DIR/mobile-process-group-tests"
"$OUTPUT_DIR/mobile-process-group-tests"

printf '%s\n' 'iOS pure Swift focused tests passed.'
