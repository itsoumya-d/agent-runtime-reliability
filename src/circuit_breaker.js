/**
 * Adaptive Circuit Breaker for agentic LLM calls and upstream MCP services.
 * Implements standard Fowler State Machine (CLOSED -> OPEN -> HALF_OPEN).
 */

export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
});

export class CircuitBreakerError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.state = state;
  }
}

export class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.failureThreshold=5] - Consecutive failures before opening
   * @param {number} [options.cooldownMs=10000] - Duration to stay OPEN before HALF_OPEN probe
   * @param {number} [options.halfOpenLimit=2] - Successful probe calls needed in HALF_OPEN to close
   * @param {number} [options.timeoutMs=5000] - Per-call execution timeout in milliseconds
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 10000;
    this.halfOpenLimit = options.halfOpenLimit || 2;
    this.timeoutMs = options.timeoutMs || 5000;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.consecutiveFailures = 0;
    this.successCount = 0;
    this.halfOpenSuccesses = 0;
    this.totalCalls = 0;
    this.trips = 0;
    this.lastStateChange = Date.now();
    this.lastFailureTime = null;
  }

  /**
   * Executes an asynchronous task protected by the circuit breaker.
   * @template T
   * @param {() => Promise<T>} fn
   * @param {((err: Error) => Promise<T>|T)} [fallback]
   * @returns {Promise<T>}
   */
  async execute(fn, fallback = null) {
    this._evaluateState();

    if (this.state === CircuitState.OPEN) {
      if (typeof fallback === 'function') {
        return fallback(new CircuitBreakerError('Circuit is OPEN', this.state));
      }
      throw new CircuitBreakerError('Circuit is OPEN: upstream calls throttled', this.state);
    }

    this.totalCalls++;
    const startTime = Date.now();

    try {
      const result = await this._runWithTimeout(fn);
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      if (typeof fallback === 'function') {
        return fallback(err);
      }
      throw err;
    }
  }

  /**
   * Check if circuit should transition from OPEN to HALF_OPEN after cooldown
   */
  _evaluateState() {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.cooldownMs) {
        this._transitionTo(CircuitState.HALF_OPEN);
        this.halfOpenSuccesses = 0;
      }
    }
  }

  _runWithTimeout(fn) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;

      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`Operation timed out after ${this.timeoutMs}ms`));
          }
        }, this.timeoutMs);
      }

      Promise.resolve()
        .then(() => fn())
        .then((res) => {
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(res);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            reject(err);
          }
        });
    });
  }

  _onSuccess() {
    this.successCount++;
    this.consecutiveFailures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenLimit) {
        this._transitionTo(CircuitState.CLOSED);
        this.failureCount = 0;
      }
    }
  }

  _onFailure(err) {
    this.failureCount++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this._transitionTo(CircuitState.OPEN);
      this.trips++;
    } else if (this.state === CircuitState.CLOSED && this.consecutiveFailures >= this.failureThreshold) {
      this._transitionTo(CircuitState.OPEN);
      this.trips++;
    }
  }

  _transitionTo(newState) {
    this.state = newState;
    this.lastStateChange = Date.now();
  }

  getStats() {
    this._evaluateState();
    return {
      state: this.state,
      totalCalls: this.totalCalls,
      successCount: this.successCount,
      failureCount: this.failureCount,
      consecutiveFailures: this.consecutiveFailures,
      trips: this.trips,
      uptimeSeconds: Math.floor((Date.now() - this.lastStateChange) / 1000)
    };
  }
}
