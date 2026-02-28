import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { openBlobReadStream } from '../storage/index.js';
import { listChildren, renameNode, moveNode, getFileForDownload } from '../service/index.js';
import { ConflictError, InvalidMoveError, NotDownloadableError, NotFoundError } from '../service/index.js';

export async function nodeRoutes(
  fastify: FastifyInstance,
  opts: { pool: Pool }
): Promise<void> {
  const { pool } = opts;

  fastify.get<{
    Params: { id: string };
    Querystring: { workspaceId?: string };
  }>('/nodes/:id/download', async (request, reply) => {
    const { id } = request.params;
    const workspaceId = request.query.workspaceId;
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId query is required' });
    }
    try {
      const { node, storagePath } = await getFileForDownload(pool, workspaceId, id);
      const contentType = node.mime_type || 'application/octet-stream';
      const disposition = `attachment; filename="${node.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      reply.header('Content-Type', contentType).header('Content-Disposition', disposition);
      return reply.send(openBlobReadStream(storagePath));
    } catch (err) {
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      if (err instanceof NotDownloadableError) return reply.status(400).send({ error: err.message });
      throw err;
    }
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { workspaceId?: string };
  }>('/nodes/:id/children', async (request, reply) => {
    const { id } = request.params;
    const workspaceId = request.query.workspaceId;
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId query is required' });
    }
    const children = await listChildren(pool, workspaceId, id);
    return reply.send(children);
  });

  fastify.patch<{
    Params: { id: string };
    Body: { workspaceId: string; newName: string };
  }>('/nodes/:id/rename', async (request, reply) => {
    const { id } = request.params;
    const { workspaceId, newName } = request.body ?? {};
    if (!workspaceId || newName === undefined) {
      return reply.status(400).send({ error: 'workspaceId and newName are required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const node = await renameNode(client, { workspaceId, nodeId: id, newName });
      await client.query('COMMIT');
      return reply.send(node);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.post<{
    Params: { id: string };
    Body: { workspaceId: string; newParentId?: string | null };
  }>('/nodes/:id/move', async (request, reply) => {
    const { id } = request.params;
    const body = request.body ?? {};
    const { workspaceId, newParentId } = body;
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId is required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const node = await moveNode(client, {
        workspaceId,
        nodeId: id,
        newParentId: newParentId === undefined ? null : newParentId,
      });
      await client.query('COMMIT');
      return reply.send(node);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
      if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
      if (err instanceof InvalidMoveError) return reply.status(400).send({ error: err.message });
      throw err;
    } finally {
      client.release();
    }
  });
}
