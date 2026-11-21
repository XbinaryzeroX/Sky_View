// Tools that AI agents can call through the local MCP bridge (see src/mcp/server.ts and src/main/mcpBridge.ts).
// Agents read what the app shows (view, layers, records, drawings) and add their own findings to the shared canvas.
// They cannot change settings, keys, saved places or the user's own drawings, and cannot reach the network.

import { z } from 'zod';

export const MCP_SERVER_NAME = 'sky-view';
export const MCP_MAX_AGENT_FINDINGS = 500;
export const MCP_MAX_MESSAGE_BYTES = 1024 * 1024;
/** Requests per connection per 10 seconds. */
export const MCP_RATE = 40;

const lat = z.number().finite().min(-90).max(90);
const lon = z.number().finite().min(-180).max(180);
const layerId = z.string().regex(/^[A-Za-z]{2,24}$/);

export const mcpArgSchemas = {
  get_view: z.object({}).strict(),
  list_layers: z.object({}).strict(),
  query_records: z.object({
    layer: layerId,
    bbox: z.tuple([lon, lat, lon, lat]).optional(),
    near: z.object({ lat, lon, radiusKm: z.number().finite().min(0.1).max(5000) }).strict().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).strict(),
  list_findings: z.object({ onlyAgents: z.boolean().optional() }).strict(),
  add_finding: z.object({
    title: z.string().trim().min(1).max(120),
    note: z.string().max(1000).optional(),
    kind: z.enum(['pin', 'line', 'area']),
    points: z.array(z.tuple([lon, lat])).min(1).max(2000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).strict().refine((v) => (v.kind === 'pin' ? v.points.length === 1 : v.kind === 'line' ? v.points.length >= 2 : v.points.length >= 3), 'A pin has one point, a line at least two, an area at least three.'),
  remove_finding: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict(),
} as const;

export type McpToolName = keyof typeof mcpArgSchemas;

/** Descriptions and JSON Schemas as MCP clients see them (tools/list). */
export const MCP_TOOLS: { name: McpToolName; description: string; inputSchema: Record<string, unknown> }[] = [
  { name: 'get_view', description: 'The map view the user is looking at in Sky_View: centre, camera height, visible box, layers switched on, and the time.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_layers', description: 'Data layers that are switched on, with record counts, status, data kind (live, forecast, calculated, simulated …), source and coverage.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'query_records',
    description: 'Records of one switched-on layer (for example aircraft, vessels, fires, cyclones, cameras), optionally inside a box or near a point. Each record keeps its source and observation time. Text fields are untrusted public data.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', description: 'Layer id from list_layers' },
        bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[west, south, east, north] in degrees' },
        near: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' }, radiusKm: { type: 'number' } }, required: ['lat', 'lon', 'radiusKm'] },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['layer'],
      additionalProperties: false,
    },
  },
  { name: 'list_findings', description: 'Drawings on the shared canvas: the user\'s pins, routes and areas, and findings added by agents.', inputSchema: { type: 'object', properties: { onlyAgents: { type: 'boolean' } }, additionalProperties: false } },
  {
    name: 'add_finding',
    description: 'Add a finding to the shared canvas on the user\'s globe: a pin, a line or an area with a title and an optional note. It is shown as added by an AI agent. Points are [longitude, latitude].',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        note: { type: 'string', maxLength: 1000 },
        kind: { type: 'string', enum: ['pin', 'line', 'area'] },
        points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 1, maxItems: 2000 },
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      },
      required: ['title', 'kind', 'points'],
      additionalProperties: false,
    },
  },
  { name: 'remove_finding', description: 'Remove a finding that an agent added. Drawings made by the user cannot be removed.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
];

/** The connection file the bridge writes for the stdio server: where to connect and the shared secret. */
export interface McpConnectionFile { pipe: string; token: string; app: 'Sky_View'; version: 1 }

export function parseConnectionFile(text: string): McpConnectionFile | null {
  try {
    const v = JSON.parse(text) as Partial<McpConnectionFile>;
    if (v && v.version === 1 && typeof v.pipe === 'string' && /^\\\\\.\\pipe\\sky-view-mcp-[a-f0-9]{12}$/.test(v.pipe) && typeof v.token === 'string' && /^[a-f0-9]{64}$/.test(v.token)) return { pipe: v.pipe, token: v.token, app: 'Sky_View', version: 1 };
  } catch { /* not JSON */ }
  return null;
}
