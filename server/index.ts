import { loadConfig } from './config.ts';
import { loadGoogleConfig } from './google-config.ts';
import { loadMicrosoftConfig } from './microsoft-config.ts';
import { createZohoServer } from './app.ts';
import { openConfiguredStore } from './open-store.ts';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Invalid server configuration.';
  console.error(message);
  process.exit(1);
}

const store = await openConfiguredStore(config);
const server = createZohoServer({
  config,
  store,
  googleConfig: loadGoogleConfig(process.env, config.production),
  microsoftConfig: loadMicrosoftConfig(process.env, config.production),
});

server.listen(config.port, '127.0.0.1', () => {
  console.info(`[zoho] API listening on http://127.0.0.1:${config.port}`);
});

function shutdown(): void {
  server.close();
  store.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
