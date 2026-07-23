import { api } from './http/routes';

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  fetch: api.fetch,
});

console.log(`pichamber server on http://localhost:${server.port}`);
