import { createHash, randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type CheckResult = {
  criterion: string;
  result: "PASS" | "FAIL";
  evidence: string;
  tool_used: string;
};

export type GateEvidence = {
  session_id: string;
  stage: number;
  attempt: number;
  input_hash: string;
  output_hash: string;
  requirement_hash: string;
  checks: CheckResult[];
  reviewer_verdict: "PASS" | "FAIL" | "REVISE";
  remediation_brief: Record<string, unknown> | null;
  evidence_delta: Record<string, unknown> | null;
  timestamp: string;
  gate_log_entry_id: string;
};

const HASH_REGEX = /^[a-f0-9]{64}$/;
const SESSION_ID_REGEX = /^[a-z0-9]{8,16}-[a-z0-9]{12}$/;

export const assertBaseDir = (baseDir: string): void => {
  if (!baseDir || typeof baseDir !== "string") {
    throw new Error("invalid baseDir");
  }

  if (baseDir.includes("..") || baseDir.includes("\0")) {
    throw new Error("unsafe baseDir");
  }
};

export const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);

  return `{${entries.join(",")}}`;
};

export const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

export const hashObject = (value: unknown): string => sha256(stableJson(value));

export const createSessionId = (): string => {
  const timestamp = Date.now().toString(36);
  const entropy = randomBytes(6).toString("hex");
  return `${timestamp}-${entropy}`;
};

export const assertSessionId = (sessionId: string): void => {
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error("invalid session_id");
  }

  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error("session_id traversal detected");
  }
};

export const validateEvidenceSchema = (evidence: GateEvidence): { ok: boolean; errors: string[] } => {
  const errors: string[] = [];

  try {
    assertSessionId(evidence.session_id);
  } catch {
    errors.push("session_id invalid");
  }

  if (evidence.stage < 0 || evidence.stage > 7) errors.push("stage out of range");
  if (evidence.attempt < 1 || evidence.attempt > 4) errors.push("attempt out of range");
  if (!HASH_REGEX.test(evidence.input_hash)) errors.push("input_hash invalid");
  if (!HASH_REGEX.test(evidence.output_hash)) errors.push("output_hash invalid");
  if (!HASH_REGEX.test(evidence.requirement_hash)) errors.push("requirement_hash invalid");
  if (!Array.isArray(evidence.checks) || evidence.checks.length === 0) errors.push("checks empty");

  evidence.checks.forEach((check, i) => {
    if (!check.criterion) errors.push(`checks[${i}].criterion missing`);
    if (!["PASS", "FAIL"].includes(check.result)) errors.push(`checks[${i}].result invalid`);
    if (!check.evidence) errors.push(`checks[${i}].evidence missing`);
    if (!check.tool_used) errors.push(`checks[${i}].tool_used missing`);
  });

  if (!["PASS", "FAIL", "REVISE"].includes(evidence.reviewer_verdict)) {
    errors.push("reviewer_verdict invalid");
  }

  if (!evidence.timestamp) errors.push("timestamp missing");
  if (!evidence.gate_log_entry_id) errors.push("gate_log_entry_id missing");

  return { ok: errors.length === 0, errors };
};

export const parseGateEvidence = (value: unknown): GateEvidence => {
  if (!value || typeof value !== "object") {
    throw new Error("evidence payload is not object");
  }

  const evidence = value as GateEvidence;
  const result = validateEvidenceSchema(evidence);

  if (!result.ok) {
    throw new Error(`invalid evidence: ${result.errors.join(", ")}`);
  }

  return evidence;
};

export const getStageEvidencePath = (baseDir: string, sessionId: string, stage: number, attempt: number): string => {
  assertBaseDir(baseDir);
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, `stage-${stage}`, `attempt-${attempt}.json`);
};

export const saveEvidence = async (baseDir: string, evidence: GateEvidence): Promise<string> => {
  assertBaseDir(baseDir);
  const parsed = parseGateEvidence(evidence);
  const stageDir = path.join(baseDir, parsed.session_id, `stage-${parsed.stage}`);
  await mkdir(stageDir, { recursive: true });
  const filePath = getStageEvidencePath(baseDir, parsed.session_id, parsed.stage, parsed.attempt);
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
};

export const loadEvidence = async (
  baseDir: string,
  sessionId: string,
  stage: number,
  attempt: number,
): Promise<GateEvidence | null> => {
  const filePath = getStageEvidencePath(baseDir, sessionId, stage, attempt);

  try {
    const raw = await readFile(filePath, "utf8");
    return parseGateEvidence(JSON.parse(raw));
  } catch {
    return null;
  }
};
