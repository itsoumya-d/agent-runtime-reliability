/**
 * Telemetry and SLA latency tracker for MCP tool executions and Agent actions.
 * Computes p50, p95, p99 percentiles and error budgets for Datadog / OpenTelemetry ingestion.
 */

export class McpMonitor {
  constructor(options = {}) {
    this.serviceName = options.serviceName || 'agent-runtime';
    this.environment = options.environment || process.env.NODE_ENV || 'production';
    this.records = [];
    this.maxRecords = options.maxRecords || 5000;
  }

  /**
   * Intercept and measure a tool call execution.
   */
  async intercept(toolName, fn, args = {}, metadata = {}) {
    const start = process.hrtime.bigint();
    const timestamp = new Date().toISOString();
    let status = 'success';
    let errorType = null;
    let result = null;

    try {
      result = await fn(args);
      return result;
    } catch (err) {
      status = 'error';
      errorType = err.name || 'Error';
      throw err;
    } finally {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;

      this._record({
        toolName,
        status,
        durationMs,
        errorType,
        timestamp,
        metadata
      });
    }
  }

  _record(entry) {
    this.records.push(entry);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  /**
   * Calculates percentile latency (p50, p95, p99) and SLA metrics.
   */
  getMetrics(toolName = null) {
    const filtered = toolName
      ? this.records.filter((r) => r.toolName === toolName)
      : this.records;

    if (filtered.length === 0) {
      return {
        totalCalls: 0,
        errors: 0,
        errorRate: 0,
        p50: 0,
        p95: 0,
        p99: 0
      };
    }

    const durations = filtered.map((r) => r.durationMs).sort((a, b) => a - b);
    const errors = filtered.filter((r) => r.status === 'error').length;
    const errorRate = Number((errors / filtered.length).toFixed(4));

    const p50 = this._percentile(durations, 0.50);
    const p95 = this._percentile(durations, 0.95);
    const p99 = this._percentile(durations, 0.99);

    return {
      totalCalls: filtered.length,
      errors,
      errorRate,
      p50: Number(p50.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(p99.toFixed(2))
    };
  }

  _percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const index = (sortedArr.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (lower === upper) return sortedArr[lower];
    return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
  }

  /**
   * Emits structured Datadog / OpenTelemetry-compatible metrics format.
   */
  exportDatadogPayload() {
    const metrics = this.getMetrics();
    const series = [
      {
        metric: `${this.serviceName}.mcp.tool_calls.total`,
        points: [[Math.floor(Date.now() / 1000), metrics.totalCalls]],
        type: 'count',
        tags: [`env:${this.environment}`, `service:${this.serviceName}`]
      },
      {
        metric: `${this.serviceName}.mcp.error_rate`,
        points: [[Math.floor(Date.now() / 1000), metrics.errorRate]],
        type: 'gauge',
        tags: [`env:${this.environment}`, `service:${this.serviceName}`]
      },
      {
        metric: `${this.serviceName}.mcp.latency.p95`,
        points: [[Math.floor(Date.now() / 1000), metrics.p95]],
        type: 'gauge',
        tags: [`env:${this.environment}`, `service:${this.serviceName}`]
      }
    ];

    return { series };
  }
}
