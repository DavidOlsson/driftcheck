import { describe, expect, it } from "vitest";
import { isClaudeCodeInstalled, selectBackend } from "../src/selectBackend.js";
import { ConfigError } from "../src/config/config.js";
import { CommandNotFoundError, CommandTimeoutError } from "../src/io/process.js";
import { FakeCommandRunner } from "./fakes/FakeCommandRunner.js";

const installed = () => new FakeCommandRunner(() => ({ exitCode: 0, stdout: "2.1.252 (Claude Code)", stderr: "" }));
const missing = () => new FakeCommandRunner(() => new CommandNotFoundError("not found"));
const withKey = { ANTHROPIC_API_KEY: "sk-ant-x" };

describe("isClaudeCodeInstalled", () => {
  it("checks claude --version and treats a missing command as not installed", async () => {
    const commands = installed();
    expect(await isClaudeCodeInstalled(commands)).toBe(true);
    expect(commands.calls[0]).toMatchObject({ command: "claude", args: ["--version"] });
    expect(await isClaudeCodeInstalled(missing())).toBe(false);
  });

  it("gives up on a claude command that hangs, with a clear message", async () => {
    const commands = new FakeCommandRunner(() => new CommandTimeoutError("too slow", 30_000));
    await expect(isClaudeCodeInstalled(commands)).rejects.toThrowError(ConfigError);
    await expect(isClaudeCodeInstalled(commands)).rejects.toThrowError(/did not answer within 30 seconds/);
    expect(commands.calls[0]!.options.timeoutMs).toBe(30_000);
  });
});

describe("selectBackend", () => {
  it("auto prefers an API key, then Claude Code", async () => {
    expect(await selectBackend("auto", withKey, installed())).toBe("api");
    expect(await selectBackend("auto", {}, installed())).toBe("claude-code");
  });

  it("auto explains both options when neither is available", async () => {
    await expect(selectBackend("auto", {}, missing())).rejects.toThrowError(/install Claude Code.*or set ANTHROPIC_API_KEY/);
  });

  it("respects an explicit choice and says what is missing", async () => {
    expect(await selectBackend("claude-code", withKey, installed())).toBe("claude-code");
    expect(await selectBackend("api", withKey, missing())).toBe("api");
    await expect(selectBackend("api", {}, installed())).rejects.toThrowError(ConfigError);
    await expect(selectBackend("claude-code", withKey, missing())).rejects.toThrowError(/needs the Claude Code CLI/);
  });
});
