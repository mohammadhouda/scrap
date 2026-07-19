import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.ADMIN_TOKEN;
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!expected || !token || token !== expected) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
