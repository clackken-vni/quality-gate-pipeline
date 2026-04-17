#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

required_files=(
  "plugin.json"
  "skills/pipeline/SKILL.md"
  "lib/evidence.ts"
  "lib/contracts.ts"
  "lib/gate-engine.ts"
  "lib/retry.ts"
  "lib/tooling.ts"
  "lib/orchestrator.ts"
)

for f in "${required_files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "missing file: $f"
    exit 1
  fi
done

node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('plugin.json','utf8'));if(!p.name||!p.entrySkill){process.exit(1)}"

grep -q "Stage 0" "skills/pipeline/SKILL.md"
grep -q "Retry" "skills/pipeline/SKILL.md"

echo "verify:ok"
