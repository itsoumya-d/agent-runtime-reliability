import test from 'node:test';
import assert from 'node:assert/strict';
import { McpMonitor } from '../src/mcp_monitor.js';

test('McpMonitor - tracks successful tool calls and computes latency percentiles', async () => {
  const monitor = new McpMonitor({ serviceName: 'test-agent' });

  // Simulate 10 tool calls with varying latencies
  for (let i = 1; i <= 10; i++) {
    await monitor.intercept('query_database', async () => {
      await new Promise((r) => setTimeout(r, i * 5));
      return { rows: i };
    });
  }

  const metrics = monitor.getMetrics('query_database');
  assert.equal(metrics.totalCalls, 10);
  assert.equal(metrics.errors, 0);
  assert.equal(metrics.errorRate, 0);
  assert.ok(metrics.p50 > 0);
  assert.ok(metrics.p95 >= metrics.p50);
});

test('McpMonitor - tracks error rate and error taxonomy', async () => {
  const monitor = new McpMonitor();

  await monitor.intercept('fetch_weather', async () => 'sunny');
  await assert.rejects(
    async () => monitor.intercept('fetch_weather', async () => { throw new TypeError('Network err'); })
  );

  const metrics = monitor.getMetrics('fetch_weather');
  assert.equal(metrics.totalCalls, 2);
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.errorRate, 0.5);
});

test('McpMonitor - exports Datadog-compatible metric series', async () => {
  const monitor = new McpMonitor({ serviceName: 'brand-agent', environment: 'production' });

  await monitor.intercept('vector_search', async () => [1, 2, 3]);
  const payload = monitor.exportDatadogPayload();

  assert.ok(Array.isArray(payload.series));
  assert.equal(payload.series.length, 3);
  assert.equal(payload.series[0].metric, 'brand-agent.mcp.tool_calls.total');
  assert.ok(payload.series[0].tags.includes('env:production'));
});
