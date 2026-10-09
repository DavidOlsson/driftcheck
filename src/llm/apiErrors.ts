import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "../extract/AgentRunner.js";

/**
 * Turns an Anthropic SDK error into an AgentError that says what to do next. The SDK has already
 * retried rate limits and server errors by the time one reaches us. Anything that is not an API error
 * is a bug and is returned unchanged, so it keeps its stack trace.
 */
export function fromApiError(error: unknown, task: string, model: string): unknown {
  if (!(error instanceof Anthropic.APIError)) return error;
  const fail = (advice: string) => new AgentError(`The ${task} failed: ${advice}`, undefined, { cause: error });
  if (error instanceof Anthropic.APIConnectionError) {
    return fail(`could not reach the Anthropic API (${error.message}). Check your network or proxy and try again.`);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return fail(
      "ANTHROPIC_API_KEY was rejected. Check the key at https://console.anthropic.com, or unset it to use Claude Code instead.",
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return fail(`the API key is not allowed to use ${model}. Check the key's workspace and permissions.`);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return fail(`model "${model}" was not found. Check --model or "model" in .driftcheck/config.yml.`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return fail("the API rate limit was reached. Wait a minute and try again, or raise the limit for your organization.");
  }
  // 529 means overloaded; it has no SDK class of its own
  if (error.status !== undefined && error.status >= 500) {
    return fail(`the Anthropic API is overloaded or unavailable (status ${error.status}). Try again in a few minutes.`);
  }
  return fail(`the Anthropic API returned an error (status ${error.status ?? "unknown"}): ${apiMessage(error)}`);
}

/** The API's own explanation, e.g. "prompt is too long", instead of the SDK's JSON dump of the response body. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === "string" ? body.error.message : error.message;
}
