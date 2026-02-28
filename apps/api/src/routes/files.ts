import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createFileFromStream } from '../service/index.js';
import { ConflictError, NotFoundError } from '../service/index.js';

export async function fileRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool }
): Promise<void> {
  const { pool } = opts;

  fastify.post('/files/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file in request' });
    }
    const field = (name: string) => {
      const f = (data.fields as Record<string, { value: string } | { value: string }[] | undefined>)[name];
      return (Array.isArray(f) ? f[0] : f)?.value;
    };
    const workspaceId = field('workspaceId');
    const parentId = field('parentId') ?? null;
    const mimeType = data.mimetype ?? null;
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId is required' });
    }
    const filename = data.filename || 'unnamed';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createFileFromStream(client, {
        workspaceId,
        parentId,
        filename,
        mimeType,
        stream: data.file,
      });
      await client.query('COMMIT');
      return reply.status(201).send(result);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      throw err;
    } finally {
      client.release();
    }
  });
}
