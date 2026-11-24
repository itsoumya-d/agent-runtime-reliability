# agent-runtime-reliability

> Deterministic SRE reliability guardrails, adaptive circuit breakers, and telemetry monitoring for model-backed agents and Model Context Protocol (MCP) server runtimes.

[![CI](https://github.com/itsoumya-d/agent-runtime-reliability/actions/workflows/ci.yml/badge.svg)](https://github.com/itsoumya-d/agent-runtime-reliability/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview & Architecture

Autonomous agents and MCP server tools encounter real-world distributed systems failures:
- **Upstream LLM Provider Throttling**: HTTP 429 rate limits, network timeouts, and partial stream interruptions.
- **Cascading MCP Tool Failures**: Stalling external subprocesses, runaway loops, and unbudgeted latency spikes.
- **Observability Gaps**: Lack of standardized p50, p95, and p99 SLA percentile metrics and error budgeting across tool calls.

`agent-runtime-reliability` provides a zero-dependency, lightweight Node.js/TypeScript architecture delivering operational resilience, graceful degradation, and Datadog/OpenTelemetry telemetry ingestion.

```
+-------------------------------------------------------------------------+
|                              Agent Runtime                              |
|                                                                         |
|  +--------------------+    +--------------------+    +---------------+  |
|  |   CircuitBreaker   |--->|     McpMonitor     |--->|  HealthProbe  |  |
|  |  (Fowler Machine)  |    | (Telemetry & SLAs) |    | (ECS/K8s/Run) |  |
|  +--------------------+    +--------------------+    +---------------+  |
|            |                         |                       |          |
+------------|-------------------------|-----------------------|----------+
             v                         v                       v
     [Upstream Providers]      [Datadog / OTel]        [Container Health]
     (Claude, OpenAI, MCP)     (p50, p95, error rate)   (/livez, /readyz)
```

---

## Core Components

### 1. Adaptive Circuit Breaker (`CircuitBreaker`)

Implements a state machine (`CLOSED` -> `OPEN` -> `HALF_OPEN`) preventing cascading failures during upstream outages.

```javascript
import { CircuitBreaker, CircuitBreakerError } from 'agent-runtime-reliability';

const breaker = new CircuitBreaker({
  failureThreshold: 3,  // Trip after 3 consecutive failures
  cooldownMs: 10000,    // Wait 10s before probing in HALF_OPEN
  halfOpenLimit: 2,     // 2 consecutive successes to reset to CLOSED
  timeoutMs: 3000       // Timeout execution after 3 seconds
});

// Protected execution with fallback
const result = await breaker.execute(
  async () => await callUpstreamModel(prompt),
  (err) => ({ fallback: true, cachedResponse: "Service temporarily degraded" })
);
```

### 2. MCP Tool Observability & Metrics Interceptor (`McpMonitor`)

Wraps MCP tool calls, records duration in nanoseconds, calculates percentiles, and exports structured Datadog metrics payloads.

```javascript
import { McpMonitor } from 'agent-runtime-reliability';

const monitor = new McpMonitor({ serviceName: 'agent-gateway', environment: 'production' });

// Intercept tool execution
const toolOutput = await monitor.intercept(
  'query_postgres',
  async (args) => await db.query(args.sql),
  { sql: 'SELECT * FROM metrics LIMIT 10' }
);

// Inspect SLA percentiles
const metrics = monitor.getMetrics('query_postgres');
console.log(`p95 latency: ${metrics.p95}ms, Error rate: ${metrics.errorRate * 100}%`);

// Export Datadog-compatible payload
const payload = monitor.exportDatadogPayload();
```

### 3. Containerized Health & Readiness Probes (`HealthProbe`)

Integrates with container orchestrators (AWS ECS task health checks, Kubernetes liveness/readiness probes, Google Cloud Run).

```javascript
import { HealthProbe, CircuitBreaker } from 'agent-runtime-reliability';

const probe = new HealthProbe({ maxHeapBytes: 512 * 1024 * 1024 });
const apiBreaker = new CircuitBreaker();
probe.registerCircuitBreaker('upstream_api', apiBreaker);

// In HTTP health check route:
app.get('/health/live', (req, res) => res.json(probe.checkLiveness()));
app.get('/health/ready', (req, res) => {
  const readiness = probe.checkReadiness();
  res.status(readiness.ready ? 200 : 503).json(readiness);
});
```

---

## Test Suite & Verification

The test suite runs natively on Node.js 20+ with zero third-party dependencies:

```bash
npm test
```

Sample output:
```
✔ CircuitBreaker - starts in CLOSED state and handles successful calls
✔ CircuitBreaker - trips to OPEN after reaching failureThreshold
✔ CircuitBreaker - uses fallback when provided
✔ CircuitBreaker - recovers through HALF_OPEN back to CLOSED
✔ CircuitBreaker - per-call timeout enforcement
✔ HealthProbe - liveness probe returns UP
✔ HealthProbe - readiness probe degrades when registered circuit breaker is OPEN
✔ McpMonitor - tracks successful tool calls and computes latency percentiles
✔ McpMonitor - tracks error rate and error taxonomy
✔ McpMonitor - exports Datadog-compatible metric series
✔ runtime environment initializes
ℹ pass 11, fail 0
```

---

## License

MIT License © [Soumya Debnath](https://github.com/itsoumya-d)
