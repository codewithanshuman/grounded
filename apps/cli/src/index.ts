import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

function run(name: string, cwd: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(command, args, {
    cwd, stdio: "inherit", shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`[Grounded] ${name} exited with code ${code}`);
  });
  return child;
}

console.log("[Grounded] booting server on :8787 and web on :5173 \u2014 press Ctrl+C to stop both\n");

const server = run("server", resolve(REPO_ROOT, "apps/server"), "npx", ["tsx", "watch", "src/index.ts"], {
  VERDANT_DB_PATH: resolve(REPO_ROOT, "verdant-forest.db"),
  NODE_OPTIONS: "--experimental-sqlite",
});

const web = run("web", resolve(REPO_ROOT, "apps/web"), "npx", ["vite"]);

const shutdown = () => {
  console.log("\n[Grounded] shutting down\u2026");
  server.kill();
  web.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
