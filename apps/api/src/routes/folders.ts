import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createFolder, ConflictError, NotFoundError } from '../service/index.js';

export async function folderRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool }
): Promise<void> {
  const { pool } = opts;

  fastify.post<{
    Body: { workspaceId: string; parentId?: string | null; name: string };
  }>('/folders', async (request, reply) => {
    const { workspaceId, parentId, name } = request.body;
    if (!workspaceId || name === undefined) {
      return reply.status(400).send({ error: 'workspaceId and name are required' });
    }
    try {
      const node = await createFolder(pool, {
        workspaceId,
        parentId: parentId ?? null,
        name,
      });
      return reply.status(201).send(node);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      throw err;
    }
  });
}
