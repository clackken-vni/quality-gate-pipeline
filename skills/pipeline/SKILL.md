# Quality Gate Pipeline

---
name: pipeline
description: Evidence-driven 8-stage quality gate pipeline for Claude Code + OMC
argument-hint: "<user request or task description>"
---

<Purpose>
Orchestrate an 8-stage Create→Review pipeline. Gate verdicts are computed by the MCP runtime (`pipeline_run_stage`), not by model interpretation. Every stage MUST pass before the next begins. No exceptions.
</Purpose>

<Use_When>
- User invokes `/quality-gate-pipeline`
- User wants maximum quality assurance on a task
- User says "pipeline", "quality gate", "full quality"
</Use_When>

<Do_Not_Use_When>
- User wants a quick fix — use ralph
- User wants exploration — use plan
- User says "skip the pipeline" or "just do it"
</Do_Not_Use_When>

<Execution_Policy>
- MUST execute stages 0→6 sequentially via MCP tools. NEVER skip or reorder.
- MUST call `pipeline_start` on entry to initialize session in MCP runtime.
- MUST call `pipeline_run_stage` after each stage to get deterministic PASS/FAIL verdict.
- MUST NOT self-judge PASS/FAIL. The MCP runtime is authoritative.
- MUST invoke the exact OMC skill specified for each stage. DO NOT substitute.
- MUST display progress report after every verdict.
- On FAIL: read `remediation_brief` from response, fix, retry same stage.
- On `terminal: true`: STOP immediately — unresolvable.
</Execution_Policy>

<Steps>

## On Entry

1. Parse user request from `{{ARGUMENTS}}`
2. Call `state_write(mode="skill-active", state={ pipeline: "quality-gate", status: "IN_PROGRESS" })`
3. Initialize session via MCP:
```
result = pipeline_start({
  user_goals: [extracted goals],
  acceptance_criteria: [extracted AC],
  constraints: [extracted constraints],
  non_goals: [extracted non-goals]
})
```
4. Store `session_id` and `requirement_hash` from result.
5. Display:
```
[Pipeline] STARTED — MCP-first quality gate pipeline
[Pipeline] Session: {session_id}
[Pipeline] Requirement hash: {requirement_hash}
[Pipeline] Stage 0/6 — Interview(Discovery)
```

## Stage 0 — Interview(Discovery)

**MUST** invoke: `Skill("oh-my-claudecode:deep-interview", args="--deep {user_request}")`

Wait for deep-interview to complete. Read spec from `.omc/specs/deep-interview-*.md`.

**Collect evidence then submit to MCP:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 0,
  checks: [
    { criterion: "ambiguity_threshold", result: "PASS|FAIL", evidence: "{ambiguity %}", tool_used: "deep-interview" },
    { criterion: "ac_testable", result: "PASS|FAIL", evidence: "{AC assessment}", tool_used: "analyst" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

**If `result.pass === false`:** read `result.remediation_brief`, retry deep-interview.
**If `result.terminal === true`:** STOP — unresolvable.
**If `result.pass === true`:** display and proceed to Stage 1.

Display: `[Pipeline] Stage 0 {PASS|FAIL} — attempt {result.attempt}`

## Stage 1 — Analysis & Tooling

**MUST** do:
1. Spawn explore agent (haiku) to scan codebase
2. Determine test/smoke tools needed
3. Verify tools available
4. Create test contract via MCP:
```
pipeline_contract({
  session_id: "{session_id}",
  action: "create_test",
  contract: {
    requirement_hash: "{requirement_hash}",
    tool_plan: ["jest", "playwright"],
    evaluator_command: "npm test",
    smoke_strategy: "critical-path",
    coverage_target: 80
  }
})
```

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 1,
  checks: [
    { criterion: "tools_installed", result: "PASS|FAIL", evidence: "{tool verification}", tool_used: "tooling" },
    { criterion: "test_contract_valid", result: "PASS|FAIL", evidence: "{contract status}", tool_used: "tooling" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

Handle result same as Stage 0.

Display: `[Pipeline] Stage 1 {PASS|FAIL} — tools verified`

## Stage 2 — Spec

**MUST** invoke: `Skill("oh-my-claudecode:plan", args="--consensus --direct .omc/specs/deep-interview-*.md")`

Wait for consensus. Read plan from `.omc/plans/*.md`.

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 2,
  checks: [
    { criterion: "ac_traceability", result: "PASS|FAIL", evidence: "{traceability assessment}", tool_used: "plan" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

Display: `[Pipeline] Stage 2 {PASS|FAIL} — spec consensus`

## Stage 3 — Plan Verification

Read consensus plan. Verify coverage of ALL acceptance criteria.

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 3,
  checks: [
    { criterion: "plan_covers_ac", result: "PASS|FAIL", evidence: "{coverage assessment}", tool_used: "plan" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

Display: `[Pipeline] Stage 3 {PASS|FAIL} — plan covers all AC`

## Stage 4 — Worktree Setup

**MUST** invoke: `Skill("oh-my-claudecode:project-session-manager")` or `EnterWorktree`.

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 4,
  checks: [
    { criterion: "branch_isolation", result: "PASS|FAIL", evidence: "{branch/git status}", tool_used: "project-session-manager" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

Display: `[Pipeline] Stage 4 {PASS|FAIL} — worktree isolated`

## Stage 5 — Code + Review

**MUST** invoke: `Skill("oh-my-claudecode:ralph")` with consensus plan.
**Then MUST** run: `Skill("code-review")` + `Skill("security-review")`.

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 5,
  checks: [
    { criterion: "code_review_pass", result: "PASS|FAIL", evidence: "{review summary}", tool_used: "code-review" },
    { criterion: "security_review_pass", result: "PASS|FAIL", evidence: "{security summary}", tool_used: "security-review" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

**If CRITICAL/HIGH findings:** set result to FAIL, include `finding_CRITICAL_*` or `finding_HIGH_*` checks.

Display: `[Pipeline] Stage 5 {PASS|FAIL} — code+security review`

## Stage 6 — Test + Smoke

**MUST** invoke: `Skill("oh-my-claudecode:ultraqa")` for tests.
**Then MUST** invoke: `Skill("oh-my-claudecode:verify")` to validate.

**Submit evidence:**
```
result = pipeline_run_stage({
  session_id: "{session_id}",
  stage: 6,
  checks: [
    { criterion: "all_tests_pass", result: "PASS|FAIL", evidence: "{test output summary}", tool_used: "jest" },
    { criterion: "coverage_target", result: "PASS|FAIL", evidence: "{coverage %}", tool_used: "jest" },
    { criterion: "all_smoke_pass", result: "PASS|FAIL", evidence: "{smoke output}", tool_used: "playwright" },
    { criterion: "artifacts_complete", result: "PASS|FAIL", evidence: "{artifact list}", tool_used: "playwright" }
  ],
  reviewer_verdict: "PASS|FAIL"
})
```

**If `result.status === "COMPLETED"`:** pipeline done.

Display: `[Pipeline] Stage 6 {PASS|FAIL} — tests + smoke`

## On Completion

1. Call `pipeline_verify({ session_id })` to confirm integrity.
2. Call `pipeline_status({ session_id })` to get final state.
3. Display:
```
[Pipeline] COMPLETE — all stages passed
  Session: {session_id}
  Integrity: {verify.integrity_ok}
  Stage 0: Interview    PASS
  Stage 1: Tooling      PASS
  Stage 2: Spec         PASS
  Stage 3: Plan         PASS
  Stage 4: Worktree     PASS
  Stage 5: Code         PASS
  Stage 6: Test+Smoke   PASS
```
4. Invoke `Skill("oh-my-claudecode:cancel")` to clean up state.

</Steps>

<Retry_Protocol>

Retry is handled by the MCP runtime. When `pipeline_run_stage` returns `pass: false`:

1. Read `result.remediation_brief` — it contains failed checks, root cause, and fix actions.
2. Display:
```
[Pipeline] Stage {N} FAIL (attempt {result.attempt})
  Reasons: {result.reasons}
  Remediation: {result.remediation_brief.actions}
```
3. Fix the issues based on remediation brief.
4. Re-invoke the Create phase of the same stage.
5. Call `pipeline_run_stage` again with fresh evidence.

The runtime enforces:
- Max 3 retries + 1 escalation (attempt 4).
- Same root cause 2 consecutive times → `terminal: true` → STOP.
- Attempt > 4 → `terminal: true` → STOP.

You do NOT need to track attempts manually — the MCP runtime does it.

</Retry_Protocol>

<Anti_Bypass_Rules>
- **NEVER** skip a stage. Stage N+1 MUST NOT begin until Stage N verdict is PASS.
- **NEVER** self-judge PASS/FAIL. MUST call `pipeline_run_stage` for the verdict.
- **NEVER** change the requirement_hash after initialization.
- **NEVER** claim a stage passed without fresh evidence submitted to the MCP tool.
- **NEVER** reduce review criteria to make a stage pass.
- **NEVER** substitute a different skill than what the stage specifies.
- **NEVER** implement code directly — always delegate to the specified skill.
</Anti_Bypass_Rules>

<Final_Checklist>
- [ ] `pipeline_start` called on entry, session_id stored
- [ ] Stage 0: deep-interview invoked, evidence submitted via `pipeline_run_stage`
- [ ] Stage 1: tools verified, test contract created via `pipeline_contract`
- [ ] Stage 2: ralplan consensus, evidence submitted
- [ ] Stage 3: plan verified, evidence submitted
- [ ] Stage 4: worktree created, evidence submitted
- [ ] Stage 5: ralph + code-review + security-review, evidence submitted
- [ ] Stage 6: ultraqa + verify, evidence submitted, status=COMPLETED
- [ ] `pipeline_verify` called to confirm integrity
- [ ] Progress displayed after EVERY verdict
- [ ] `cancel` invoked on completion
</Final_Checklist>

<Examples>
<Good>
MCP-first stage execution:
```
[Pipeline] STARTED — MCP-first quality gate pipeline
[Pipeline] Session: lx8k9m2a-a1b2c3d4e5f6
[Pipeline] Stage 0/6 — Interview(Discovery)
→ Invokes /deep-interview --deep
→ Reads spec, ambiguity=15%
→ Calls pipeline_run_stage(stage=0, checks=[...])
→ Runtime returns: pass=true, current_stage=1
[Pipeline] Stage 0 PASS

[Pipeline] Stage 1/6 — Analysis & Tooling
→ Scans codebase, verifies jest+playwright
→ Calls pipeline_contract(action="create_test", ...)
→ Calls pipeline_run_stage(stage=1, checks=[...])
→ Runtime returns: pass=true, current_stage=2
[Pipeline] Stage 1 PASS — 2 tools verified
...
```
Why good: Every verdict comes from MCP runtime, not model self-judgment.
</Good>

<Bad>
Self-judging without MCP:
```
→ "Ambiguity looks low enough, I'll mark Stage 0 as PASS"
→ Proceeds to Stage 1 without calling pipeline_run_stage
```
Why bad: Verdict MUST come from `pipeline_run_stage`, not model interpretation.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- `result.terminal === true` at any stage → STOP, display unresolvable report
- User says "stop", "cancel", "abort" → STOP and preserve state
- Skill invocation fails → retry once, then STOP with error report
- NEVER continue past a FAIL verdict. NEVER.
</Escalation_And_Stop_Conditions>
