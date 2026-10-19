/** Decides how long to wait (ms) before reconnect attempt number `attempt` (starting at 1). */
export interface ReconnectPolicy {
  delayFor(attempt: number): number;
}

export const ReconnectPolicies = {
  /** Same delay every time. */
  fixed(delayMs: number): ReconnectPolicy {
    return { delayFor: () => delayMs };
  },

  /**
   * Exponential backoff with jitter: `initial * factor^(attempt-1)`, capped at
   * `max`, randomised by up to ±`jitter` (0..1) to avoid reconnect storms.
   */
  exponential(
    options: { initial?: number; max?: number; factor?: number; jitter?: number; random?: () => number } = {},
  ): ReconnectPolicy {
    const { initial = 1000, max = 30_000, factor = 2, jitter = 0.3, random = Math.random } = options;
    return {
      delayFor(attempt) {
        const capped = Math.min(initial * Math.pow(factor, attempt - 1), max);
        const spread = (random() * 2 - 1) * jitter;
        return Math.round(capped * (1 + spread));
      },
    };
  },
};
