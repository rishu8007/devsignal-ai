import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("../services/api/", import.meta.url));
const excluded = new Set([
  "mongodb.integration.test.ts",
  "github-connection.integration.test.ts",
]);

async function testFiles(directory) {
  const entries = await readdir(join(apiRoot, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(apiRoot, directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await testFiles(path));
    } else if (entry.isFile() && /\.test\.ts$/.test(entry.name) && !excluded.has(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const files = (await Promise.all(["test", "tests"].map((directory) => testFiles(directory)))).flat();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
    cwd: apiRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
