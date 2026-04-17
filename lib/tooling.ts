import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const OMC_BINARIES = ["/usr/local/bin/omc", "/opt/homebrew/bin/omc"];

export const ECC_ALLOWLIST = [
  "oh-my-claudecode:deep-interview",
  "oh-my-claudecode:plan",
  "oh-my-claudecode:autopilot",
  "oh-my-claudecode:project-session-manager",
  "oh-my-claudecode:verify",
  "oh-my-claudecode:ultraqa",
  "code-review",
  "security-review",
] as const;

export type ToolInstallPolicy = {
  autoUpdateSafe: boolean;
};

export type DriftSignals = {
  requiredSkillsPresent: boolean;
  deprecatedAliasesUsed: boolean;
  stateSchemaMatches: boolean;
  hookContractMatches: boolean;
};

export type VersionCheckResult = {
  pluginVersion: string;
  cliVersion: string;
  instructionVersion: string;
  driftDetected: boolean;
  driftScenarios: string[];
};

export const validateAllowlist = (tools: string[]): { ok: boolean; blocked: string[] } => {
  const set = new Set<string>(ECC_ALLOWLIST);
  const blocked = tools.filter((tool) => !set.has(tool));
  return { ok: blocked.length === 0, blocked };
};

export const resolveVersionConflict = (
  currentVersion: string,
  targetVersion: string,
  policy: ToolInstallPolicy,
): "skip" | "update" | "confirm" => {
  if (currentVersion === targetVersion) return "skip";

  const [curMajor, curMinor] = currentVersion.split(".").map((v) => Number(v));
  const [targetMajor, targetMinor] = targetVersion.split(".").map((v) => Number(v));

  if (Number.isNaN(curMajor) || Number.isNaN(targetMajor)) return "confirm";

  if (curMajor !== targetMajor) return "confirm";
  if (!policy.autoUpdateSafe) return "confirm";
  if (curMinor <= targetMinor) return "update";

  return "skip";
};

export const detectVersionDrift = (
  pluginVersion: string,
  cliVersion: string,
  instructionVersion: string,
  signals: DriftSignals,
): VersionCheckResult => {
  const driftScenarios: string[] = [];

  if (pluginVersion !== cliVersion) driftScenarios.push("plugin_vs_cli_version_mismatch");
  if (pluginVersion !== instructionVersion) driftScenarios.push("plugin_vs_instruction_version_mismatch");
  if (!signals.requiredSkillsPresent) driftScenarios.push("required_skill_missing");
  if (signals.deprecatedAliasesUsed) driftScenarios.push("deprecated_alias_in_use");
  if (!signals.stateSchemaMatches) driftScenarios.push("state_schema_mismatch");
  if (!signals.hookContractMatches) driftScenarios.push("hook_contract_mismatch");
  if (driftScenarios.length > 0) driftScenarios.push("pipeline_guard_triggered");

  const driftDetected = driftScenarios.length > 0;
  return { pluginVersion, cliVersion, instructionVersion, driftDetected, driftScenarios };
};

const pickOmcBinary = (): string => OMC_BINARIES[0];

export const runOmcUpdate = async (): Promise<{ success: boolean; output: string }> => {
  const binary = pickOmcBinary();

  try {
    const { stdout, stderr } = await execFileAsync(binary, ["update"]);
    return { success: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "omc update failed";
    return { success: false, output: message };
  }
};

export const installAllowlistedTools = async (
  requestedTools: string[],
): Promise<{ installed: string[]; blocked: string[] }> => {
  const { ok, blocked } = validateAllowlist(requestedTools);
  if (!ok) {
    return { installed: [], blocked };
  }

  return { installed: requestedTools, blocked: [] };
};
