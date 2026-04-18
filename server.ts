import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  initSession,
  loadSession,
  advanceStage,
  markStageRetry,
  markTerminal,
  commitStage,
  rollbackStage,
  createPlaceholderStageEvidence,
} from "./lib/orchestrator.js";

import {
  evaluateGate,
  appendGateLog,
  validateImmutableRequirementHash,
  type StageGateContext,
} from "./lib/gate-engine.js";

import {
  createRequirementContract,
  saveRequirementContract,
  loadRequirementContract,
  createTestContract,
  saveTestContract,
  loadTestContract,
  type RequirementContract,
  type TestContract,
} from "./lib/contracts.js";

import {
  type GateEvidence,
  type CheckResult,
  assertSessionId,
  saveEvidence,
} from "./lib/evidence.js";

import {
  registerFailure,
  createRemediationBrief,
  deriveRootCause,
} from "./lib/retry.js";


const BASE_DIR = ".omc/quality-gate";

const server = new Server(
  { name: "quality-gate-pipeline", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const toolDefs = [
  {
    name: "pipeline_start",
    description: "Initialize a new pipeline session with locked requirement hash",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_goals: { type: "array", items: { type: "string" }, description: "User goals from interview" },
        acceptance_criteria: { type: "array", items: { type: "string" }, description: "Testable acceptance criteria" },
        constraints: { type: "array", items: { type: "string" }, description: "Constraints" },
        non_goals: { type: "array", items: { type: "string" }, description: "Non-goals" },
      },
      required: ["user_goals", "acceptance_criteria", "constraints", "non_goals"],
    },
  },
  {
    name: "pipeline_status",
    description: "Get current pipeline session state",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Pipeline session ID" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "pipeline_run_stage",
    description: "Submit evidence for a stage and evaluate the gate. Returns pass/fail verdict with reasons.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Pipeline session ID" },
        stage: { type: "number", minimum: 0, maximum: 7, description: "Stage number (0-7)" },
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              result: { type: "string", enum: ["PASS", "FAIL"] },
              evidence: { type: "string" },
              tool_used: { type: "string" },
            },
            required: ["criterion", "result", "evidence", "tool_used"],
          },
          description: "Array of check results for this stage",
        },
        reviewer_verdict: { type: "string", enum: ["PASS", "FAIL", "REVISE"], description: "Reviewer overall verdict" },
      },
      required: ["session_id", "stage", "checks", "reviewer_verdict"],
    },
  },
  {
    name: "pipeline_resume",
    description: "Load an existing session for resumption",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Pipeline session ID to resume" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "pipeline_verify",
    description: "Verify pipeline integrity: requirement hash immutability, evidence completeness",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Pipeline session ID" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "pipeline_contract",
    description: "Create or load requirement/test contracts",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Pipeline session ID" },
        action: { type: "string", enum: ["create_requirement", "load_requirement", "create_test", "load_test"] },
        contract: { type: "object", description: "Contract payload (for create actions)" },
      },
      required: ["session_id", "action"],
    },
  },
];

const ok = (data: unknown): { content: Array<{ type: "text"; text: string }> } => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const fail = (message: string): { content: Array<{ type: "text"; text: string }>; isError: true } => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "pipeline_start": {
        const contract = createRequirementContract({
          user_goals: args.user_goals as string[],
          acceptance_criteria: args.acceptance_criteria as string[],
          constraints: args.constraints as string[],
          non_goals: args.non_goals as string[],
        });

        const session = await initSession(BASE_DIR, contract.requirement_hash);
        await saveRequirementContract(BASE_DIR, session.session_id, contract);

        return ok({
          session_id: session.session_id,
          current_stage: session.current_stage,
          requirement_hash: contract.requirement_hash,
          status: session.status,
          started_at: session.started_at,
        });
      }

      case "pipeline_status": {
        assertSessionId(args.session_id as string);
        const session = await loadSession(BASE_DIR, args.session_id as string);

        if (!session) {
          return fail(`session not found: ${args.session_id}`);
        }

        return ok({
          session_id: session.session_id,
          current_stage: session.current_stage,
          attempt: session.attempt,
          requirement_hash: session.requirement_hash,
          status: session.status,
          started_at: session.started_at,
          updated_at: session.updated_at,
        });
      }

      case "pipeline_run_stage": {
        assertSessionId(args.session_id as string);
        const session = await loadSession(BASE_DIR, args.session_id as string);

        if (!session) {
          return fail(`session not found: ${args.session_id}`);
        }

        if (session.status !== "IN_PROGRESS") {
          return fail(`session is ${session.status}, cannot run stage`);
        }

        const stage = args.stage as number;
        if (stage !== session.current_stage) {
          return fail(`stage mismatch: expected ${session.current_stage}, got ${stage}`);
        }

        const checks = args.checks as CheckResult[];
        const reviewerVerdict = args.reviewer_verdict as "PASS" | "FAIL" | "REVISE";

        const evidence = createPlaceholderStageEvidence(session, stage, checks);
        const enrichedEvidence: GateEvidence = {
          ...evidence,
          reviewer_verdict: reviewerVerdict,
        };

        await saveEvidence(BASE_DIR, enrichedEvidence);

        const testContract = await loadTestContract(BASE_DIR, session.session_id);
        const context: StageGateContext | undefined =
          stage >= 6 && testContract ? { testContract } : undefined;

        const verdict = evaluateGate(enrichedEvidence, session.requirement_hash, context);
        await appendGateLog(BASE_DIR, enrichedEvidence, verdict);

        if (verdict.pass) {
          await commitStage(BASE_DIR, session, stage);
          const next = await advanceStage(BASE_DIR, session);

          return ok({
            pass: true,
            reasons: [],
            session_id: next.session_id,
            current_stage: next.current_stage,
            attempt: next.attempt,
            status: next.status,
            escalated: false,
            terminal: false,
          });
        }

        const remediation = createRemediationBrief(enrichedEvidence, verdict.reasons);
        const rootCause = deriveRootCause(remediation);
        const failure = await registerFailure(BASE_DIR, session.session_id, stage, rootCause);

        if (failure.stopNow) {
          await rollbackStage(BASE_DIR, session, stage);
          const terminal = await markTerminal(BASE_DIR, session, "UNRESOLVABLE");

          return ok({
            pass: false,
            reasons: verdict.reasons,
            session_id: terminal.session_id,
            current_stage: terminal.current_stage,
            attempt: terminal.attempt,
            status: terminal.status,
            escalated: failure.escalate,
            terminal: true,
            remediation_brief: remediation,
          });
        }

        const retrySession = await markStageRetry(BASE_DIR, session);

        return ok({
          pass: false,
          reasons: verdict.reasons,
          session_id: retrySession.session_id,
          current_stage: retrySession.current_stage,
          attempt: retrySession.attempt,
          status: retrySession.status,
          escalated: failure.escalate,
          terminal: false,
          remediation_brief: remediation,
        });
      }

      case "pipeline_resume": {
        assertSessionId(args.session_id as string);
        const session = await loadSession(BASE_DIR, args.session_id as string);

        if (!session) {
          return fail(`session not found: ${args.session_id}`);
        }

        const reqContract = await loadRequirementContract(BASE_DIR, session.session_id);
        const testContract = await loadTestContract(BASE_DIR, session.session_id);

        return ok({
          session,
          requirement_contract: reqContract,
          test_contract: testContract,
        });
      }

      case "pipeline_verify": {
        assertSessionId(args.session_id as string);
        const session = await loadSession(BASE_DIR, args.session_id as string);

        if (!session) {
          return fail(`session not found: ${args.session_id}`);
        }

        const hashOk = await validateImmutableRequirementHash(
          BASE_DIR,
          session.session_id,
          session.requirement_hash,
        );

        return ok({
          session_id: session.session_id,
          integrity_ok: hashOk,
          requirement_hash: session.requirement_hash,
          current_stage: session.current_stage,
          status: session.status,
        });
      }

      case "pipeline_contract": {
        assertSessionId(args.session_id as string);
        const action = args.action as string;

        switch (action) {
          case "create_requirement": {
            const contract = createRequirementContract(args.contract as Omit<RequirementContract, "schema_version" | "requirement_hash" | "created_at">);
            const filePath = await saveRequirementContract(BASE_DIR, args.session_id as string, contract);
            return ok({ saved: filePath, requirement_hash: contract.requirement_hash });
          }

          case "load_requirement": {
            const contract = await loadRequirementContract(BASE_DIR, args.session_id as string);
            return ok({ contract });
          }

          case "create_test": {
            const contract = createTestContract(args.contract as Omit<TestContract, "schema_version" | "created_at">);
            const filePath = await saveTestContract(BASE_DIR, args.session_id as string, contract);
            return ok({ saved: filePath });
          }

          case "load_test": {
            const contract = await loadTestContract(BASE_DIR, args.session_id as string);
            return ok({ contract });
          }

          default:
            return fail(`unknown contract action: ${action}`);
        }
      }

      default:
        return fail(`unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
});

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  process.stderr.write(`MCP server fatal: ${String(error)}\n`);
  process.exit(1);
});
