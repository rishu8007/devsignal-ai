import { cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const appRoot = process.cwd();
const standaloneRoot = join(appRoot, ".next", "standalone", "apps", "web");
const standaloneNext = join(standaloneRoot, ".next");

await cp(join(appRoot, "public"), join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});
await cp(join(appRoot, ".next", "static"), join(standaloneNext, "static"), {
  recursive: true,
  force: true,
});

const child = spawn(
  process.execPath,
  [join(standaloneRoot, "server.js")],
  {
    cwd: standaloneRoot,
    env: process.env,
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
