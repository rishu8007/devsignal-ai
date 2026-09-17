import { mkdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INCOMPLETE_MANIFEST_FILE,
  MANIFEST_FILE,
  mongoDumpCommand,
  parseArgs,
  qdrantSnapshotCommand,
  requireOption,
  sha256File,
} from "./backup-workflow.mjs";

async function run(command, args, { input } = {}) {
  const child = execFile(command, args, {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (input) child.stdin.end(input);
  const result = await new Promise((resolveResult, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = Buffer.concat([stdout, Buffer.from(chunk)]); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveResult({ stdout, stderr }) : reject(new Error(`${command} exited with ${code}`)));
  });
  return result;
}

async function gitCommit() {
  try {
    const result = await run("git", ["rev-parse", "--short", "HEAD"]);
    return result.stdout.toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

export async function createBackup(options, runner = run) {
  const project = requireOption(options, "project");
  const outputDirectory = resolve(requireOption(options, "output"));
  const collection = requireOption(options, "collection");
  const composeFile = requireOption(options, "composeFile");
  requireOption(options, "envFile");
  options.composeFiles = [composeFile];
  const mongoImage = options.mongoImage ?? "mongo:8.0";
  const qdrantImage = options.qdrantImage ?? "qdrant/qdrant:v1.19.1";
  if (options.dryRun) {
    console.log(JSON.stringify({
      operation: "backup",
      project,
      outputDirectory,
      collection,
      commands: [mongoDumpCommand(options).log, qdrantSnapshotCommand({
        project,
        outputDirectory,
        collection,
        helperPath: resolve("scripts/qdrant-snapshot.mjs"),
      }).log],
    }, null, 2));
    return;
  }
  if (!options.writespaused) {
    throw new Error("Refusing backup: pass --writes-paused after stopping application writes.");
  }
  try {
    await mkdir(outputDirectory, { recursive: false });
  } catch {
    throw new Error("Backup output directory must not already exist.");
  }

  const incompletePath = join(outputDirectory, INCOMPLETE_MANIFEST_FILE);
  const baseManifest = {
    formatVersion: 1,
    createdAtUtc: new Date().toISOString(),
    commit: await gitCommit(),
    project,
    database: { name: "devsignal", service: "mongo", image: mongoImage },
    qdrant: { collection, service: "qdrant", image: qdrantImage },
    artifacts: [],
  };
  try {
    const mongo = mongoDumpCommand(options);
    console.log(mongo.log);
    const mongoResult = await runner(mongo.command, mongo.args);
    const mongoFile = join(outputDirectory, "mongodb.archive");
    await writeFile(mongoFile, mongoResult.stdout);
    baseManifest.artifacts.push({
      kind: "mongodb-dump",
      filename: "mongodb.archive",
      sizeBytes: mongoResult.stdout.length,
      sha256: await sha256File(mongoFile),
    });

    const qdrant = qdrantSnapshotCommand({
      project,
      outputDirectory,
      collection,
      helperPath: resolve("scripts/qdrant-snapshot.mjs"),
    });
    console.log(qdrant.log);
    await runner(qdrant.command, qdrant.args);
    const qdrantFile = join(outputDirectory, "qdrant-collection.snapshot");
    const qdrantStats = await stat(qdrantFile);
    baseManifest.artifacts.push({
      kind: "qdrant-collection-snapshot",
      filename: "qdrant-collection.snapshot",
      sizeBytes: qdrantStats.size,
      sha256: await sha256File(qdrantFile),
    });
    await writeFile(join(outputDirectory, MANIFEST_FILE), JSON.stringify({
      ...baseManifest,
      status: "complete",
    }, null, 2));
  } catch (error) {
    await writeFile(incompletePath, JSON.stringify({
      ...baseManifest,
      status: "incomplete",
      error: "backup operation failed; inspect the preserved artifacts and command output",
    }, null, 2));
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) {
    const project = requireOption(options, "project");
    const outputDirectory = resolve(requireOption(options, "output"));
    const collection = requireOption(options, "collection");
    const composeFile = requireOption(options, "composeFile");
    requireOption(options, "envFile");
    options.composeFiles = [composeFile];
    console.log(JSON.stringify({
      operation: "backup",
      project,
      outputDirectory,
      collection,
      commands: [mongoDumpCommand(options).log, qdrantSnapshotCommand({
        project,
        outputDirectory,
        collection,
        helperPath: resolve("scripts/qdrant-snapshot.mjs"),
      }).log],
    }, null, 2));
    return;
  }
  await createBackup(options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
