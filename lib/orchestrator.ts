import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createSessionId, GateEvidence, assertBaseDir, assertSessionId, hashObject, saveEvidence } from "./evidence.js";
import { appendGateLog, evaluateGate, StageGateContext } from "./gate-engine.js";
import { createRemediationBrief, deriveRootCause, registerFailure } from "./retry.js";
import { TestContract } from "./contracts.js";

export type PipelineStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNRESOLVABLE";

export type PipelineSession = {
  session_id: string;
  current_stage: number;
  attempt: number;
  requirement_hash: string;
  status: PipelineStatus;
  started_at: string;
  updated_at: string;
};

export type StageResult = {
  evidence: GateEvidence;
};

export type StageHandler = {
  stage: number;
  run: (session: PipelineSession) => Promise<StageResult>;
  rollback?: (session: PipelineSession) => Promise<void>;
};

export type StageExecutionOutcome = {
  session: PipelineSession;
  pass: boolean;
  reasons: string[];
  escalated: boolean;
  terminal: boolean;
};

export type StageCheckpoint = {
  stage: number;
  session_id: string;
  pre_state_hash: string;
  committed: boolean;
  timestamp: string;
};

const MAX_STAGE = 7;

const sessionPath = (baseDir: string, sessionId: string): string => {
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, "session.json");
};

const reportPath = (baseDir: string, sessionId: string): string => {
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, "unresolvable-report.json");
};

const checkpointPath = (baseDir: string, sessionId: string, stage: number): string => {
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, `stage-${stage}`, "checkpoint.json");
};

const parseSession = (value: unknown): PipelineSession => {
  if (!value || typeof value !== "object") {
    throw new Error("invalid session payload");
  }

  const session = value as PipelineSession;

  assertSessionId(session.session_id);
  if (session.current_stage < 0 || session.current_stage > MAX_STAGE) throw new Error("invalid current_stage");
  if (session.attempt < 1 || session.attempt > 4) throw new Error("invalid attempt");
  if (!["IN_PROGRESS", "COMPLETED", "FAILED", "UNRESOLVABLE"].includes(session.status)) {
    throw new Error("invalid status");
  }

  return session;
};

export const initSession = async (baseDir: string, requirementHash: string): Promise<PipelineSession> => {
  assertBaseDir(baseDir);
  const session: PipelineSession = {
    session_id: createSessionId(),
    current_stage: 0,
    attempt: 1,
    requirement_hash: requirementHash,
    status: "IN_PROGRESS",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const dir = path.join(baseDir, session.session_id);
  await mkdir(dir, { recursive: true });
  await saveSession(baseDir, session);

  return session;
};

export const loadSession = async (baseDir: string, sessionId: string): Promise<PipelineSession | null> => {
  assertBaseDir(baseDir);
  try {
    const raw = await readFile(sessionPath(baseDir, sessionId), "utf8");
    return parseSession(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const saveSession = async (baseDir: string, session: PipelineSession): Promise<void> => {
  assertBaseDir(baseDir);
  const next: PipelineSession = {
    ...session,
    updated_at: new Date().toISOString(),
  };

  await writeFile(sessionPath(baseDir, session.session_id), `${JSON.stringify(next, null, 2)}\n`, "utf8");
};

export const advanceStage = async (baseDir: string, session: PipelineSession): Promise<PipelineSession> => {
  const nextStage = Math.min(MAX_STAGE, session.current_stage + 1);
  const nextStatus: PipelineStatus = nextStage === MAX_STAGE ? "COMPLETED" : "IN_PROGRESS";

  const next: PipelineSession = {
    ...session,
    current_stage: nextStage,
    attempt: 1,
    status: nextStatus,
  };

  await saveSession(baseDir, next);
  return next;
};

export const markStageRetry = async (baseDir: string, session: PipelineSession): Promise<PipelineSession> => {
  const next: PipelineSession = {
    ...session,
    attempt: Math.min(4, session.attempt + 1),
    status: "IN_PROGRESS",
  };

  await saveSession(baseDir, next);
  return next;
};

export const markTerminal = async (
  baseDir: string,
  session: PipelineSession,
  status: Extract<PipelineStatus, "FAILED" | "UNRESOLVABLE">,
): Promise<PipelineSession> => {
  const next: PipelineSession = {
    ...session,
    status,
  };

  await saveSession(baseDir, next);
  return next;
};

export const beginStage = async (
  baseDir: string,
  session: PipelineSession,
  stage: number,
): Promise<StageCheckpoint> => {
  assertBaseDir(baseDir);
  const stageDir = path.join(baseDir, session.session_id, `stage-${stage}`);
  await mkdir(stageDir, { recursive: true });

  const checkpoint: StageCheckpoint = {
    stage,
    session_id: session.session_id,
    pre_state_hash: hashObject({
      session_id: session.session_id,
      stage,
      attempt: session.attempt,
      requirement_hash: session.requirement_hash,
    }),
    committed: false,
    timestamp: new Date().toISOString(),
  };

  await writeFile(
    checkpointPath(baseDir, session.session_id, stage),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8",
  );

  return checkpoint;
};

export const commitStage = async (
  baseDir: string,
  session: PipelineSession,
  stage: number,
): Promise<void> => {
  const cpPath = checkpointPath(baseDir, session.session_id, stage);

  try {
    const raw = await readFile(cpPath, "utf8");
    const checkpoint = JSON.parse(raw) as StageCheckpoint;
    const committed: StageCheckpoint = { ...checkpoint, committed: true };
    await writeFile(cpPath, `${JSON.stringify(committed, null, 2)}\n`, "utf8");
  } catch {
    // checkpoint missing = nothing to commit
  }
};

export const rollbackStage = async (
  baseDir: string,
  session: PipelineSession,
  stage: number,
  handler?: StageHandler,
): Promise<void> => {
  if (handler?.rollback) {
    try {
      await handler.rollback(session);
    } catch {
      // rollback best-effort
    }
  }

  const cpPath = checkpointPath(baseDir, session.session_id, stage);

  try {
    const raw = await readFile(cpPath, "utf8");
    const checkpoint = JSON.parse(raw) as StageCheckpoint;

    if (!checkpoint.committed) {
      const rollbackEvent = {
        ...checkpoint,
        rolled_back: true,
        rolled_back_at: new Date().toISOString(),
      };

      await writeFile(cpPath, `${JSON.stringify(rollbackEvent, null, 2)}\n`, "utf8");
    }
  } catch {
    // checkpoint missing = nothing to rollback
  }
};

const writeUnresolvableReport = async (
  baseDir: string,
  session: PipelineSession,
  stage: number,
  reasons: string[],
): Promise<string> => {
  const report = {
    session_id: session.session_id,
    stage,
    attempt: session.attempt,
    status: "UNRESOLVABLE",
    reasons,
    timestamp: new Date().toISOString(),
  };

  const filePath = reportPath(baseDir, session.session_id);
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
};

export const executeStage = async (
  baseDir: string,
  session: PipelineSession,
  handler: StageHandler,
  context?: StageGateContext,
): Promise<StageExecutionOutcome> => {
  assertBaseDir(baseDir);

  if (handler.stage !== session.current_stage) {
    throw new Error(`stage mismatch: handler=${handler.stage} session=${session.current_stage}`);
  }

  await beginStage(baseDir, session, handler.stage);

  const result = await handler.run(session);
  const evidence = {
    ...result.evidence,
    requirement_hash: session.requirement_hash,
    stage: handler.stage,
    attempt: session.attempt,
    session_id: session.session_id,
  };

  await saveEvidence(baseDir, evidence);

  const verdict = evaluateGate(evidence, session.requirement_hash, context);
  await appendGateLog(baseDir, evidence, verdict);

  if (verdict.pass) {
    await commitStage(baseDir, session, handler.stage);
    const next = await advanceStage(baseDir, session);
    return { session: next, pass: true, reasons: [], escalated: false, terminal: false };
  }

  const remediation = createRemediationBrief(evidence, verdict.reasons);
  const rootCause = deriveRootCause(remediation);
  const failure = await registerFailure(baseDir, session.session_id, handler.stage, rootCause);

  if (failure.stopNow) {
    await rollbackStage(baseDir, session, handler.stage, handler);
    const terminal = await markTerminal(baseDir, session, "UNRESOLVABLE");
    await writeUnresolvableReport(baseDir, terminal, handler.stage, verdict.reasons);

    return {
      session: terminal,
      pass: false,
      reasons: verdict.reasons,
      escalated: failure.escalate,
      terminal: true,
    };
  }

  const retrySession = await markStageRetry(baseDir, session);

  return {
    session: retrySession,
    pass: false,
    reasons: verdict.reasons,
    escalated: failure.escalate,
    terminal: false,
  };
};

export const executePipeline = async (
  baseDir: string,
  requirementHash: string,
  handlers: StageHandler[],
  testContract?: TestContract,
): Promise<PipelineSession> => {
  let session = await initSession(baseDir, requirementHash);

  for (const handler of handlers) {
    const context: StageGateContext | undefined =
      handler.stage >= 6 && testContract ? { testContract } : undefined;

    while (session.current_stage === handler.stage && session.status === "IN_PROGRESS") {
      const outcome = await executeStage(baseDir, session, handler, context);
      session = outcome.session;

      if (outcome.terminal || session.status !== "IN_PROGRESS") {
        break;
      }
    }

    if (session.status !== "IN_PROGRESS") {
      break;
    }
  }

  return session;
};

export const reportProgress = (session: PipelineSession): string =>
  `session=${session.session_id} stage=${session.current_stage} attempt=${session.attempt} status=${session.status}`;

export const createPlaceholderStageEvidence = (
  session: PipelineSession,
  stage: number,
  checks: Array<{ criterion: string; result: "PASS" | "FAIL"; evidence: string; tool_used: string }>,
): GateEvidence => {
  const input_hash = hashObject({ session: session.session_id, stage, attempt: session.attempt, kind: "input" });
  const output_hash = hashObject({ checks, stage, kind: "output" });

  return {
    session_id: session.session_id,
    stage,
    attempt: session.attempt,
    input_hash,
    output_hash,
    requirement_hash: session.requirement_hash,
    checks,
    reviewer_verdict: checks.every((c) => c.result === "PASS") ? "PASS" : "FAIL",
    remediation_brief: null,
    evidence_delta: null,
    timestamp: new Date().toISOString(),
    gate_log_entry_id: hashObject({ session: session.session_id, stage, attempt: session.attempt, ts: Date.now() }),
  };
};
