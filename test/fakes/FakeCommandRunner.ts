import type { CommandOptions, CommandResult, CommandRunner } from "../../src/io/process.js";

export interface RecordedCommand {
  command: string;
  args: string[];
  options: CommandOptions;
}

/** Records invocations and returns canned results; never spawns a process. */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: RecordedCommand[] = [];

  constructor(private readonly respond: (call: RecordedCommand) => CommandResult | Error) {}

  async run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    const call = { command, args, options };
    this.calls.push(call);
    const result = this.respond(call);
    if (result instanceof Error) throw result;
    return result;
  }
}

export const cliSuccess = (structuredOutput: unknown, costUsd = 0.12): CommandResult => ({
  exitCode: 0,
  stderr: "",
  stdout: JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    structured_output: structuredOutput,
    total_cost_usd: costUsd,
    usage: { input_tokens: 2000, output_tokens: 300 },
  }),
});
