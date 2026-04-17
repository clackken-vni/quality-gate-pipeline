import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { GateEvidence, assertBaseDir, assertSessionId } from "./evidence.js";

export type RetryState = {
  stage: number;
  attempts: number;
  rootCauses: string[];
  terminal: boolean;
};

export type RemediationBrief = {
  stage: number;
  failedChecks: Array<{ criterion: string; evidence: string }>;
  rootCause: string;
  actions: string[];
  requiresInterview: boolean;
};

export type EvidenceDelta = {
  fixedPoints: string[];
  unresolvedPoints: string[];
  proof: string[];
};

const MAX_ATTEMPTS = 4;
const MAX_STAGE = 7;

const parseRetryState = (value: unknown): RetryState => {
  if (!value || typeof value !== "object") {
    throw new Error("invalid retry state");
  }

  const state = value as RetryState;
  if (state.stage < 0 || state.stage > MAX_STAGE) throw new Error("invalid stage");
  if (state.attempts < 0 || state.attempts > MAX_ATTEMPTS) throw new Error("invalid attempts");
  if (!Array.isArray(state.rootCauses)) throw new Error("invalid root causes");

  return state;
};

const retryPath = (baseDir: string, sessionId: string, stage: number): string => {
  assertBaseDir(baseDir);
  assertSessionId(sessionId);
  if (stage < 0 || stage > MAX_STAGE) {
    throw new Error("invalid stage");
  }

  return path.join(baseDir, sessionId, `stage-${stage}`, "retry-state.json");
};

export const loadRetryState = async (
  baseDir: string,
  sessionId: string,
  stage: number,
): Promise<RetryState> => {
  try {
    const raw = await readFile(retryPath(baseDir, sessionId, stage), "utf8");
    return parseRetryState(JSON.parse(raw));
  } catch {
    return { stage, attempts: 0, rootCauses: [], terminal: false };
  }
};

export const saveRetryState = async (
  baseDir: string,
  sessionId: string,
  state: RetryState,
): Promise<void> => {
  const parsed = parseRetryState(state);
  const dir = path.join(baseDir, sessionId, `stage-${parsed.stage}`);
  await mkdir(dir, { recursive: true });
  await writeFile(retryPath(baseDir, sessionId, parsed.stage), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
};

export const deriveRootCause = (brief: RemediationBrief): string => {
  if (brief.failedChecks.length === 0) {
    return brief.rootCause;
  }

  const keys = brief.failedChecks.map((item) => item.criterion).sort();
  return `${brief.rootCause}::${keys.join("|")}`;
};

export const registerFailure = async (
  baseDir: string,
  sessionId: string,
  stage: number,
  rootCauseId: string,
): Promise<{ state: RetryState; stopNow: boolean; escalate: boolean }> => {
  const state = await loadRetryState(baseDir, sessionId, stage);
  const nextAttempts = state.attempts + 1;
  const nextRootCauses = [...state.rootCauses, rootCauseId];

  const sameAsPrevious =
    nextRootCauses.length >= 2 &&
    nextRootCauses[nextRootCauses.length - 1] === nextRootCauses[nextRootCauses.length - 2];

  const stopNow = sameAsPrevious || nextAttempts > MAX_ATTEMPTS;
  const escalate = nextAttempts === MAX_ATTEMPTS && !stopNow;

  const nextState: RetryState = {
    stage,
    attempts: nextAttempts,
    rootCauses: nextRootCauses,
    terminal: stopNow,
  };

  await saveRetryState(baseDir, sessionId, nextState);

  return { state: nextState, stopNow, escalate };
};

export const createRemediationBrief = (evidence: GateEvidence, reasonHints: string[]): RemediationBrief => {
  const failedChecks = evidence.checks
    .filter((check) => check.result === "FAIL")
    .map((check) => ({ criterion: check.criterion, evidence: check.evidence }));

  return {
    stage: evidence.stage,
    failedChecks,
    rootCause: reasonHints[0] ?? "unknown_root_cause",
    actions: [
      "Fix every failed criterion from the latest review.",
      "Preserve requirement hash and gate conditions unchanged.",
      "Attach evidence delta for every fixed fail-point.",
    ],
    requiresInterview: true,
  };
};

export const computeEvidenceDelta = (
  previousEvidence: GateEvidence,
  nextEvidence: GateEvidence,
): EvidenceDelta => {
  const previousFailSet = new Set(
    previousEvidence.checks.filter((check) => check.result === "FAIL").map((check) => check.criterion),
  );

  const nextFailSet = new Set(
    nextEvidence.checks.filter((check) => check.result === "FAIL").map((check) => check.criterion),
  );

  const fixedPoints = [...previousFailSet].filter((criterion) => !nextFailSet.has(criterion));
  const unresolvedPoints = [...nextFailSet].filter((criterion) => previousFailSet.has(criterion));

  const proof = nextEvidence.checks
    .filter((check) => fixedPoints.includes(check.criterion) || check.result === "PASS")
    .map((check) => `${check.criterion}: ${check.evidence}`);

  return { fixedPoints, unresolvedPoints, proof };
};
