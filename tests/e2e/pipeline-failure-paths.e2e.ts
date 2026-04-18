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

  const client = new Client({ name: "qgp-e2e-failure-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
};

const stopHarness = async (h: McpHarness): Promise<void> => {
  await h.client.close();
  await h.transport.close();
};

describe("e2e: pipeline failure paths", () => {
  let harness: McpHarness;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await stopHarness(harness);
  });

  it("retries then escalates on repeated stage-5 root cause", async () => {
    const startRaw = await harness.client.callTool({
      name: "pipeline_start",
      arguments: {
        user_goals: ["test failure behavior"],
        acceptance_criteria: ["retry and stop works"],
        constraints: ["local only"],
        non_goals: ["ui"],
      },
    });

    const start = parseTextResult(startRaw);
    const sessionId = start.session_id as string;

    // Move quickly to stage 5 with passing checks.
    const passByStage: Record<number, Array<{ criterion: string; result: "PASS" | "FAIL"; evidence: string; tool_used: string }>> = {
      0: [
        { criterion: "ambiguity_threshold", result: "PASS", evidence: "ok", tool_used: "deep-interview" },
        { criterion: "ac_testable", result: "PASS", evidence: "ok", tool_used: "analyst" },
      ],
      1: [
        { criterion: "tools_installed", result: "PASS", evidence: "ok", tool_used: "tooling" },
        { criterion: "test_contract_valid", result: "PASS", evidence: "ok", tool_used: "tooling" },
      ],
      2: [{ criterion: "ac_traceability", result: "PASS", evidence: "ok", tool_used: "plan" }],
      3: [{ criterion: "plan_covers_ac", result: "PASS", evidence: "ok", tool_used: "plan" }],
      4: [{ criterion: "branch_isolation", result: "PASS", evidence: "ok", tool_used: "psm" }],
    };

    for (let stage = 0; stage <= 4; stage++) {
      const r = parseTextResult(
        await harness.client.callTool({
          name: "pipeline_run_stage",
          arguments: {
            session_id: sessionId,
            stage,
            checks: passByStage[stage],
            reviewer_verdict: "PASS",
          },
        }),
      );
      assert.equal(r.pass, true);
    }

    // First FAIL on stage 5
    const failChecks = [
      { criterion: "code_review_pass", result: "PASS" as const, evidence: "ok", tool_used: "code-review" },
      { criterion: "security_review_pass", result: "FAIL" as const, evidence: "critical vuln", tool_used: "security-review" },
      { criterion: "finding_CRITICAL_sql", result: "FAIL" as const, evidence: "sqli", tool_used: "security-review" },
    ];

    const firstFail = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_run_stage",
        arguments: {
          session_id: sessionId,
          stage: 5,
          checks: failChecks,
          reviewer_verdict: "FAIL",
        },
      }),
    );

    assert.equal(firstFail.pass, false);
    assert.equal(firstFail.current_stage, 5);
    assert.equal(firstFail.terminal, false);

    // Same root cause -> terminal UNRESOLVABLE
    const secondFail = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_run_stage",
        arguments: {
          session_id: sessionId,
          stage: 5,
          checks: failChecks,
          reviewer_verdict: "FAIL",
        },
      }),
    );

    assert.equal(secondFail.pass, false);
    assert.equal(secondFail.terminal, true);
    assert.equal(secondFail.status, "UNRESOLVABLE");
  });
});
