import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { searchNodes } from '../service/index.js';

export async function searchRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool }
): Promise<void> {
  const { pool } = opts;

  fastify.get<{
    Querystring: { workspaceId?: string; q?: string };
  }>('/search', async (request, reply) => {
    const workspaceId = request.query.workspaceId;
    const q = request.query.q ?? '';
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId query is required' });
    }
    const results = await searchNodes(pool, workspaceId, q);
    return reply.send(results);
  });
}
