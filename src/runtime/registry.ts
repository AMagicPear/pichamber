import { RpcClient } from "./rpc-client";

const clients = new Map<string, RpcClient>();

export function getRuntime(id: string): RpcClient {
  let client = clients.get(id);
  if (!client) { client = new RpcClient(id); clients.set(id, client); }
  return client;
}

export async function closeRuntime(id: string): Promise<void> {
  const client = clients.get(id);
  if (!client) return;
  await client.stop();
  clients.delete(id);
}