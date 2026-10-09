import { describe, expect, it } from "vitest";
import { CommandNotFoundError, CommandTimeoutError, NodeCommandRunner } from "../src/io/process.js";

// Real child processes, but only short Node scripts: nothing here calls Claude
const node = process.execPath;
const script = (code: string) => ["-e", code];

describe("NodeCommandRunner", () => {
  const runner = new NodeCommandRunner(200);

  it("passes input on stdin and collects stdout, stderr and the exit code", async () => {
    const result = await runner.run(node, script("process.stdin.pipe(process.stdout); console.error('note'); process.exitCode = 3"), {
      input: "hello",
    });
    expect(result).toEqual({ exitCode: 3, stdout: "hello", stderr: "note\n" });
  });

  it("reports a missing command as CommandNotFoundError", async () => {
    await expect(runner.run("driftcheck-no-such-command", [])).rejects.toThrowError(CommandNotFoundError);
  });

  it("does not crash when the process exits without reading its input, and reports the exit instead", async () => {
    // Far more than a pipe buffer holds, so writing it fails with a broken pipe
    const input = "x".repeat(16 * 1024 * 1024);
    const result = await runner.run(node, script("console.error('not logged in'); process.exit(1)"), { input });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not logged in");
  });

  it("stops a process that runs past its timeout", async () => {
    const started = Date.now();
    const error = await runner.run(node, script("setInterval(() => {}, 1000)"), { timeoutMs: 100 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandTimeoutError);
    expect((error as CommandTimeoutError).timeoutMs).toBe(100);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("kills a process that ignores SIGTERM after the grace period", async () => {
    const stubborn = script("process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)");
    await expect(runner.run(node, stubborn, { timeoutMs: 300 })).rejects.toThrowError(CommandTimeoutError);
  });

  it("leaves a process without a timeout alone", async () => {
    const result = await runner.run(node, script("setTimeout(() => console.log('done'), 150)"));
    expect(result.stdout).toBe("done\n");
  });
});
