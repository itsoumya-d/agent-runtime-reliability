/**
 * ECS / Cloud Run compatible container liveness & readiness health probes.
 */

export class HealthProbe {
  constructor(options = {}) {
    this.maxHeapBytes = options.maxHeapBytes || 1024 * 1024 * 1024; // 1 GB default
    this.circuitBreakers = new Map();
  }

  registerCircuitBreaker(name, cb) {
    this.circuitBreakers.set(name, cb);
  }

  /**
   * Liveness probe: responds 200/true if process is alive and responsive.
   */
  checkLiveness() {
    const uptime = process.uptime();
    return {
      status: 'UP',
      uptimeSeconds: Math.floor(uptime),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Readiness probe: checks memory saturation and downstream circuit breaker states.
   */
  checkReadiness() {
    const mem = process.memoryUsage();
    const heapUsed = mem.heapUsed;
    const isMemorySaturated = heapUsed > this.maxHeapBytes;

    const openCircuits = [];
    for (const [name, cb] of this.circuitBreakers.entries()) {
      const stats = cb.getStats();
      if (stats.state === 'OPEN') {
        openCircuits.push(name);
      }
    }

    const ready = !isMemorySaturated && openCircuits.length === 0;

    return {
      status: ready ? 'READY' : 'DEGRADED',
      ready,
      heapUsedMb: Math.round(heapUsed / (1024 * 1024)),
      openCircuits,
      timestamp: new Date().toISOString()
    };
  }
}
