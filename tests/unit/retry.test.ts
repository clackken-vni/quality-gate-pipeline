import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveRootCause, createRemediationBrief, computeEvidenceDelta } from "../../lib/retry.js";
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

describe("retry", () => {
  describe("deriveRootCause", () => {
    it("returns rootCause when no failed checks", () => {
      const brief = {
        stage: 0,
        failedChecks: [],
        rootCause: "unknown",
        actions: [],
        requiresInterview: false,
      };
      assert.equal(deriveRootCause(brief), "unknown");
    });

    it("combines rootCause with sorted criteria", () => {
      const brief = {
        stage: 0,
        failedChecks: [
          { criterion: "z_check", evidence: "fail" },
          { criterion: "a_check", evidence: "fail" },
        ],
        rootCause: "base",
        actions: [],
        requiresInterview: false,
      };
      assert.equal(deriveRootCause(brief), "base::a_check|z_check");
    });
  });

  describe("createRemediationBrief", () => {
    it("extracts failed checks from evidence", () => {
      const evidence = makeEvidence({
        checks: [
          { criterion: "good", result: "PASS", evidence: "ok", tool_used: "x" },
          { criterion: "bad", result: "FAIL", evidence: "broken", tool_used: "y" },
        ],
      });
      const brief = createRemediationBrief(evidence as any, ["root issue"]);
      assert.equal(brief.failedChecks.length, 1);
      assert.equal(brief.failedChecks[0].criterion, "bad");
      assert.equal(brief.rootCause, "root issue");
      assert.ok(brief.requiresInterview);
    });

    it("handles empty reason hints", () => {
      const evidence = makeEvidence();
      const brief = createRemediationBrief(evidence as any, []);
      assert.equal(brief.rootCause, "unknown_root_cause");
    });
  });

  describe("computeEvidenceDelta", () => {
    it("identifies fixed points", () => {
      const prev = makeEvidence({
        checks: [
          { criterion: "a", result: "FAIL", evidence: "broken", tool_used: "x" },
          { criterion: "b", result: "FAIL", evidence: "broken", tool_used: "x" },
        ],
      });
      const next = makeEvidence({
        checks: [
          { criterion: "a", result: "PASS", evidence: "fixed", tool_used: "x" },
          { criterion: "b", result: "FAIL", evidence: "still broken", tool_used: "x" },
        ],
      });

      const delta = computeEvidenceDelta(prev as any, next as any);
      assert.deepEqual(delta.fixedPoints, ["a"]);
      assert.deepEqual(delta.unresolvedPoints, ["b"]);
      assert.ok(delta.proof.length > 0);
    });

    it("handles all fixed", () => {
      const prev = makeEvidence({
        checks: [{ criterion: "a", result: "FAIL", evidence: "broken", tool_used: "x" }],
      });
      const next = makeEvidence({
        checks: [{ criterion: "a", result: "PASS", evidence: "fixed", tool_used: "x" }],
      });

      const delta = computeEvidenceDelta(prev as any, next as any);
      assert.deepEqual(delta.fixedPoints, ["a"]);
      assert.deepEqual(delta.unresolvedPoints, []);
    });
  });
});
