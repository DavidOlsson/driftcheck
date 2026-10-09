import { realpath } from "node:fs/promises";
import path from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { isWithin } from "../io/paths.js";

/**
 * With the SDK, tools in `allowedTools` may reach any path on the machine; there is no equivalent of
 * Claude Code's `--restricted`. The analyzed repository can try to talk the agent into reading files
 * such as ~/.aws/credentials, so every Read, Grep and Glob call is checked against the platform root.
 */

const GLOB_CHARS = /[*?[\]{}]/;

/** Fails closed: anything that cannot be shown to stay inside the root is refused. */
async function pathProblem(root: string, value: string): Promise<string | null> {
  if (value.startsWith("~")) return `"${value}" refers to a home directory`;
  const resolved = path.resolve(root, value);
  if (!isWithin(root, resolved)) return `"${value}" is outside ${root}`;
  try {
    // A symlink inside the repository could still point outside it
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolved)]);
    if (!isWithin(realRoot, realTarget)) return `"${value}" resolves to ${realTarget}, outside ${root}`;
  } catch (e) {
    // Nothing to read there, so nothing can leak; the tool reports the missing path itself
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return `"${value}" could not be checked`;
  }
  return null;
}

async function patternProblem(root: string, pattern: string): Promise<string | null> {
  if (pattern.startsWith("~")) return `"${pattern}" refers to a home directory`;
  // Also catches ".." produced by brace expansion, e.g. "{..,src}/x"; real code search never needs it
  if (pattern.includes("..")) return `"${pattern}" leaves the platform root`;
  if (!path.isAbsolute(pattern)) return null;
  // The part before the first wildcard is where the search starts
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((s) => GLOB_CHARS.test(s));
  const staticPrefix = (firstGlob === -1 ? segments : segments.slice(0, firstGlob)).join("/") || "/";
  return pathProblem(root, staticPrefix);
}

const str = (input: Record<string, unknown>, key: string): string | undefined =>
  typeof input[key] === "string" ? (input[key] as string) : undefined;

/** Why a tool call would reach outside `root`, or null when it stays inside. */
export async function outsideRootProblem(root: string, toolName: string, input: unknown): Promise<string | null> {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const checks: Promise<string | null>[] = [];
  const checkPath = (value: string | undefined) => value !== undefined && checks.push(pathProblem(root, value));
  const checkPattern = (value: string | undefined) => value !== undefined && checks.push(patternProblem(root, value));
  switch (toolName) {
    case "Read": {
      const file = str(fields, "file_path");
      if (file === undefined) return "Read needs a file_path";
      checkPath(file);
      break;
    }
    case "Grep":
      checkPath(str(fields, "path"));
      checkPattern(str(fields, "glob"));
      break;
    case "Glob":
      checkPath(str(fields, "path"));
      checkPattern(str(fields, "pattern"));
      break;
    default:
      return `${toolName} is not one of the read-only tools`;
  }
  return (await Promise.all(checks)).find((p) => p !== null) ?? null;
}

/** PreToolUse hook that refuses any tool call reaching outside `root`. */
export function confineToRoot(root: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const problem = await outsideRootProblem(root, input.tool_name, input.tool_input);
    if (problem === null) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Only files inside the platform root may be read: ${problem}.`,
      },
    };
  };
}
