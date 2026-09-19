import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync("pnpm", ["--filter", "@verdant/web", "build"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, VERDANT_STATIC_BUILD: "1" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
