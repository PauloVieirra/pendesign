import { APP_KEYS, OPEN_DESIGN_SIDECAR_CONTRACT } from "@open-design/sidecar-proto";
import { bootstrapSidecarRuntime } from "@open-design/sidecar";
import { readProcessStamp } from "@open-design/platform";

import { startDaemonSidecar } from "./server.js";
import { loadDotenvFromProjectRoot } from "../cloud/cloud-env-loader.js";

// Auto-load .env.local (and .env) from the working directory before anything
// else so OD_CLOUD_URL / OD_CLOUD_ANON_KEY are present when the cloud module
// reads process.env. No-op when the file is absent. Shell-supplied env wins.
loadDotenvFromProjectRoot(process.cwd());

async function main(): Promise<void> {
  const stamp = readProcessStamp(process.argv.slice(2), OPEN_DESIGN_SIDECAR_CONTRACT);
  if (stamp == null) throw new Error("sidecar stamp is required");

  const runtime = bootstrapSidecarRuntime(stamp, process.env, {
    app: APP_KEYS.DAEMON,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
  });
  const server = await startDaemonSidecar(runtime);

  process.stdout.write(`${JSON.stringify(await server.status(), null, 2)}\n`);
  await server.waitUntilStopped();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
