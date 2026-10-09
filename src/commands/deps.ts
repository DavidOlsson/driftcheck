import type { AgentRunner } from "../extract/AgentRunner.js";
import type { LlmClient } from "../llm/LlmClient.js";
import type { Backend } from "../model/backend.js";

/** Everything a command that calls Claude needs, passed in so tests can use fakes and a fixed clock. */
export interface ClaudeDeps {
  backend: Backend;
  runner: AgentRunner;
  llm: LlmClient;
  now: () => Date;
  log: (message: string) => void;
}
