// ─── Rate Limiter ────────────────────────────────────────────────────────────
// Simple token-bucket rate limiter for API calls.
// Respects provider limits (Google Places, Hunter.io, Render).

const limiters = {};

/**
 * Create or get a rate limiter for a given API.
 * @param {string} name - Identifier for the API (e.g. "hunter", "google_places")
 * @param {number} minIntervalMs - Minimum milliseconds between calls
 * @returns {{ wait, remaining, reset }}
 */
export function getRateLimiter(name, minIntervalMs) {
  if (!limiters[name]) {
    limiters[name] = {
      lastCall: 0,
      minInterval: minIntervalMs,
      queue: [],
    };
  }

  const limiter = limiters[name];

  return {
    /**
     * Wait for the rate limit to allow the next call.
     * Returns a promise that resolves when it's safe to proceed.
     */
    async wait() {
      const now = Date.now();
      const elapsed = now - limiter.lastCall;

      if (elapsed < limiter.minInterval) {
        const delay = limiter.minInterval - elapsed;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      limiter.lastCall = Date.now();
    },

    /**
     * Check how many calls remain in the current window (if applicable).
     */
    remaining() {
      return "unlimited"; // Simple limiter doesn't track quotas
    },

    /**
     * Reset the limiter state.
     */
    reset() {
      limiter.lastCall = 0;
    },
  };
}

/**
 * Throttle an async function to respect rate limits.
 * @param {string} name - Rate limiter name
 * @param {number} minIntervalMs - Minimum ms between calls
 * @param {Function} fn - Async function to throttle
 * @returns {Function} Throttled version of fn
 */
export function throttle(name, minIntervalMs, fn) {
  const limiter = getRateLimiter(name, minIntervalMs);

  return async (...args) => {
    await limiter.wait();
    return fn(...args);
  };
}

/**
 * Batch process items with rate limiting.
 * Processes items sequentially with delay between API calls.
 * @param {Array} items - Items to process
 * @param {string} name - Rate limiter name
 * @param {number} minIntervalMs - Minimum ms between calls
 * @param {Function} fn - Async function to call per item
 * @returns {Array} Results
 */
export async function batchProcess(items, name, minIntervalMs, fn) {
  const limiter = getRateLimiter(name, minIntervalMs);
  const results = [];

  for (const item of items) {
    await limiter.wait();
    try {
      const result = await fn(item);
      results.push(result);
    } catch (err) {
      results.push({ error: err.message, item });
    }
  }

  return results;
}
