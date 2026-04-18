# Pipeline Continue

---
name: pipe-continue
description: Resume an incomplete quality gate pipeline from saved state via MCP runtime
argument-hint: "<session_id> [optional additional context]"
---

<Purpose>
Resume an incomplete pipeline from its last saved state without re-describing requirements. Uses `pipeline_resume` MCP tool to load session, then continues from current stage using the same MCP-first flow as `/pipeline`.
</Purpose>

<Use_When>
- User invokes `/pipe-continue {session_id}`
- User wants to resume work on an existing pipeline
- Pipeline was interrupted or paused
</Use_When>

<Do_Not_Use_When>
- Pipeline is already marked COMPLETED
- User wants to start a new pipeline (use `/pipeline` instead)
- User wants to modify/edit the pipeline (use `/pipe-edit` instead)
</Do_Not_Use_When>

<Execution_Policy>
- MUST call `pipeline_resume` to load session state from MCP runtime.
- MUST skip all stages already PASS (current_stage tells you where to resume).
- MUST preserve requirement_hash (IMMUTABLE — never recalculate).
- MUST use `pipeline_run_stage` for all gate verdicts (same as `/pipeline`).
- MUST NOT re-run stages that already passed.
</Execution_Policy>

<Steps>

## On Entry

1. Parse `session_id` and optional context from `{{ARGUMENTS}}`
   - Format: `{session_id}` or `{session_id} {additional_context}`

2. Load session via MCP:
```
result = pipeline_resume({ session_id: "{session_id}" })
```

3. If `result.error`: display error and stop.

4. Check session status:
   - If `result.session.status === "COMPLETED"`: display "Pipeline already COMPLETED" and stop.
   - If `result.session.status === "UNRESOLVABLE"`: display "Pipeline UNRESOLVABLE — manual intervention required" and stop.

5. Call `state_write(mode="skill-active", state={ pipeline: "quality-gate", status: "IN_PROGRESS" })`

6. Display:
```
[pipe-continue] RESUMING session {session_id}
[pipe-continue] Current stage: {result.session.current_stage}
[pipe-continue] Attempt: {result.session.attempt}
[pipe-continue] Requirement hash: {result.session.requirement_hash}
[pipe-continue] Additional context: {context if provided}
```

## Resume Execution

7. Jump to `result.session.current_stage` and execute from there using the same stage flow as `/pipeline`:
   - Stage 0 → invoke deep-interview → `pipeline_run_stage(stage=0, ...)`
   - Stage 1 → scan/verify tools → `pipeline_run_stage(stage=1, ...)`
   - Stage 2 → ralplan consensus → `pipeline_run_stage(stage=2, ...)`
   - Stage 3 → verify plan → `pipeline_run_stage(stage=3, ...)`
   - Stage 4 → worktree setup → `pipeline_run_stage(stage=4, ...)`
   - Stage 5 → ralph + reviews → `pipeline_run_stage(stage=5, ...)`
   - Stage 6 → ultraqa + smoke → `pipeline_run_stage(stage=6, ...)`

8. Use existing artifacts from `pipeline_resume` response:
   - `result.requirement_contract` for acceptance criteria
   - `result.test_contract` for test strategy (if available)
   - Requirement hash from session (NEVER change it)

9. If additional context was provided, pass it as supplementary guidance to the current stage skill invocation.

10. Follow the same retry protocol as `/pipeline`:
    - `result.pass === false` → read `remediation_brief`, fix, retry
    - `result.terminal === true` → STOP

## On Completion

11. Call `pipeline_verify({ session_id })` to confirm integrity.
12. Call `pipeline_status({ session_id })` to get final state.
13. Display:
```
[pipe-continue] RESUMED session {session_id} completed successfully
  All stages passed
  Integrity: {verify.integrity_ok}
```
14. Invoke `Skill("oh-my-claudecode:cancel")` to clean up state.

</Steps>

<Anti_Bypass_Rules>
- **NEVER** skip stages that haven't passed
- **NEVER** change requirement_hash
- **NEVER** re-run stages already passed
- **NEVER** self-judge PASS/FAIL — use `pipeline_run_stage`
- **NEVER** create a new session_id
</Anti_Bypass_Rules>

<Error_Handling>

**If session not found:**
```
[pipe-continue] ERROR: Session {session_id} not found
[pipe-continue] Use /pipeline to start a new pipeline
```

**If session COMPLETED:**
```
[pipe-continue] Session {session_id} already COMPLETED
[pipe-continue] Nothing to continue
```

**If session UNRESOLVABLE:**
```
[pipe-continue] Session {session_id} is UNRESOLVABLE
[pipe-continue] Manual intervention required
```

</Error_Handling>

<Examples>
<Good>
```
User: /pipe-continue lx8k9m2a-a1b2c3d4e5f6
→ Calls pipeline_resume({ session_id: "lx8k9m2a-a1b2c3d4e5f6" })
→ Session at stage 5, attempt 1
→ Resumes Stage 5: invokes ralph with existing plan
→ Calls pipeline_run_stage(stage=5, checks=[...])
→ Runtime returns pass=true
→ Continues to Stage 6
→ Calls pipeline_run_stage(stage=6, checks=[...])
→ Runtime returns status=COMPLETED
[pipe-continue] RESUMED session completed successfully
```
Why good: Loads state via MCP, skips completed stages, uses runtime verdicts.
</Good>

<Bad>
```
→ Re-runs Stage 0 interview even though session is at stage 5
```
Why bad: Re-running completed stages wastes time and may change requirement_hash.
</Bad>
</Examples>
