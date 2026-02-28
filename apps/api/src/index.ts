import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createPool } from '@grandcharter/db';
import { healthRoutes } from './routes/health.js';
import { folderRoutes } from './routes/folders.js';
import { fileRoutes } from './routes/files.js';
import { nodeRoutes } from './routes/nodes.js';
import { searchRoutes } from './routes/search.js';
import { workspaceRoutes } from './routes/workspaces.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(multipart, { limits: { fileSize: 256 * 1024 * 1024 } });

await fastify.register(healthRoutes, { prefix: '/api' });

const pool = createPool();
await fastify.register(folderRoutes, { prefix: '/api', pool });
await fastify.register(fileRoutes, { prefix: '/api', pool });
await fastify.register(nodeRoutes, { prefix: '/api', pool });
await fastify.register(searchRoutes, { prefix: '/api', pool });
await fastify.register(workspaceRoutes, { prefix: '/api/workspaces', pool });

const port = Number(process.env.PORT) || 3001;
await fastify.listen({ port, host: '0.0.0.0' });
