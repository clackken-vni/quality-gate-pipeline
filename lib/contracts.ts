import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { assertBaseDir, assertSessionId, hashObject } from "./evidence.js";

export type RequirementContract = {
  schema_version: "1.0";
  requirement_hash: string;
  user_goals: string[];
  acceptance_criteria: string[];
  constraints: string[];
  non_goals: string[];
  created_at: string;
};

export type TestContract = {
  schema_version: "1.0";
  requirement_hash: string;
  tool_plan: string[];
  evaluator_command: string;
  smoke_strategy: string;
  coverage_target: number;
  created_at: string;
};

const contractDir = (baseDir: string, sessionId: string): string => {
  assertBaseDir(baseDir);
  assertSessionId(sessionId);
  return path.join(baseDir, sessionId, "contracts");
};

const contractPath = (baseDir: string, sessionId: string, name: "requirement" | "test"): string =>
  path.join(contractDir(baseDir, sessionId), `${name}-contract.json`);

const EVALUATOR_COMMAND_REGEX = /^[a-zA-Z0-9:_./\-\s]+$/;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const parseRequirementContract = (value: unknown): RequirementContract => {
  if (!value || typeof value !== "object") {
    throw new Error("invalid requirement contract payload");
  }

  const x = value as RequirementContract;

  if (x.schema_version !== "1.0") throw new Error("invalid requirement schema version");
  if (typeof x.requirement_hash !== "string") throw new Error("missing requirement hash");
  if (!isStringArray(x.user_goals)) throw new Error("invalid user_goals");
  if (!isStringArray(x.acceptance_criteria)) throw new Error("invalid acceptance_criteria");
  if (!isStringArray(x.constraints)) throw new Error("invalid constraints");
  if (!isStringArray(x.non_goals)) throw new Error("invalid non_goals");
  if (typeof x.created_at !== "string") throw new Error("invalid created_at");

  return x;
};

export const parseTestContract = (value: unknown): TestContract => {
  if (!value || typeof value !== "object") {
    throw new Error("invalid test contract payload");
  }

  const x = value as TestContract;

  if (x.schema_version !== "1.0") throw new Error("invalid test schema version");
  if (typeof x.requirement_hash !== "string") throw new Error("missing requirement hash");
  if (!isStringArray(x.tool_plan)) throw new Error("invalid tool_plan");
  if (typeof x.evaluator_command !== "string") throw new Error("invalid evaluator_command");
  if (!EVALUATOR_COMMAND_REGEX.test(x.evaluator_command)) {
    throw new Error("unsafe evaluator_command");
  }
  if (typeof x.smoke_strategy !== "string") throw new Error("invalid smoke_strategy");
  if (typeof x.coverage_target !== "number") throw new Error("invalid coverage_target");
  if (typeof x.created_at !== "string") throw new Error("invalid created_at");

  return x;
};

export const createRequirementContract = (
  input: Omit<RequirementContract, "schema_version" | "requirement_hash" | "created_at">,
): RequirementContract => {
  const payload = {
    schema_version: "1.0" as const,
    user_goals: input.user_goals,
    acceptance_criteria: input.acceptance_criteria,
    constraints: input.constraints,
    non_goals: input.non_goals,
    created_at: new Date().toISOString(),
  };

  const requirement_hash = hashObject(payload);
  return { ...payload, requirement_hash };
};

export const saveRequirementContract = async (
  baseDir: string,
  sessionId: string,
  contract: RequirementContract,
): Promise<string> => {
  const parsed = parseRequirementContract(contract);
  const dir = contractDir(baseDir, sessionId);
  await mkdir(dir, { recursive: true });
  const filePath = contractPath(baseDir, sessionId, "requirement");
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
};

export const loadRequirementContract = async (
  baseDir: string,
  sessionId: string,
): Promise<RequirementContract | null> => {
  try {
    const raw = await readFile(contractPath(baseDir, sessionId, "requirement"), "utf8");
    return parseRequirementContract(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const createTestContract = (
  input: Omit<TestContract, "schema_version" | "created_at">,
): TestContract => ({
  ...input,
  schema_version: "1.0",
  created_at: new Date().toISOString(),
});

export const saveTestContract = async (
  baseDir: string,
  sessionId: string,
  contract: TestContract,
): Promise<string> => {
  const parsed = parseTestContract(contract);
  const dir = contractDir(baseDir, sessionId);
  await mkdir(dir, { recursive: true });
  const filePath = contractPath(baseDir, sessionId, "test");
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
};

export const loadTestContract = async (
  baseDir: string,
  sessionId: string,
): Promise<TestContract | null> => {
  try {
    const raw = await readFile(contractPath(baseDir, sessionId, "test"), "utf8");
    return parseTestContract(JSON.parse(raw));
  } catch {
    return null;
  }
};
