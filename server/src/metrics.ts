import client from 'prom-client';

/**
 * Prometheus metrics. Scrape GET /metrics.
 * These are the numbers you quote on your resume and in interviews.
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const wsConnections = new client.Gauge({
  name: 'ws_connections_active',
  help: 'Open WebSocket connections on this instance',
  registers: [registry],
});

export const activeRooms = new client.Gauge({
  name: 'collab_rooms_active',
  help: 'Documents currently loaded in memory on this instance',
  registers: [registry],
});

export const wsMessages = new client.Counter({
  name: 'ws_messages_total',
  help: 'WebSocket messages received, by type',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const redisMessages = new client.Counter({
  name: 'redis_bridge_messages_total',
  help: 'Messages exchanged with other instances through Redis',
  labelNames: ['direction', 'kind'] as const,
  registers: [registry],
});

export const persistDuration = new client.Histogram({
  name: 'doc_persist_duration_seconds',
  help: 'Time to write a document snapshot to Postgres',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [registry],
});

export const codeRuns = new client.Counter({
  name: 'code_runs_total',
  help: 'Code executions requested, by language and outcome',
  labelNames: ['language', 'outcome'] as const,
  registers: [registry],
});
