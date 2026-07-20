import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.ADMIN_TOKEN;
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!expected || !token || !tokensMatch(token, expected)) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
}
