import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateAllowlist,
  resolveVersionConflict,
  detectVersionDrift,
  ECC_ALLOWLIST,
} from "../../lib/tooling.js";

describe("tooling", () => {
  describe("validateAllowlist", () => {
    it("passes for allowlisted tools", () => {
      const result = validateAllowlist(["code-review", "security-review"]);
      assert.ok(result.ok);
      assert.equal(result.blocked.length, 0);
    });

    it("blocks non-allowlisted tools", () => {
      const result = validateAllowlist(["code-review", "malicious-tool"]);
      assert.ok(!result.ok);
      assert.deepEqual(result.blocked, ["malicious-tool"]);
    });

    it("blocks all unknown tools", () => {
      const result = validateAllowlist(["unknown1", "unknown2"]);
      assert.ok(!result.ok);
      assert.equal(result.blocked.length, 2);
    });

    it("passes empty array", () => {
      const result = validateAllowlist([]);
      assert.ok(result.ok);
    });

    it("includes expected tools in allowlist", () => {
      assert.ok(ECC_ALLOWLIST.includes("oh-my-claudecode:deep-interview"));
      assert.ok(ECC_ALLOWLIST.includes("code-review"));
      assert.ok(ECC_ALLOWLIST.includes("security-review"));
    });
  });

  describe("resolveVersionConflict", () => {
    it("skips same version", () => {
      assert.equal(resolveVersionConflict("1.0.0", "1.0.0", { autoUpdateSafe: true }), "skip");
    });

    it("confirms major version change", () => {
      assert.equal(resolveVersionConflict("1.0.0", "2.0.0", { autoUpdateSafe: true }), "confirm");
    });

    it("updates minor with safe policy", () => {
      assert.equal(resolveVersionConflict("1.0.0", "1.1.0", { autoUpdateSafe: true }), "update");
    });

    it("confirms minor without safe policy", () => {
      assert.equal(resolveVersionConflict("1.0.0", "1.1.0", { autoUpdateSafe: false }), "confirm");
    });

    it("confirms invalid version", () => {
      assert.equal(resolveVersionConflict("abc", "1.0.0", { autoUpdateSafe: true }), "confirm");
    });
  });

  describe("detectVersionDrift", () => {
    it("detects no drift when all match", () => {
      const result = detectVersionDrift("1.0.0", "1.0.0", "1.0.0", {
        requiredSkillsPresent: true,
        deprecatedAliasesUsed: false,
        stateSchemaMatches: true,
        hookContractMatches: true,
      });
      assert.ok(!result.driftDetected);
      assert.equal(result.driftScenarios.length, 0);
    });

    it("detects plugin vs CLI mismatch", () => {
      const result = detectVersionDrift("1.0.0", "1.1.0", "1.0.0", {
        requiredSkillsPresent: true,
        deprecatedAliasesUsed: false,
        stateSchemaMatches: true,
        hookContractMatches: true,
      });
      assert.ok(result.driftDetected);
      assert.ok(result.driftScenarios.includes("plugin_vs_cli_version_mismatch"));
    });

    it("detects missing required skills", () => {
      const result = detectVersionDrift("1.0.0", "1.0.0", "1.0.0", {
        requiredSkillsPresent: false,
        deprecatedAliasesUsed: false,
        stateSchemaMatches: true,
        hookContractMatches: true,
      });
      assert.ok(result.driftDetected);
      assert.ok(result.driftScenarios.includes("required_skill_missing"));
    });

    it("detects deprecated aliases", () => {
      const result = detectVersionDrift("1.0.0", "1.0.0", "1.0.0", {
        requiredSkillsPresent: true,
        deprecatedAliasesUsed: true,
        stateSchemaMatches: true,
        hookContractMatches: true,
      });
      assert.ok(result.driftDetected);
      assert.ok(result.driftScenarios.includes("deprecated_alias_in_use"));
    });

    it("detects state schema mismatch", () => {
      const result = detectVersionDrift("1.0.0", "1.0.0", "1.0.0", {
        requiredSkillsPresent: true,
        deprecatedAliasesUsed: false,
        stateSchemaMatches: false,
        hookContractMatches: true,
      });
      assert.ok(result.driftDetected);
      assert.ok(result.driftScenarios.includes("state_schema_mismatch"));
    });

    it("detects hook contract mismatch", () => {
      const result = detectVersionDrift("1.0.0", "1.0.0", "1.0.0", {
        requiredSkillsPresent: true,
        deprecatedAliasesUsed: false,
        stateSchemaMatches: true,
        hookContractMatches: false,
      });
      assert.ok(result.driftDetected);
      assert.ok(result.driftScenarios.includes("hook_contract_mismatch"));
    });
  });
});
