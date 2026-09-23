import { readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mongoRestoreCommand,
  workflowMongoRestoreCommand,
  parseArgs,
  qdrantRestoreCommand,
  requireOption,
  safeProjectName,
  validateManifest,
  composeArgs,
} from "./backup-workflow.mjs";

async function run(command, args, { input } = {}) {
  const child = execFile(command, args, {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (input) child.stdin.end(input);
  return new Promise((resolveResult, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = Buffer.concat([stdout, Buffer.from(chunk)]); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveResult({ stdout, stderr }) : reject(new Error(`${command} exited with ${code}`)));
  });
}

export async function targetIsUnused(project, runner = run) {
  const containers = await runner("docker", [
    "ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`,
  ]);
  const volumes = await runner("docker", [
    "volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`,
  ]);
  return containers.stdout.toString().trim() === "" && volumes.stdout.toString().trim() === "";
}

function printPlan(options, manifestPath, backupDirectory) {
  console.log(JSON.stringify({
    operation: "isolated-restore",
    project: options.project,
    backupDirectory,
    manifest: manifestPath,
    actions: [
      "validate manifest artifact filenames, sizes, and SHA-256 checksums",
      "verify restore-test target has no existing containers or volumes",
      "create fresh private MongoDB and Qdrant services",
      "restore MongoDB archive and Qdrant collection snapshot",
      "restore workflow checkpoint archive when present",
    ],
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const project = safeProjectName(requireOption(options, "project"), { restore: true });
  const manifestPath = resolve(requireOption(options, "manifest"));
  const composeFile = requireOption(options, "composeFile");
  if (basename(composeFile) !== "docker-compose.restore.yml") {
    throw new Error("Restore requires the isolated docker-compose.restore.yml configuration.");
  }
  const backupDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateManifest(manifest, backupDirectory);
  printPlan({ ...options, project }, manifestPath, backupDirectory);
  if (!options.execute) {
    console.log("Dry run only. Pass --execute to create the isolated restore environment.");
    return;
  }
  if (!(await targetIsUnused(project))) {
    throw new Error("Restore target already has containers or volumes; refusing to continue.");
  }
  const restoreOptions = { project, composeFiles: [composeFile] };
  const temporaryEnv = join(backupDirectory, `.restore-${process.pid}.env`);
  const restorePassword = `restore_${process.pid}_${Date.now()}_protected`;
  await writeFile(temporaryEnv, `MONGO_ROOT_USERNAME=restore_admin\nMONGO_ROOT_PASSWORD=${restorePassword}\n`, { mode: 0o600 });
  try {
    const compose = composeArgs(restoreOptions, [
      "--env-file",
      temporaryEnv,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "120",
    ]);
    await run("docker", compose);
    const mongoArtifact = manifest.artifacts.find((artifact) => artifact.kind === "mongodb-dump");
    const workflowArtifact = manifest.artifacts.find((artifact) => artifact.kind === "workflow-mongodb-dump");
    const qdrantArtifact = manifest.artifacts.find((artifact) => artifact.kind === "qdrant-collection-snapshot");
    const mongo = mongoRestoreCommand({ ...restoreOptions, envFile: temporaryEnv });
    console.log(mongo.log);
    await run(mongo.command, mongo.args, {
      input: await readFile(join(backupDirectory, mongoArtifact.filename)),
    });
    if (workflowArtifact) {
      const workflowMongo = workflowMongoRestoreCommand({
        ...restoreOptions,
        envFile: temporaryEnv,
        workflowDatabase: manifest.workflowDatabase.name,
      });
      console.log(workflowMongo.log);
      await run(workflowMongo.command, workflowMongo.args, {
        input: await readFile(join(backupDirectory, workflowArtifact.filename)),
      });
    }
    const qdrant = qdrantRestoreCommand({
      project,
      backupDirectory,
      collection: manifest.qdrant.collection,
      helperPath: resolve("scripts/qdrant-restore.mjs"),
    });
    console.log(qdrant.log);
    await run(qdrant.copy.command, qdrant.copy.args);
    await run(qdrant.command, qdrant.args);
    console.log("Restore completed. Services remain running for read-only verification.");
  } finally {
    await rm(temporaryEnv, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
