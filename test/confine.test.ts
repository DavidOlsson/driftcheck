import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { confineToRoot, outsideRootProblem } from "../src/extract/confine.js";

let outside: string;
let root: string;

beforeEach(async () => {
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "driftcheck-confine-")));
  root = path.join(outside, "android");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "Search.kt"), "val limit = 20\n");
  await writeFile(path.join(outside, "secret.txt"), "token\n");
});

describe("outsideRootProblem", () => {
  it("allows reading and searching inside the platform root, with relative or absolute paths", async () => {
    expect(await outsideRootProblem(root, "Read", { file_path: path.join(root, "src", "Search.kt") })).toBeNull();
    expect(await outsideRootProblem(root, "Read", { file_path: "src/Missing.kt" })).toBeNull();
    expect(await outsideRootProblem(root, "Grep", { pattern: "limit", path: "src", glob: "**/*.kt" })).toBeNull();
    expect(await outsideRootProblem(root, "Grep", { pattern: "limit" })).toBeNull();
    expect(await outsideRootProblem(root, "Glob", { pattern: "**/*.kt" })).toBeNull();
    expect(await outsideRootProblem(root, "Glob", { pattern: `${root}/src/**/*.kt` })).toBeNull();
  });

  it("refuses paths outside the root, in the home directory or through ..", async () => {
    expect(await outsideRootProblem(root, "Read", { file_path: path.join(outside, "secret.txt") })).toMatch(/outside/);
    expect(await outsideRootProblem(root, "Read", { file_path: "../secret.txt" })).toMatch(/outside/);
    expect(await outsideRootProblem(root, "Read", { file_path: "~/.aws/credentials" })).toMatch(/home directory/);
    expect(await outsideRootProblem(root, "Grep", { pattern: "token", path: outside })).toMatch(/outside/);
    expect(await outsideRootProblem(root, "Grep", { pattern: "token", glob: "../*.txt" })).toMatch(/leaves/);
    expect(await outsideRootProblem(root, "Glob", { pattern: "{..,src}/*.txt" })).toMatch(/leaves/);
    expect(await outsideRootProblem(root, "Glob", { pattern: `${outside}/*.txt` })).toMatch(/outside/);
    expect(await outsideRootProblem(root, "Glob", { pattern: "*", path: "/" })).toMatch(/outside/);
  });

  it("refuses a symlink inside the root that points outside it", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    await symlink(outside, path.join(root, "linkdir"));
    expect(await outsideRootProblem(root, "Read", { file_path: "link.txt" })).toMatch(/resolves to/);
    expect(await outsideRootProblem(root, "Grep", { pattern: "token", path: "linkdir" })).toMatch(/resolves to/);
  });

  it("refuses other tools and malformed input", async () => {
    expect(await outsideRootProblem(root, "Bash", { command: "cat /etc/passwd" })).toMatch(/not one of the read-only tools/);
    expect(await outsideRootProblem(root, "Read", {})).toMatch(/file_path/);
  });
});

describe("confineToRoot", () => {
  const call = (toolName: string, toolInput: unknown) =>
    confineToRoot(root)(
      { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: root } as HookInput,
      "t",
      { signal: new AbortController().signal },
    );

  it("denies a tool call outside the root with a reason, and leaves others to the normal permissions", async () => {
    expect(await call("Read", { file_path: path.join(outside, "secret.txt") })).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(/outside/) },
    });
    expect(await call("Read", { file_path: "src/Search.kt" })).toEqual({});
  });
});
