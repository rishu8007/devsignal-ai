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
  workflowMongoDumpCommand,
  composeArgs,
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

const writerServices = ["api", "ai", "linkedin-scheduler", "github-sync"];

async function activeWriters(options, runner) {
  const result = await runner("docker", composeArgs(options, ["ps", "--services", "--status", "running"]));
  return result.stdout.toString("utf8").split(/\r?\n/).filter((service) => writerServices.includes(service));
}

async function stopWriters(options, running, runner) {
  if (running.length > 0) {
    await runner("docker", composeArgs(options, ["stop", ...running]));
  }
}

async function resumeWriters(options, running, runner) {
  if (running.length > 0) {
    await runner("docker", composeArgs(options, ["start", ...running]));
  }
}

export async function createBackup(options, runner = run) {
  const project = requireOption(options, "project");
  const outputDirectory = resolve(requireOption(options, "output"));
  const collection = requireOption(options, "collection");
  const composeFile = requireOption(options, "composeFile");
  const envFile = requireOption(options, "envFile");
  options.envFile = envFile;
  options.workflowDatabase = options.workflowDatabase ?? "devsignal_workflows";
  options.composeFiles = [composeFile];
  const mongoImage = options.mongoImage ?? "mongo:8.0";
  const qdrantImage = options.qdrantImage ?? "qdrant/qdrant:v1.19.1";
  if (options.dryRun) {
    console.log(JSON.stringify({
      operation: "backup",
      project,
      outputDirectory,
      collection,
      commands: [
        "pause running API, AI, LinkedIn scheduler, and GitHub sync writers",
        mongoDumpCommand(options).log,
        workflowMongoDumpCommand(options).log,
        qdrantSnapshotCommand({
        project,
        outputDirectory,
        collection,
        helperPath: resolve("scripts/qdrant-snapshot.mjs"),
        }).log,
      ],
    }, null, 2));
    return;
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
    workflowDatabase: { name: options.workflowDatabase, service: "mongo", image: mongoImage },
    qdrant: { collection, service: "qdrant", image: qdrantImage },
    artifacts: [],
  };
  let pausedWriters = [];
  try {
    pausedWriters = await activeWriters(options, runner);
    await stopWriters(options, pausedWriters, runner);
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

    const workflowMongo = workflowMongoDumpCommand(options);
    console.log(workflowMongo.log);
    const workflowResult = await runner(workflowMongo.command, workflowMongo.args);
    const workflowFile = join(outputDirectory, "workflow-mongodb.archive");
    await writeFile(workflowFile, workflowResult.stdout);
    baseManifest.artifacts.push({
      kind: "workflow-mongodb-dump",
      database: workflowMongo.database,
      filename: "workflow-mongodb.archive",
      sizeBytes: workflowResult.stdout.length,
      sha256: await sha256File(workflowFile),
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
  } finally {
    await resumeWriters(options, pausedWriters, runner);
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
    options.workflowDatabase = options.workflowDatabase ?? "devsignal_workflows";
    options.composeFiles = [composeFile];
    console.log(JSON.stringify({
      operation: "backup",
      project,
      outputDirectory,
      collection,
      commands: [
        "pause running API, AI, LinkedIn scheduler, and GitHub sync writers",
        mongoDumpCommand(options).log,
        workflowMongoDumpCommand(options).log,
        qdrantSnapshotCommand({
          project,
          outputDirectory,
          collection,
          helperPath: resolve("scripts/qdrant-snapshot.mjs"),
        }).log,
      ],
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
