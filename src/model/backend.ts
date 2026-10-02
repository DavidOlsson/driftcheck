/** Kept free of imports so config, report and selection code can all depend on it without cycles. */
export const BACKENDS = ["auto", "api", "claude-code"] as const;
export type BackendChoice = (typeof BACKENDS)[number];
export type Backend = Exclude<BackendChoice, "auto">;

export const BACKEND_DESCRIPTIONS: Record<Backend, string> = {
  api: "Anthropic API (ANTHROPIC_API_KEY)",
  "claude-code": "Claude Code CLI (your Claude subscription)",
};
