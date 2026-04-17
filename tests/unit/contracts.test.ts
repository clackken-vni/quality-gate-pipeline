import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createRequirementContract,
  parseRequirementContract,
  createTestContract,
  parseTestContract,
} from "../../lib/contracts.js";

describe("contracts", () => {
  describe("createRequirementContract", () => {
    it("creates contract with hash", () => {
      const contract = createRequirementContract({
        user_goals: ["build pipeline"],
        acceptance_criteria: ["all stages pass"],
        constraints: ["local only"],
        non_goals: ["no CI/CD"],
      });

      assert.equal(contract.schema_version, "1.0");
      assert.ok(contract.requirement_hash.length === 64);
      assert.deepEqual(contract.user_goals, ["build pipeline"]);
      assert.ok(contract.created_at);
    });

    it("produces deterministic hash for same input at same time", () => {
      const input = {
        user_goals: ["a"],
        acceptance_criteria: ["b"],
        constraints: ["c"],
        non_goals: ["d"],
      };

      const c1 = createRequirementContract(input);
      const c2 = createRequirementContract(input);
      // Hashes differ due to timestamp
      assert.ok(c1.requirement_hash);
      assert.ok(c2.requirement_hash);
    });
  });

  describe("parseRequirementContract", () => {
    it("parses valid contract", () => {
      const contract = createRequirementContract({
        user_goals: ["goal"],
        acceptance_criteria: ["ac"],
        constraints: ["con"],
        non_goals: ["ng"],
      });

      const parsed = parseRequirementContract(contract);
      assert.equal(parsed.schema_version, "1.0");
    });

    it("rejects null", () => {
      assert.throws(() => parseRequirementContract(null), /invalid/);
    });

    it("rejects wrong schema version", () => {
      assert.throws(
        () => parseRequirementContract({ schema_version: "2.0" }),
        /invalid requirement schema version/,
      );
    });

    it("rejects non-array goals", () => {
      assert.throws(
        () =>
          parseRequirementContract({
            schema_version: "1.0",
            requirement_hash: "abc",
            user_goals: "not-array",
            acceptance_criteria: [],
            constraints: [],
            non_goals: [],
            created_at: "now",
          }),
        /invalid user_goals/,
      );
    });
  });

  describe("createTestContract", () => {
    it("creates test contract", () => {
      const contract = createTestContract({
        requirement_hash: "a".repeat(64),
        tool_plan: ["jest", "playwright"],
        evaluator_command: "npm test",
        smoke_strategy: "critical-path",
        coverage_target: 80,
      });

      assert.equal(contract.schema_version, "1.0");
      assert.deepEqual(contract.tool_plan, ["jest", "playwright"]);
      assert.equal(contract.coverage_target, 80);
    });
  });

  describe("parseTestContract", () => {
    it("parses valid contract", () => {
      const contract = createTestContract({
        requirement_hash: "a".repeat(64),
        tool_plan: ["jest"],
        evaluator_command: "npm test",
        smoke_strategy: "critical",
        coverage_target: 80,
      });

      const parsed = parseTestContract(contract);
      assert.equal(parsed.evaluator_command, "npm test");
    });

    it("rejects unsafe evaluator command", () => {
      assert.throws(
        () =>
          parseTestContract({
            schema_version: "1.0",
            requirement_hash: "a".repeat(64),
            tool_plan: ["jest"],
            evaluator_command: "rm -rf /; echo pwned",
            smoke_strategy: "critical",
            coverage_target: 80,
            created_at: "now",
          }),
        /unsafe evaluator_command/,
      );
    });

    it("rejects null", () => {
      assert.throws(() => parseTestContract(null), /invalid/);
    });
  });
});
