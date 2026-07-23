import { Hono } from 'hono';

export const api = new Hono();

api.get('/api/health', (c) => c.json({ ok: true }));
