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

  const client = new Client({ name: "qgp-e2e-integrity-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
};

const stopHarness = async (h: McpHarness): Promise<void> => {
  await h.client.close();
  await h.transport.close();
};

describe("e2e: pipeline integrity", () => {
  let harness: McpHarness;

  before(async () => {
    harness = await createHarness();
  });

  after(async () => {
    await stopHarness(harness);
  });

  it("keeps requirement hash immutable and verify stays true on valid flow", async () => {
    const started = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_start",
        arguments: {
          user_goals: ["integrity"],
          acceptance_criteria: ["verify passes"],
          constraints: ["local"],
          non_goals: ["none"],
        },
      }),
    );

    const sessionId = started.session_id as string;
    const initialHash = started.requirement_hash as string;

    const stage0 = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_run_stage",
        arguments: {
          session_id: sessionId,
          stage: 0,
          checks: [
            { criterion: "ambiguity_threshold", result: "PASS", evidence: "ok", tool_used: "deep-interview" },
            { criterion: "ac_testable", result: "PASS", evidence: "ok", tool_used: "analyst" },
          ],
          reviewer_verdict: "PASS",
        },
      }),
    );

    assert.equal(stage0.pass, true);

    const status = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_status",
        arguments: { session_id: sessionId },
      }),
    );

    assert.equal(status.requirement_hash, initialHash);

    const verify = parseTextResult(
      await harness.client.callTool({
        name: "pipeline_verify",
        arguments: { session_id: sessionId },
      }),
    );

    assert.equal(verify.integrity_ok, true);
  });
});
