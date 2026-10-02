import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  /** Written to the process's stdin, then stdin is closed. */
  input?: string;
  env?: NodeJS.ProcessEnv;
}

/** Runs an external program. Behind an interface so the Claude Code backend can be tested without spawning anything. */
export interface CommandRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}

export class CommandNotFoundError extends Error {
  override name = "CommandNotFoundError";
}

export class NodeCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // No shell: arguments are passed as-is, so prompts and schemas can never be interpreted as shell syntax
      const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (e: NodeJS.ErrnoException) =>
        reject(e.code === "ENOENT" ? new CommandNotFoundError(`"${command}" was not found on PATH`) : e),
      );
      child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
      child.stdin.end(options.input ?? "");
    });
  }
}
