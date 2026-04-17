# Quality Gate Pipeline Skill

---
name: pipeline
description: Evidence-driven 8-stage quality gate pipeline for Claude Code + OMC
argument-hint: "<user request or task description>"
---

## Purpose

Single entry point that orchestrates an 8-stage Create→Review pipeline with binary pass/fail gates, evidence schema enforcement, anti-bypass mechanisms, and smart retry with remediation guidance.

## Trigger

`/quality-gate-pipeline "<request>"`

## Pipeline Stages

When invoked, execute the following stages **sequentially**. Never skip or reorder stages.

### Stage 0 — Interview(Discovery)

**Create:** Invoke `/oh-my-claudecode:deep-interview --deep` with the user's request.
**Review gate criteria:**
- `ambiguity_threshold`: ambiguity score ≤ 20%
- `ac_testable`: all acceptance criteria are testable
- `contract_complete`: Requirement Contract has goals, AC, constraints, non-goals

**Output:** Requirement Contract saved via `contracts.createRequirementContract()` → `contracts.saveRequirementContract()`
**Immutable artifact:** `requirement_hash` — locked for all subsequent stages.

### Stage 1 — Analysis & Tooling Orchestrator

**Create:** Run explore agent to scan codebase. Run `/configure-ecc` and `/oh-my-claudecode:mcp-setup` for allowlisted tools only (see `tooling.ECC_ALLOWLIST`). Detect OMC version drift via `tooling.detectVersionDrift()` — if drift detected, run `tooling.runOmcUpdate()`.
**Review gate criteria:**
- `tools_installed`: all required tools installed and verified
- `test_contract_valid`: Test Contract has tool_plan, evaluator_command, smoke_strategy, coverage_target

**Output:** Test Contract saved via `contracts.createTestContract()` → `contracts.saveTestContract()`

### Stage 2 — Spec

**Create:** Build spec artifacts using analyst + architect agents (Opus).
**Review gate criteria:**
- `ac_traceability`: every AC maps to a spec section
- `consensus_reached`: Planner/Architect/Critic consensus via `/oh-my-claudecode:plan --consensus --direct`

**Output:** Spec artifacts in `.omc/quality-gate/{session_id}/stage-2/`

### Stage 3 — Plan

**Create:** Build execution plan from spec.
**Review gate criteria:**
- `plan_covers_ac`: plan tasks cover all acceptance criteria
- `risks_identified`: risk mitigations present
- `dependencies_clear`: task dependencies explicit

**Output:** Plan in `.omc/quality-gate/{session_id}/stage-3/`

### Stage 4 — Worktree Setup

**Create:** Invoke `/oh-my-claudecode:project-session-manager` to create isolated worktree.
**Review gate criteria:**
- `branch_isolation`: worktree on dedicated branch
- `clean_baseline`: git status clean
- `buildable`: project builds from clean state

**Output:** Worktree metadata in `.omc/quality-gate/{session_id}/stage-4/`

### Stage 5 — Code

**Create:** Invoke `/oh-my-claudecode:autopilot` Phase 2 (execution) or `/oh-my-claudecode:ralph` for implementation.
**Review gate criteria:**
- `code_review_pass`: `/code-review` returns no CRITICAL/HIGH
- `security_review_pass`: `/security-review` returns no CRITICAL/HIGH
- Zero `finding_CRITICAL_*` checks with FAIL result
- Zero `finding_HIGH_*` checks with FAIL result

**Output:** Code changes in worktree

### Stage 6 — Test

**Create:** Invoke `/oh-my-claudecode:ultraqa` for test generation and execution.
**Review gate criteria:**
- `all_tests_pass`: every test suite passes
- `coverage_target`: coverage ≥ Test Contract `coverage_target`
- Tools used must match `TestContract.tool_plan` — enforced by gate engine

**Output:** Test logs, coverage report

### Stage 7 — Smoke

**Create:** Invoke `/oh-my-claudecode:ultraqa` smoke mode for critical path E2E tests.
**Review gate criteria:**
- `all_smoke_pass`: every smoke scenario passes
- `artifacts_complete`: screenshots/traces/logs present
- Tools used must match `TestContract.tool_plan`

**Output:** Smoke logs, artifacts

## Gate Execution Protocol

For **each stage**, the orchestrator performs:

```
1. orchestrator.beginStage(baseDir, session, stage)     — create checkpoint
2. handler.run(session)                                  — execute Create phase
3. evidence.saveEvidence(baseDir, evidence)              — persist evidence
4. gate-engine.evaluateGate(evidence, requirementHash, context)  — binary verdict
5. gate-engine.appendGateLog(baseDir, evidence, verdict) — append-only audit
6. IF PASS:
     orchestrator.commitStage()
     orchestrator.advanceStage()
7. IF FAIL:
     retry.createRemediationBrief(evidence, reasons)
     retry.registerFailure(baseDir, sessionId, stage, rootCause)
     IF stopNow:
       orchestrator.rollbackStage()
       orchestrator.markTerminal(UNRESOLVABLE)
       write unresolvable report
     ELSE:
       orchestrator.markStageRetry()
       → re-enter Create phase with remediation brief
```

## Retry Protocol

- Max 3 retries + 1 escalation review per stage
- Each retry requires Evidence Delta proving prior fail-points fixed
- Same root cause 2 consecutive times → immediate STOP
- Escalation review (attempt 4) uses Opus-level agent

## Anti-Bypass Rules

- `requirement_hash` immutable after Stage 0 — validated every gate evaluation
- Gate Log is append-only — rollback events appended, never deleted
- Evidence schema enforced at save time — rejects malformed payloads
- Cannot reduce criteria or swap test cases mid-pipeline
- Session ID validated against path traversal on every file operation
- `baseDir` validated on every entry point

## Progress Reporting

After each stage verdict, display:
```
[Pipeline] stage={N} attempt={M} verdict={PASS|FAIL} session={id}
```

On FAIL, display Remediation Brief with:
- Failed checks and evidence
- Root cause
- Required fix actions

On COMPLETE (all 8 stages PASS):
```
[Pipeline] COMPLETE — all 8 stages passed with full evidence trace
Gate log: .omc/quality-gate/{session_id}/gate-log.jsonl
```

On UNRESOLVABLE:
```
[Pipeline] STOPPED — stage {N} unresolvable after {M} attempts
Report: .omc/quality-gate/{session_id}/unresolvable-report.json
```
