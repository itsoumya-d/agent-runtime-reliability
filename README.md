# agent-runtime-reliability

> Reliability guardrails, circuit breakers, and telemetry for model-backed agents and Model Context Protocol (MCP) servers.

## Problem

Model-backed agents, autonomous workflows, and MCP server integrations frequently encounter cascading upstream degradation:
- Provider rate limits (HTTP 429) and network timeouts
- Stalling tool execution during MCP interactions
- Uncontrolled token burn during recursive failure loops
- Lack of standardized SRE observability (p95/p99 SLA tracking, error budgeting, saturation detection)

`agent-runtime-reliability` delivers a deterministic, lightweight reliability layer with zero external runtime dependencies.

## Architecture & Features

1. **Adaptive Circuit Breaker (`CircuitBreaker`)**:
   - States: `CLOSED`, `OPEN`, `HALF_OPEN`
   - Configurable consecutive failure thresholds, half-open probe limits, and reset cooldowns
   - Sliding error rate and latency budget tracking

2. **MCP Tool Observability & Interceptor (`McpMonitor`)**:
   - Tool execution wrapper capturing duration, status, and failure taxonomy
   - OpenTelemetry and Datadog-compatible structured telemetry emitter
   - Tool-specific timeout enforcement and fallback handlers

3. **Runtime Saturation & Health Prober (`HealthProbe`)**:
   - Container liveness and readiness probes compatible with ECS and Cloud Run
   - Event loop delay and heap memory threshold monitoring

## Getting Started

### Installation & Testing

```bash
# Run unit test suite
npm test
```

## License

MIT © Soumya Debnath
