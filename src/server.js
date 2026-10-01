import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ config });

try {
  await app.listen({ host: "0.0.0.0", port: config.port });
} catch (error) {
  app.log.error({ code: error.code ?? "STARTUP_FAILED" }, "Service startup failed");
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}