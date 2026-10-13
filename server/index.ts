import { loadConfig } from './config.ts';
import { createZohoServer } from './app.ts';
import { openTokenStore } from './store.ts';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Invalid server configuration.';
  console.error(message);
  process.exit(1);
}

const store = openTokenStore(config.databasePath);
const server = createZohoServer({ config, store });

server.listen(config.port, '127.0.0.1', () => {
  console.info(`[zoho] API listening on http://127.0.0.1:${config.port}`);
});

function shutdown(): void {
  server.close();
  store.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
