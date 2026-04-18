# Pipeline Edit

---
name: pipe-edit
description: Adjust or fix an in-progress quality gate pipeline with optional re-interview, via MCP runtime
argument-hint: "<session_id> <edit description>"
---

<Purpose>
Modify or fix an in-progress pipeline based on new requirements or corrections. Uses MCP tools for state management and gate evaluation. Interview (Stage 0) is OPTIONAL — only if content truly requires re-discovery. All subsequent stages remain MANDATORY.
</Purpose>

<Use_When>
- User invokes `/pipe-edit {session_id} {description}`
- User wants to adjust implementation in an existing pipeline
- User found issues that need correction
</Use_When>

<Do_Not_Use_When>
- Pipeline is already COMPLETED (create new pipeline instead)
- User wants to resume without changes (use `/pipe-continue` instead)
- User wants to start fresh (use `/pipeline` instead)
</Do_Not_Use_When>

<Execution_Policy>
- MUST call `pipeline_resume` to load session state.
- MUST analyze edit description to determine if Stage 0 re-interview is needed.
- MUST use `pipeline_run_stage` for all gate verdicts.
- MUST preserve session_id (same ID throughout).
- If Stage 0 re-runs: requirement_hash MAY change (new contract via `pipeline_start`).
- If Stage 0 skipped: requirement_hash MUST NOT change.
</Execution_Policy>

<Steps>

## On Entry

1. Parse `session_id` and `edit_description` from `{{ARGUMENTS}}`
   - Format: `{session_id} {edit_description}`
   - Edit description is REQUIRED.

2. Load session via MCP:
```
result = pipeline_resume({ session_id: "{session_id}" })
```

3. If `result.error`: display error and stop.
4. If `result.session.status === "COMPLETED"`: display "Cannot edit COMPLETED pipeline" and stop.

5. Call `state_write(mode="skill-active", state={ pipeline: "quality-gate", status: "IN_PROGRESS" })`

6. Display:
```
[pipe-edit] EDITING session {session_id}
[pipe-edit] Current stage: {result.session.current_stage}
[pipe-edit] Edit request: {edit_description}
[pipe-edit] Analyzing edit scope...
```

## Determine Edit Scope

7. Analyze edit description:

**Stage 0 REQUIRED if:**
- Edit fundamentally changes requirements or acceptance criteria
- Edit adds major new features not in original spec
- Edit description is vague or ambiguous
- Original spec missing or incomplete

**Stage 0 SKIP if:**
- Edit is a bug fix or correction
- Edit clarifies existing requirements without changing them
- Edit adjusts implementation details (not requirements)
- Edit is a minor feature addition within existing scope

8. Display scope decision:
```
[pipe-edit] Scope analysis:
  Interview (Stage 0): {REQUIRED | SKIPPING}
  Reason: {explanation}
```

## If Stage 0 REQUIRED

9. Invoke `Skill("oh-my-claudecode:deep-interview", args="--deep {edit_description}")`
10. Create new session with updated requirements:
```
new_result = pipeline_start({
  user_goals: [updated goals],
  acceptance_criteria: [updated AC],
  constraints: [updated constraints],
  non_goals: [updated non-goals]
})
```
11. Store new `session_id` and `requirement_hash`.
12. Submit Stage 0 evidence via `pipeline_run_stage(stage=0, ...)`.

## If Stage 0 SKIPPED

13. Use existing session and requirement_hash from `pipeline_resume`.
14. Display:
```
[pipe-edit] Using existing spec
[pipe-edit] Requirement hash preserved: {requirement_hash}
```

## Execute Remaining Stages

15. Run stages 1→6 in order using same MCP-first flow as `/pipeline`:
    - Each stage: invoke OMC skill → collect evidence → `pipeline_run_stage`
    - Pass `edit_description` as supplementary context to each stage skill
    - Handle retry/terminal same as `/pipeline`

16. On each stage, pass edit context:
    - Stage 2 (Spec): include edit_description in ralplan input
    - Stage 5 (Code): pass edit_description to ralph
    - Stage 6 (Test): ensure tests cover edited functionality

## On Completion

17. Call `pipeline_verify({ session_id })` to confirm integrity.
18. Display:
```
[pipe-edit] EDIT COMPLETE for session {session_id}
  Edit: {edit_description}
  Interview: {EXECUTED | SKIPPED}
  All stages passed
  Integrity: {verify.integrity_ok}
```
19. Invoke `Skill("oh-my-claudecode:cancel")` to clean up state.

</Steps>

<Anti_Bypass_Rules>
- **NEVER** skip stages 1-6 after an edit
- **NEVER** self-judge PASS/FAIL — use `pipeline_run_stage`
- **NEVER** modify session_id (use same or new from `pipeline_start`)
- **NEVER** skip Stage 0 if edit fundamentally changes requirements
- **NEVER** claim edit is complete without running all mandatory stages
</Anti_Bypass_Rules>

<Error_Handling>

**If session not found:**
```
[pipe-edit] ERROR: Session {session_id} not found
[pipe-edit] Use /pipeline to start a new pipeline
```

**If session COMPLETED:**
```
[pipe-edit] ERROR: Cannot edit COMPLETED pipeline
[pipe-edit] Create a new pipeline with /pipeline
```

**If edit_description missing:**
```
[pipe-edit] ERROR: Edit description required
[pipe-edit] Usage: /pipe-edit {session_id} {description}
```

</Error_Handling>

<Examples>
<Good>
```
User: /pipe-edit lx8k9m2a-a1b2c3d4e5f6 Fix authentication bug in login endpoint
→ Calls pipeline_resume({ session_id: "lx8k9m2a-a1b2c3d4e5f6" })
→ Scope: Interview SKIPPING (bug fix, requirements unchanged)
→ Requirement hash preserved
→ Runs stages 1→6 with edit context
→ Each stage: skill → evidence → pipeline_run_stage → verdict
[pipe-edit] EDIT COMPLETE
```
Why good: Correctly skips Stage 0, preserves hash, uses MCP verdicts.
</Good>

<Good>
```
User: /pipe-edit lx8k9m2a-a1b2c3d4e5f6 Add OAuth2 support alongside existing JWT auth
→ Calls pipeline_resume(...)
→ Scope: Interview REQUIRED (major new feature)
→ Calls deep-interview → pipeline_start with new requirements
→ New session, new requirement_hash
→ Runs stages 0→6
[pipe-edit] EDIT COMPLETE — Interview: EXECUTED
```
Why good: Correctly identifies major scope change, re-interviews, gets new hash.
</Good>

<Bad>
```
→ Skips Stage 0 for "Add OAuth2 support" (major new feature)
→ Uses old requirement_hash for fundamentally different requirements
```
Why bad: Major scope change requires re-interview to capture new AC.
</Bad>
</Examples>
