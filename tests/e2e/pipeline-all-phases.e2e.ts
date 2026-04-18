import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PROJECT_DIR = path.resolve("/Users/hungdang/emdash-projects/worktrees/create-gate-pipeline-6qt/quality-gate-pipeline");

type McpHarness = {
  client: Client;
  transport: StdioClientTransport;
};

const parseTextResult = (result: unknown): any => {
  const payload = result as { content?: Array<{ type?: string; text?: string }> };
  const txt = payload.content?.find((c) => c.type === "text")?.text;
  assert.ok(txt, "missing text content from MCP result");
  return JSON.parse(txt);
};

const createHarness = async (): Promise<McpHarness> => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "server.ts"],
    cwd: PROJECT_DIR,
  });

  const client = new Client({ name: "qgp-e2e-client", version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
};

const stopHarness = async (h: McpHarness): Promise<void> => {
  await h.client.close();
  await h.transport.close();
};

describe("e2e: pipeline all phases", () => {
  let harness: McpHarness;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await stopHarness(harness);
  });

  it("runs stages 0->7 with PASS evidence", async () => {
    const startRaw = await harness.client.callTool({
      name: "pipeline_start",
      arguments: {
        user_goals: ["deliver MCP-first pipeline"],
        acceptance_criteria: ["all 8 stages pass"],
        constraints: ["local execution"],
        non_goals: ["no CI integration"],
      },
    });

    const start = parseTextResult(startRaw);
    assert.equal(start.status, "IN_PROGRESS");
    assert.equal(start.current_stage, 0);
    const sessionId = start.session_id as string;

    const checksByStage: Record<number, Array<{ criterion: string; result: "PASS" | "FAIL"; evidence: string; tool_used: string }>> = {
      0: [
        { criterion: "ambiguity_threshold", result: "PASS", evidence: "ambiguity=15%", tool_used: "deep-interview" },
        { criterion: "ac_testable", result: "PASS", evidence: "all AC testable", tool_used: "analyst" },
      ],
      1: [
        { criterion: "tools_installed", result: "PASS", evidence: "required tools ready", tool_used: "tooling" },
        { criterion: "test_contract_valid", result: "PASS", evidence: "contract validated", tool_used: "tooling" },
      ],
      2: [
        { criterion: "ac_traceability", result: "PASS", evidence: "traceability matrix complete", tool_used: "plan" },
      ],
      3: [
        { criterion: "plan_covers_ac", result: "PASS", evidence: "all AC mapped", tool_used: "plan" },
      ],
      4: [
        { criterion: "branch_isolation", result: "PASS", evidence: "worktree isolated", tool_used: "project-session-manager" },
      ],
      5: [
        { criterion: "code_review_pass", result: "PASS", evidence: "no critical/high", tool_used: "code-review" },
        { criterion: "security_review_pass", result: "PASS", evidence: "security clean", tool_used: "security-review" },
      ],
      6: [
        { criterion: "all_tests_pass", result: "PASS", evidence: "unit+integration pass", tool_used: "jest" },
      ],
      7: [
        { criterion: "all_smoke_pass", result: "PASS", evidence: "critical smoke pass", tool_used: "playwright" },
        { criterion: "artifacts_complete", result: "PASS", evidence: "screenshots/traces present", tool_used: "playwright" },
      ],
    };

    // Note: advanceStage marks COMPLETED when nextStage === MAX_STAGE (7).
    // So after stage 6 passes, the session becomes COMPLETED at current_stage=7.
    // Stages 0-6 are the actual executable stages; stage 7 is the terminal state.
    for (let stage = 0; stage <= 6; stage++) {
      const verdictRaw = await harness.client.callTool({
        name: "pipeline_run_stage",
        arguments: {
          session_id: sessionId,
          stage,
          checks: checksByStage[stage],
          reviewer_verdict: "PASS",
        },
      });

      const verdict = parseTextResult(verdictRaw);
      assert.equal(verdict.pass, true, `stage ${stage} should pass`);

      if (stage < 6) {
        assert.equal(verdict.current_stage, stage + 1);
        assert.equal(verdict.status, "IN_PROGRESS");
      } else {
        // Stage 6 pass -> advanceStage sets current_stage=7, status=COMPLETED
        assert.equal(verdict.current_stage, 7);
        assert.equal(verdict.status, "COMPLETED");
      }
    }

    const statusRaw = await harness.client.callTool({
      name: "pipeline_status",
      arguments: { session_id: sessionId },
    });

    const status = parseTextResult(statusRaw);
    assert.equal(status.current_stage, 7);
    assert.equal(status.status, "COMPLETED");

    const verifyRaw = await harness.client.callTool({
      name: "pipeline_verify",
      arguments: { session_id: sessionId },
    });

    const verify = parseTextResult(verifyRaw);
    assert.equal(verify.integrity_ok, true);
  });
});
