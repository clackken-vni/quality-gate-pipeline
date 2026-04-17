# Quality Gate Pipeline

---
name: pipeline
description: Evidence-driven 8-stage quality gate pipeline for Claude Code + OMC
argument-hint: "<user request or task description>"
---

<Purpose>
Orchestrate an 8-stage Create→Review pipeline with binary pass/fail gates, evidence-driven verification, anti-bypass mechanisms, and smart retry with remediation guidance. Every stage MUST pass before the next begins. No exceptions.
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
- MUST execute stages 0→7 sequentially. NEVER skip or reorder.
- MUST call `state_write(mode="skill-active")` on entry.
- MUST track current stage via `state_write` after every stage transition.
- MUST invoke the exact OMC skill specified for each stage. DO NOT substitute.
- MUST display progress report after every stage verdict.
- MUST NOT claim completion without all 8 stages showing PASS with evidence.
- MUST NOT proceed to next stage if current stage verdict is FAIL.
- On FAIL: MUST generate Remediation Brief, MUST retry (max 3 + 1 escalation).
- Same root cause 2 consecutive times → MUST STOP immediately.
</Execution_Policy>

<Steps>

## On Entry

1. Parse user request from `{{ARGUMENTS}}`
2. Initialize pipeline state:
```
state_write(mode="skill-active", state={
  pipeline: "quality-gate",
  current_stage: 0,
  attempt: 1,
  status: "IN_PROGRESS",
  started_at: now
})
```
3. Display:
```
[Pipeline] STARTED — 8-stage quality gate pipeline
[Pipeline] Request: "{user request}"
[Pipeline] Stage 0/7 — Interview(Discovery)
```

## Stage 0 — Interview(Discovery)

**MUST** invoke: `Skill("oh-my-claudecode:deep-interview", args="--deep {user_request}")`

**DO NOT** skip the interview. **DO NOT** ask questions yourself instead of invoking deep-interview.

Wait for deep-interview to complete. It will produce a spec at `.omc/specs/deep-interview-*.md`.

**Review gate — verify ALL:**
- [ ] Spec file exists at `.omc/specs/deep-interview-*.md`
- [ ] Ambiguity score ≤ 20% (read from spec metadata)
- [ ] Acceptance criteria are listed and testable
- [ ] Constraints and non-goals are explicit

**If ANY check fails:** generate Remediation Brief, retry deep-interview.

**If PASS:** Record requirement_hash = SHA-256 of spec content. This hash is **IMMUTABLE** for all remaining stages.

```
state_write(mode="skill-active", state={
  current_stage: 1,
  attempt: 1,
  requirement_hash: "{hash}",
  stage_0_verdict: "PASS"
})
```

Display: `[Pipeline] Stage 0 PASS — requirement_hash locked: {hash}`

## Stage 1 — Analysis & Tooling Orchestrator

**MUST** do in order:
1. Spawn explore agent (haiku) to scan codebase structure
2. Determine which test/smoke tools are needed based on the spec + codebase
3. Verify tools are available (run dry-run commands)
4. If tools missing: attempt install from ECC allowlist only

**Allowlist (ONLY these may be auto-installed):**
- oh-my-claudecode:deep-interview
- oh-my-claudecode:plan
- oh-my-claudecode:autopilot
- oh-my-claudecode:project-session-manager
- oh-my-claudecode:verify
- oh-my-claudecode:ultraqa
- code-review
- security-review

**Tools outside this list → STOP and ask user for confirmation.**

**Review gate — verify ALL:**
- [ ] Codebase scan completed with findings documented
- [ ] Test tools identified and verified working
- [ ] Test strategy documented (what tool runs what, coverage target)

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 2,
  attempt: 1,
  stage_1_verdict: "PASS",
  test_tools: [list],
  coverage_target: N
})
```

Display: `[Pipeline] Stage 1 PASS — {N} tools verified, coverage target: {X}%`

## Stage 2 — Spec

**MUST** invoke: `Skill("oh-my-claudecode:plan", args="--consensus --direct .omc/specs/deep-interview-*.md")`

**DO NOT** write the spec yourself. **DO NOT** skip consensus review.

Wait for ralplan to complete with Planner/Architect/Critic consensus.

**Review gate — verify ALL:**
- [ ] Consensus plan exists at `.omc/plans/*.md`
- [ ] Every acceptance criterion from Stage 0 maps to a plan section
- [ ] No unresolved contradictions flagged by Critic

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 3,
  attempt: 1,
  stage_2_verdict: "PASS"
})
```

Display: `[Pipeline] Stage 2 PASS — spec consensus reached`

## Stage 3 — Plan

**MUST** read the consensus plan from Stage 2.
**MUST** verify the plan covers ALL acceptance criteria from Stage 0.
**MUST** verify risk mitigations are present.
**MUST** verify implementation steps reference specific files.

**Review gate — verify ALL:**
- [ ] Plan covers 100% of acceptance criteria (trace each one)
- [ ] Risk mitigations documented
- [ ] File-level task breakdown present
- [ ] Dependencies between tasks explicit

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 4,
  attempt: 1,
  stage_3_verdict: "PASS"
})
```

Display: `[Pipeline] Stage 3 PASS — plan covers all AC, risks mitigated`

## Stage 4 — Worktree Setup

**MUST** invoke: `Skill("oh-my-claudecode:project-session-manager")` or use `EnterWorktree` to create isolated worktree.

**Review gate — verify ALL:**
- [ ] Worktree created on dedicated branch
- [ ] `git status` is clean
- [ ] Project builds from clean state (run build command)

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 5,
  attempt: 1,
  stage_4_verdict: "PASS",
  worktree_path: "{path}"
})
```

Display: `[Pipeline] Stage 4 PASS — worktree isolated at {path}`

## Stage 5 — Code

**MUST** invoke: `Skill("oh-my-claudecode:ralph")` with the consensus plan as input.

Wait for ralph to complete implementation.

**Then MUST** run review:
1. `Skill("code-review")` — read the full output
2. `Skill("security-review")` — read the full output

**Review gate — verify ALL:**
- [ ] Code review: 0 CRITICAL findings, 0 HIGH findings
- [ ] Security review: 0 CRITICAL findings, 0 HIGH findings
- [ ] All planned files created/modified per plan

**If review finds CRITICAL or HIGH:** DO NOT PASS. Generate Remediation Brief with exact findings, retry.

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 6,
  attempt: 1,
  stage_5_verdict: "PASS"
})
```

Display: `[Pipeline] Stage 5 PASS — code review clean, security review clean`

## Stage 6 — Test

**MUST** invoke: `Skill("oh-my-claudecode:ultraqa")` for test generation and execution.

**Then MUST** invoke: `Skill("oh-my-claudecode:verify")` to validate results.

**Review gate — verify ALL:**
- [ ] All test suites pass (read fresh test output, DO NOT assume)
- [ ] Coverage ≥ target from Stage 1
- [ ] Tests use the tools identified in Stage 1

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 7,
  attempt: 1,
  stage_6_verdict: "PASS",
  coverage: "{X}%"
})
```

Display: `[Pipeline] Stage 6 PASS — all tests pass, coverage {X}%`

## Stage 7 — Smoke

**MUST** invoke: `Skill("oh-my-claudecode:ultraqa")` with smoke/E2E focus.

**Then MUST** invoke: `Skill("oh-my-claudecode:verify")` to validate results.

**Review gate — verify ALL:**
- [ ] All critical user flows pass
- [ ] Test artifacts present (logs, screenshots if applicable)
- [ ] No blocker regressions

**If PASS:**
```
state_write(mode="skill-active", state={
  current_stage: 8,
  status: "COMPLETED",
  stage_7_verdict: "PASS"
})
```

Display:
```
[Pipeline] Stage 7 PASS — all smoke scenarios pass

[Pipeline] ✓ COMPLETE — all 8 stages passed
  Stage 0: Interview    PASS
  Stage 1: Tooling      PASS
  Stage 2: Spec         PASS
  Stage 3: Plan         PASS
  Stage 4: Worktree     PASS
  Stage 5: Code         PASS
  Stage 6: Test         PASS
  Stage 7: Smoke        PASS
```

Then invoke `Skill("oh-my-claudecode:cancel")` to clean up state.

</Steps>

<Retry_Protocol>

When ANY stage review gate FAILS:

1. **MUST** display which checks failed and why:
```
[Pipeline] Stage {N} FAIL (attempt {M}/4)
  ✗ {check_name}: {reason}
  ✗ {check_name}: {reason}
  ✓ {check_name}: passed
```

2. **MUST** generate Remediation Brief:
```
[Pipeline] Remediation Brief:
  Failed: {list of failed checks}
  Root cause: {analysis}
  Fix actions:
    1. {specific action}
    2. {specific action}
```

3. **MUST** re-invoke the Create phase of the same stage with the remediation brief as context.

4. **MUST** track attempt count. Max 3 normal retries + 1 escalation (attempt 4 uses Opus).

5. If same root cause appears 2 consecutive times → **MUST STOP immediately**:
```
[Pipeline] STOPPED — stage {N} unresolvable
  Root cause repeated: {cause}
  Attempts: {M}
  Action: manual intervention required
```

6. If attempt > 4 → **MUST STOP**:
```
[Pipeline] STOPPED — stage {N} exceeded max retries
  Attempts: 4
  Last failure: {reason}
```

</Retry_Protocol>

<Anti_Bypass_Rules>
- **NEVER** skip a stage. Stage N+1 MUST NOT begin until Stage N shows PASS.
- **NEVER** change the requirement_hash after Stage 0.
- **NEVER** claim a stage passed without reading fresh evidence output.
- **NEVER** reduce review criteria to make a stage pass.
- **NEVER** substitute a different skill than what the stage specifies.
- **NEVER** implement code directly — always delegate to the specified skill.
- If you find yourself wanting to skip a stage, STOP and display: `[Pipeline] VIOLATION — attempted to skip stage {N}. Resuming from stage {N}.`
</Anti_Bypass_Rules>

<Final_Checklist>
- [ ] state_write called on entry with pipeline metadata
- [ ] Stage 0: deep-interview invoked (not skipped), spec exists, ambiguity ≤ 20%
- [ ] Stage 1: codebase scanned, tools verified, test strategy documented
- [ ] Stage 2: ralplan consensus completed, spec artifacts exist
- [ ] Stage 3: plan verified covering 100% AC with risks
- [ ] Stage 4: worktree created on isolated branch, builds clean
- [ ] Stage 5: ralph completed, code-review + security-review both clean
- [ ] Stage 6: ultraqa tests pass, coverage meets target, verify confirmed
- [ ] Stage 7: ultraqa smoke pass, artifacts present, verify confirmed
- [ ] state updated after EVERY stage transition
- [ ] Progress displayed after EVERY verdict
- [ ] Remediation Brief generated on EVERY FAIL
- [ ] cancel invoked on completion
</Final_Checklist>

<Examples>
<Good>
Correct stage execution:
```
[Pipeline] STARTED — 8-stage quality gate pipeline
[Pipeline] Stage 0/7 — Interview(Discovery)
→ Invokes /deep-interview --deep
→ Waits for completion
→ Reads spec, checks ambiguity=15%
[Pipeline] Stage 0 PASS — requirement_hash locked: a3f8...

[Pipeline] Stage 1/7 — Analysis & Tooling
→ Spawns explore agent
→ Verifies jest, playwright available
[Pipeline] Stage 1 PASS — 2 tools verified, coverage target: 80%
...
```
Why good: Invokes actual skills, waits for output, checks evidence, reports progress.
</Good>

<Bad>
Skipping stages:
```
"I'll start by exploring the codebase and creating a plan..."
→ Enters plan mode directly
→ Starts coding
```
Why bad: Skipped Stage 0 (interview), Stage 1 (tooling), jumped straight to coding. No evidence, no gates, no pipeline.
</Bad>

<Bad>
Self-implementing instead of delegating:
```
"Let me write the spec based on your requirements..."
→ Writes spec directly without invoking deep-interview
```
Why bad: Stage 0 MUST invoke deep-interview skill. The pipeline agent MUST NOT write specs itself.
</Bad>

<Bad>
Claiming pass without evidence:
```
"The code looks good, moving to testing..."
→ No code-review invoked
→ No security-review invoked
```
Why bad: Stage 5 MUST invoke code-review AND security-review and read their output. "Looks good" is not evidence.
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- Same root cause 2 consecutive times at any stage → STOP
- Attempt count > 4 at any stage → STOP
- User says "stop", "cancel", "abort" → STOP and preserve state
- Skill invocation fails → retry once, then STOP with error report
- NEVER continue past a FAIL verdict. NEVER.
</Escalation_And_Stop_Conditions>
