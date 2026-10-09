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
  /** Stops the process and fails with CommandTimeoutError after this long. No limit when left out. */
  timeoutMs?: number;
}

/** Runs an external program. Behind an interface so the Claude Code backend can be tested without spawning anything. */
export interface CommandRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}

export class CommandNotFoundError extends Error {
  override name = "CommandNotFoundError";
}

export class CommandTimeoutError extends Error {
  override name = "CommandTimeoutError";

  constructor(
    message: string,
    readonly timeoutMs: number,
  ) {
    super(message);
  }
}

/** How long a timed-out process gets to exit after SIGTERM before it is killed outright. */
const DEFAULT_KILL_GRACE_MS = 5000;

/** How a closed stdin shows up: EPIPE on macOS and Linux, ECONNRESET or EOF on some platforms. */
const BROKEN_PIPE_CODES = new Set(["EPIPE", "ECONNRESET", "EOF"]);

export class NodeCommandRunner implements CommandRunner {
  constructor(private readonly killGraceMs = DEFAULT_KILL_GRACE_MS) {}

  run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      // No shell: arguments are passed as-is, so prompts and schemas can never be interpreted as shell syntax
      const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timeoutTimer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
              killTimer = setTimeout(() => child.kill("SIGKILL"), this.killGraceMs);
            }, options.timeoutMs);
      const clearTimers = () => {
        clearTimeout(timeoutTimer);
        clearTimeout(killTimer);
      };

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimers();
        reject(e.code === "ENOENT" ? new CommandNotFoundError(`"${command}" was not found on PATH`) : e);
      });
      // Settle only once the process is gone, so a timed-out process is never left running behind us
      child.on("close", (code) => {
        clearTimers();
        if (timedOut) {
          reject(new CommandTimeoutError(`"${command}" did not finish within ${options.timeoutMs} ms and was stopped`, options.timeoutMs!));
        } else {
          resolve({ exitCode: code ?? 1, stdout, stderr });
        }
      });
      // A process that exits without reading all its input breaks the pipe. That is not the failure to report:
      // its exit code and stderr say why it exited. Without a listener, the error would crash the whole CLI.
      child.stdin.on("error", (e: NodeJS.ErrnoException) => {
        if (!BROKEN_PIPE_CODES.has(e.code ?? "")) {
          clearTimers();
          child.kill("SIGKILL");
          reject(e);
        }
      });
      child.stdin.end(options.input ?? "");
    });
  }
}
