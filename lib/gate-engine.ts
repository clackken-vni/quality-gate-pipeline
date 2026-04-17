import { appendFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { CheckResult, GateEvidence, assertBaseDir, assertSessionId, hashObject, validateEvidenceSchema } from "./evidence.js";
import { TestContract } from "./contracts.js";

export type GateVerdict = {
  pass: boolean;
  reasons: string[];
};

export type GateLogEntry = {
  gate_log_entry_id: string;
  session_id: string;
  stage: number;
  attempt: number;
  reviewer_verdict: "PASS" | "FAIL" | "REVISE";
  pass: boolean;
  evidence_hash: string;
  requirement_hash: string;
  reasons: string[];
  timestamp: string;
};

export type StageGateCriteria = {
  stage: number;
  validate: (evidence: GateEvidence, context?: StageGateContext) => string[];
};

export type StageGateContext = {
  testContract?: TestContract;
};

const parseGateLogEntry = (value: unknown): GateLogEntry => {
  if (!value || typeof value !== "object") {
    throw new Error("invalid gate log entry");
  }

  const entry = value as GateLogEntry;
  assertSessionId(entry.session_id);

  if (entry.stage < 0 || entry.stage > 7) throw new Error("invalid stage");
  if (entry.attempt < 1 || entry.attempt > 4) throw new Error("invalid attempt");
  if (typeof entry.requirement_hash !== "string") throw new Error("invalid requirement_hash");

  return entry;
};

const findCheck = (checks: CheckResult[], criterion: string): CheckResult | undefined =>
  checks.find((c) => c.criterion === criterion);

const STAGE_CRITERIA: StageGateCriteria[] = [
  {
    stage: 0,
    validate: (evidence) => {
      const errors: string[] = [];
      const ambiguityCheck = findCheck(evidence.checks, "ambiguity_threshold");
      if (!ambiguityCheck) {
        errors.push("stage 0: missing ambiguity_threshold check");
      } else if (ambiguityCheck.result !== "PASS") {
        errors.push("stage 0: ambiguity above 20% threshold");
      }

      const acCheck = findCheck(evidence.checks, "ac_testable");
      if (!acCheck) {
        errors.push("stage 0: missing ac_testable check");
      } else if (acCheck.result !== "PASS") {
        errors.push("stage 0: acceptance criteria not testable");
      }

      return errors;
    },
  },
  {
    stage: 1,
    validate: (evidence) => {
      const errors: string[] = [];
      const toolsCheck = findCheck(evidence.checks, "tools_installed");
      if (!toolsCheck) {
        errors.push("stage 1: missing tools_installed check");
      } else if (toolsCheck.result !== "PASS") {
        errors.push("stage 1: required tools not installed");
      }

      const contractCheck = findCheck(evidence.checks, "test_contract_valid");
      if (!contractCheck) {
        errors.push("stage 1: missing test_contract_valid check");
      } else if (contractCheck.result !== "PASS") {
        errors.push("stage 1: test contract invalid");
      }

      return errors;
    },
  },
  {
    stage: 2,
    validate: (evidence) => {
      const errors: string[] = [];
      const traceCheck = findCheck(evidence.checks, "ac_traceability");
      if (!traceCheck) {
        errors.push("stage 2: missing ac_traceability check");
      } else if (traceCheck.result !== "PASS") {
        errors.push("stage 2: AC traceability matrix incomplete");
      }

      return errors;
    },
  },
  {
    stage: 3,
    validate: (evidence) => {
      const errors: string[] = [];
      const coverageCheck = findCheck(evidence.checks, "plan_covers_ac");
      if (!coverageCheck) {
        errors.push("stage 3: missing plan_covers_ac check");
      } else if (coverageCheck.result !== "PASS") {
        errors.push("stage 3: plan does not cover all acceptance criteria");
      }

      return errors;
    },
  },
  {
    stage: 4,
    validate: (evidence) => {
      const errors: string[] = [];
      const isolationCheck = findCheck(evidence.checks, "branch_isolation");
      if (!isolationCheck) {
        errors.push("stage 4: missing branch_isolation check");
      } else if (isolationCheck.result !== "PASS") {
        errors.push("stage 4: worktree branch not isolated");
      }

      return errors;
    },
  },
  {
    stage: 5,
    validate: (evidence) => {
      const errors: string[] = [];
      const criticalCount = evidence.checks.filter(
        (c) => c.criterion.startsWith("finding_CRITICAL") && c.result === "FAIL",
      ).length;

      const highCount = evidence.checks.filter(
        (c) => c.criterion.startsWith("finding_HIGH") && c.result === "FAIL",
      ).length;

      if (criticalCount > 0) {
        errors.push(`stage 5: ${criticalCount} CRITICAL finding(s)`);
      }

      if (highCount > 0) {
        errors.push(`stage 5: ${highCount} HIGH finding(s)`);
      }

      const reviewCheck = findCheck(evidence.checks, "code_review_pass");
      if (!reviewCheck || reviewCheck.result !== "PASS") {
        errors.push("stage 5: code review did not pass");
      }

      const securityCheck = findCheck(evidence.checks, "security_review_pass");
      if (!securityCheck || securityCheck.result !== "PASS") {
        errors.push("stage 5: security review did not pass");
      }

      return errors;
    },
  },
  {
    stage: 6,
    validate: (evidence, context) => {
      const errors: string[] = [];

      const testsCheck = findCheck(evidence.checks, "all_tests_pass");
      if (!testsCheck || testsCheck.result !== "PASS") {
        errors.push("stage 6: not all tests pass");
      }

      if (context?.testContract) {
        const requiredTools = new Set(context.testContract.tool_plan);
        const usedTools = new Set(evidence.checks.map((c) => c.tool_used));
        const missingTools = [...requiredTools].filter((t) => !usedTools.has(t));

        if (missingTools.length > 0) {
          errors.push(`stage 6: test contract tools not used: ${missingTools.join(", ")}`);
        }

        const coverageCheck = findCheck(evidence.checks, "coverage_target");
        if (!coverageCheck || coverageCheck.result !== "PASS") {
          errors.push(`stage 6: coverage below target (${context.testContract.coverage_target}%)`);
        }
      }

      return errors;
    },
  },
  {
    stage: 7,
    validate: (evidence, context) => {
      const errors: string[] = [];

      const smokeCheck = findCheck(evidence.checks, "all_smoke_pass");
      if (!smokeCheck || smokeCheck.result !== "PASS") {
        errors.push("stage 7: not all smoke scenarios pass");
      }

      if (context?.testContract) {
        const requiredTools = new Set(context.testContract.tool_plan);
        const usedTools = new Set(evidence.checks.map((c) => c.tool_used));
        const missingTools = [...requiredTools].filter((t) => !usedTools.has(t));

        if (missingTools.length > 0) {
          errors.push(`stage 7: test contract tools not used: ${missingTools.join(", ")}`);
        }
      }

      const artifactCheck = findCheck(evidence.checks, "artifacts_complete");
      if (!artifactCheck || artifactCheck.result !== "PASS") {
        errors.push("stage 7: smoke artifacts incomplete");
      }

      return errors;
    },
  },
];

export const getStageGateCriteria = (stage: number): StageGateCriteria | undefined =>
  STAGE_CRITERIA.find((c) => c.stage === stage);

export const evaluateGate = (
  evidence: GateEvidence,
  expectedRequirementHash: string,
  context?: StageGateContext,
): GateVerdict => {
  const reasons: string[] = [];
  const schema = validateEvidenceSchema(evidence);

  if (!schema.ok) {
    reasons.push(...schema.errors);
  }

  if (evidence.requirement_hash !== expectedRequirementHash) {
    reasons.push("requirement_hash mismatch");
  }

  const hasFailCheck = evidence.checks.some((check) => check.result === "FAIL");
  if (hasFailCheck) {
    reasons.push("one or more checks failed");
  }

  if (evidence.reviewer_verdict !== "PASS") {
    reasons.push(`reviewer_verdict is ${evidence.reviewer_verdict}`);
  }

  const stageCriteria = getStageGateCriteria(evidence.stage);
  if (stageCriteria) {
    const stageErrors = stageCriteria.validate(evidence, context);
    reasons.push(...stageErrors);
  }

  return {
    pass: reasons.length === 0,
    reasons,
  };
};

const gateLogPath = (baseDir: string, sessionId: string): string => {
  assertBaseDir(baseDir);
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, "gate-log.jsonl");
};

export const appendGateLog = async (
  baseDir: string,
  evidence: GateEvidence,
  verdict: GateVerdict,
): Promise<GateLogEntry> => {
  const sessionDir = path.join(baseDir, evidence.session_id);
  await mkdir(sessionDir, { recursive: true });

  const entry: GateLogEntry = {
    gate_log_entry_id: evidence.gate_log_entry_id,
    session_id: evidence.session_id,
    stage: evidence.stage,
    attempt: evidence.attempt,
    reviewer_verdict: evidence.reviewer_verdict,
    pass: verdict.pass,
    evidence_hash: hashObject(evidence),
    requirement_hash: evidence.requirement_hash,
    reasons: verdict.reasons,
    timestamp: new Date().toISOString(),
  };

  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(gateLogPath(baseDir, evidence.session_id), line, "utf8");

  return entry;
};

export const validateImmutableRequirementHash = async (
  baseDir: string,
  sessionId: string,
  requirementHash: string,
): Promise<boolean> => {
  const file = gateLogPath(baseDir, sessionId);

  try {
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().length === 0 ? [] : raw.trim().split("\n");

    for (const line of lines) {
      const entry = parseGateLogEntry(JSON.parse(line));
      if (entry.requirement_hash !== requirementHash) {
        return false;
      }
    }

    return true;
  } catch {
    return true;
  }
};
