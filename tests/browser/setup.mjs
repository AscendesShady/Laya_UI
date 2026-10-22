import { createApp } from '../../server.mjs';
import { once } from 'node:events';
export default async function setup() {
  const server = createApp();
  server.listen(3211, '127.0.0.1');
  await once(server, 'listening');
  return async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
}
