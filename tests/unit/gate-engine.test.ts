import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, getStageGateCriteria } from "../../lib/gate-engine.js";
import { sha256, createSessionId } from "../../lib/evidence.js";

const VALID_HASH = sha256("test");

const makeEvidence = (overrides: Record<string, unknown> = {}) => ({
  session_id: createSessionId(),
  stage: 0,
  attempt: 1,
  input_hash: VALID_HASH,
  output_hash: VALID_HASH,
  requirement_hash: VALID_HASH,
  checks: [{ criterion: "test", result: "PASS", evidence: "ok", tool_used: "manual" }],
  reviewer_verdict: "PASS",
  remediation_brief: null,
  evidence_delta: null,
  timestamp: new Date().toISOString(),
  gate_log_entry_id: VALID_HASH,
  ...overrides,
});

describe("gate-engine", () => {
  describe("evaluateGate", () => {
    it("passes valid evidence", () => {
      const evidence = makeEvidence({
        stage: 0,
        checks: [
          { criterion: "ambiguity_threshold", result: "PASS", evidence: "15%", tool_used: "deep-interview" },
          { criterion: "ac_testable", result: "PASS", evidence: "all testable", tool_used: "analyst" },
        ],
      });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(verdict.pass, `expected pass but got reasons: ${verdict.reasons.join(", ")}`);
      assert.equal(verdict.reasons.length, 0);
    });

    it("fails on requirement hash mismatch", () => {
      const evidence = makeEvidence();
      const verdict = evaluateGate(evidence as any, sha256("wrong"));
      assert.ok(!verdict.pass);
      assert.ok(verdict.reasons.some((r: string) => r.includes("requirement_hash mismatch")));
    });

    it("fails on FAIL check", () => {
      const evidence = makeEvidence({
        checks: [{ criterion: "test", result: "FAIL", evidence: "broken", tool_used: "manual" }],
        reviewer_verdict: "FAIL",
      });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(!verdict.pass);
    });

    it("fails on non-PASS reviewer verdict", () => {
      const evidence = makeEvidence({ reviewer_verdict: "REVISE" });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(!verdict.pass);
      assert.ok(verdict.reasons.some((r: string) => r.includes("reviewer_verdict")));
    });
  });

  describe("stage-specific criteria", () => {
    it("has criteria for all 8 stages", () => {
      for (let i = 0; i <= 7; i++) {
        const criteria = getStageGateCriteria(i);
        assert.ok(criteria, `missing criteria for stage ${i}`);
      }
    });

    it("stage 0 requires ambiguity_threshold check", () => {
      const evidence = makeEvidence({
        stage: 0,
        checks: [{ criterion: "other", result: "PASS", evidence: "ok", tool_used: "manual" }],
      });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(!verdict.pass);
      assert.ok(verdict.reasons.some((r: string) => r.includes("ambiguity_threshold")));
    });

    it("stage 0 passes with required checks", () => {
      const evidence = makeEvidence({
        stage: 0,
        checks: [
          { criterion: "ambiguity_threshold", result: "PASS", evidence: "15%", tool_used: "deep-interview" },
          { criterion: "ac_testable", result: "PASS", evidence: "all testable", tool_used: "analyst" },
        ],
      });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(verdict.pass);
    });

    it("stage 5 fails on CRITICAL findings", () => {
      const evidence = makeEvidence({
        stage: 5,
        checks: [
          { criterion: "code_review_pass", result: "PASS", evidence: "ok", tool_used: "code-review" },
          { criterion: "security_review_pass", result: "PASS", evidence: "ok", tool_used: "security-review" },
          { criterion: "finding_CRITICAL_xss", result: "FAIL", evidence: "XSS found", tool_used: "security-review" },
        ],
        reviewer_verdict: "FAIL",
      });
      const verdict = evaluateGate(evidence as any, VALID_HASH);
      assert.ok(!verdict.pass);
      assert.ok(verdict.reasons.some((r: string) => r.includes("CRITICAL")));
    });

    it("stage 6 enforces test contract tools", () => {
      const evidence = makeEvidence({
        stage: 6,
        checks: [
          { criterion: "all_tests_pass", result: "PASS", evidence: "ok", tool_used: "jest" },
          { criterion: "coverage_target", result: "PASS", evidence: "85%", tool_used: "jest" },
        ],
      });
      const testContract = {
        schema_version: "1.0" as const,
        requirement_hash: VALID_HASH,
        tool_plan: ["jest", "playwright"],
        evaluator_command: "npm test",
        smoke_strategy: "critical",
        coverage_target: 80,
        created_at: new Date().toISOString(),
      };
      const verdict = evaluateGate(evidence as any, VALID_HASH, { testContract });
      assert.ok(!verdict.pass);
      assert.ok(verdict.reasons.some((r: string) => r.includes("playwright")));
    });
  });
});
