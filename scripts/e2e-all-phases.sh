#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[e2e] build"
npm --prefix "$ROOT" run build

echo "[e2e] run all e2e"
node --test \
  "$ROOT/tests/e2e/pipeline-all-phases.e2e.ts" \
  "$ROOT/tests/e2e/pipeline-failure-paths.e2e.ts" \
  "$ROOT/tests/e2e/pipeline-integrity.e2e.ts"

echo "[e2e] all phases:ok"
