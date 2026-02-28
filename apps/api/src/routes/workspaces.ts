import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { listChildren } from '../service/index.js';

export async function workspaceRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool }
): Promise<void> {
  const { pool } = opts;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  fastify.get<{
    Params: { workspaceId: string };
    Querystring: { parentId?: string };
  }>('/:workspaceId/nodes', async (request, reply) => {
    const { workspaceId } = request.params;
    if (!uuidRe.test(workspaceId)) {
      return reply.status(400).send({ error: 'Invalid workspaceId' });
    }
    const rawParent = request.query.parentId;
    const parentId = rawParent === undefined || rawParent === '' ? null : rawParent;
    if (parentId !== null && !uuidRe.test(parentId)) {
      return reply.status(400).send({ error: 'Invalid parentId' });
    }
    const children = await listChildren(pool, workspaceId, parentId);
    return reply.send(children);
  });
}
