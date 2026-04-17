import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  sha256,
  hashObject,
  stableJson,
  createSessionId,
  assertSessionId,
  assertBaseDir,
  validateEvidenceSchema,
  parseGateEvidence,
} from "../../lib/evidence.js";

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
  gate_log_entry_id: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  ...overrides,
});

describe("evidence", () => {
  describe("sha256", () => {
    it("produces 64-char hex", () => {
      const hash = sha256("hello");
      assert.equal(hash.length, 64);
      assert.match(hash, /^[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
      assert.equal(sha256("same"), sha256("same"));
    });

    it("differs for different input", () => {
      assert.notEqual(sha256("a"), sha256("b"));
    });
  });

  describe("stableJson", () => {
    it("sorts keys deterministically", () => {
      const a = stableJson({ z: 1, a: 2 });
      const b = stableJson({ a: 2, z: 1 });
      assert.equal(a, b);
    });

    it("handles nested objects", () => {
      const result = stableJson({ b: { d: 1, c: 2 }, a: 3 });
      assert.equal(result, '{"a":3,"b":{"c":2,"d":1}}');
    });

    it("handles arrays", () => {
      assert.equal(stableJson([1, 2, 3]), "[1,2,3]");
    });

    it("handles null", () => {
      assert.equal(stableJson(null), "null");
    });
  });

  describe("hashObject", () => {
    it("is deterministic for same object", () => {
      const obj = { b: 2, a: 1 };
      assert.equal(hashObject(obj), hashObject({ a: 1, b: 2 }));
    });
  });

  describe("createSessionId", () => {
    it("produces valid session id", () => {
      const id = createSessionId();
      assert.ok(id.length >= 8);
      assert.ok(id.includes("-"));
    });

    it("produces unique ids", () => {
      const a = createSessionId();
      const b = createSessionId();
      assert.notEqual(a, b);
    });
  });

  describe("assertSessionId", () => {
    it("accepts valid session id", () => {
      const id = createSessionId();
      assert.doesNotThrow(() => assertSessionId(id));
    });

    it("rejects empty string", () => {
      assert.throws(() => assertSessionId(""), /invalid session_id/);
    });

    it("rejects traversal attempt", () => {
      assert.throws(() => assertSessionId("../../etc"), /invalid session_id/);
    });

    it("rejects slash", () => {
      assert.throws(() => assertSessionId("abc/def"), /invalid session_id/);
    });
  });

  describe("assertBaseDir", () => {
    it("accepts normal path", () => {
      assert.doesNotThrow(() => assertBaseDir("/tmp/test"));
    });

    it("rejects empty string", () => {
      assert.throws(() => assertBaseDir(""), /invalid baseDir/);
    });

    it("rejects traversal", () => {
      assert.throws(() => assertBaseDir("/tmp/../etc"), /unsafe baseDir/);
    });

    it("rejects null byte", () => {
      assert.throws(() => assertBaseDir("/tmp/\0bad"), /unsafe baseDir/);
    });
  });

  describe("validateEvidenceSchema", () => {
    it("passes valid evidence", () => {
      const evidence = makeEvidence();
      const result = validateEvidenceSchema(evidence as any);
      assert.ok(result.ok);
      assert.equal(result.errors.length, 0);
    });

    it("fails on invalid stage", () => {
      const evidence = makeEvidence({ stage: 99 });
      const result = validateEvidenceSchema(evidence as any);
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e: string) => e.includes("stage")));
    });

    it("fails on empty checks", () => {
      const evidence = makeEvidence({ checks: [] });
      const result = validateEvidenceSchema(evidence as any);
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e: string) => e.includes("checks")));
    });

    it("fails on invalid hash", () => {
      const evidence = makeEvidence({ input_hash: "not-a-hash" });
      const result = validateEvidenceSchema(evidence as any);
      assert.ok(!result.ok);
      assert.ok(result.errors.some((e: string) => e.includes("input_hash")));
    });
  });

  describe("parseGateEvidence", () => {
    it("parses valid evidence", () => {
      const evidence = makeEvidence();
      const parsed = parseGateEvidence(evidence);
      assert.equal(parsed.stage, 0);
    });

    it("throws on invalid evidence", () => {
      assert.throws(() => parseGateEvidence(null), /not object/);
    });

    it("throws on bad schema", () => {
      assert.throws(() => parseGateEvidence({ stage: 99 }));
    });
  });
});
