import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  INCOMPLETE_MANIFEST_FILE,
  MANIFEST_FILE,
  mongoDumpCommand,
  qdrantRestoreCommand,
  qdrantSnapshotCommand,
  safeProjectName,
  validateManifest,
} from "./backup-workflow.mjs";
import { createBackup } from "./backup.mjs";
import { targetIsUnused } from "./restore.mjs";

const execFileAsync = promisify(execFile);

async function manifestFor(directory, status = "complete") {
  const artifacts = [];
  for (const [kind, filename] of [
    ["mongodb-dump", "mongodb.archive"],
    ["qdrant-collection-snapshot", "qdrant-collection.snapshot"],
  ]) {
    const content = Buffer.from(filename);
    await writeFile(join(directory, filename), content);
    artifacts.push({
      kind,
      filename,
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return {
    formatVersion: 1,
    createdAtUtc: new Date().toISOString(),
    commit: null,
    status,
    database: { name: "devsignal", service: "mongo", image: "mongo:8.0" },
    qdrant: { collection: "devsignal_knowledge_chunks", service: "qdrant", image: "qdrant/qdrant:v1.19.1" },
    artifacts,
  };
}

test("validates manifest checksums and rejects checksum changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devsignal-backup-"));
  try {
    const manifest = await manifestFor(directory);
    await validateManifest(manifest, directory);
    await writeFile(join(directory, "mongodb.archive"), "changed archive");
    await assert.rejects(validateManifest(manifest, directory), /checksum mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects incomplete manifests and unsafe artifact paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devsignal-backup-"));
  try {
    await assert.rejects(validateManifest(await manifestFor(directory, "incomplete"), directory), /complete/);
    const manifest = await manifestFor(directory);
    manifest.artifacts[0].filename = "../outside.archive";
    await assert.rejects(validateManifest(manifest, directory), /Unsafe artifact filename/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unsafe restore target names", () => {
  assert.throws(() => safeProjectName("devsignal-https", { restore: true }), /restore-test/);
  assert.throws(() => safeProjectName("../restore-test-x", { restore: true }), /Project name/);
  assert.equal(safeProjectName("restore-test-20260917", { restore: true }), "restore-test-20260917");
});

test("rejects restore targets with existing containers or volumes", async () => {
  const runner = async (_command, args) =>
    args.includes("ps")
      ? { stdout: Buffer.from("existing-container\n") }
      : { stdout: Buffer.alloc(0) };
  assert.equal(await targetIsUnused("restore-test-existing", runner), false);
});

test("dry-run prints redacted plans without creating the output directory", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "devsignal-dry-run-")), "planned");
  try {
    const result = await execFileAsync(process.execPath, [
      "scripts/backup.mjs",
      "--project", "devsignal-https",
      "--compose-file", "docker-compose.deploy.yml",
      "--env-path", ".env.deploy",
      "--output", directory,
      "--collection", "devsignal_knowledge_chunks",
      "--dry-run",
    ]);
    assert.match(result.stdout, /redacted/);
    assert.doesNotMatch(result.stdout, /secret|dummy|OPENAI|MONGO_ROOT/i);
    await assert.rejects(stat(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restore dry-run validates artifacts without invoking Docker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devsignal-restore-dry-run-"));
  try {
    const manifest = await manifestFor(directory);
    await writeFile(join(directory, "backup-manifest.json"), JSON.stringify(manifest));
    const result = await execFileAsync(process.execPath, [
      "scripts/restore.mjs",
      "--project", "restore-test-20260917",
      "--compose-file", "docker-compose.restore.yml",
      "--manifest", join(directory, "backup-manifest.json"),
    ]);
    assert.match(result.stdout, /Dry run only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial backup writes only an incomplete manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "devsignal-partial-"));
  const output = join(directory, "backup");
  try {
    await assert.rejects(createBackup({
      project: "devsignal-https",
      composeFile: "docker-compose.deploy.yml",
      envFile: ".env.deploy",
      output,
      collection: "devsignal_knowledge_chunks",
      writespaused: true,
    }, async (_command, args) => {
      if (args.includes("git")) return { stdout: Buffer.from("test\n") };
      if (args.includes("exec")) return { stdout: Buffer.from("mongo archive") };
      throw new Error("qdrant unavailable");
    }), /qdrant unavailable/);
    await stat(join(output, INCOMPLETE_MANIFEST_FILE));
    await assert.rejects(stat(join(output, MANIFEST_FILE)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("command construction keeps credentials out of process arguments and logs", () => {
  const mongo = mongoDumpCommand({
    project: "devsignal-https",
    composeFiles: ["docker-compose.deploy.yml"],
    envFile: ".env.deploy",
  });
  assert.equal(mongo.args.includes("secret"), false);
  assert.match(mongo.log, /redacted/);
  const qdrant = qdrantSnapshotCommand({
    project: "devsignal-https",
    outputDirectory: "backups/test",
    collection: "devsignal_knowledge_chunks",
    helperPath: "scripts/qdrant-snapshot.mjs",
  });
  assert.equal(qdrant.args.includes("secret"), false);
  const restore = qdrantRestoreCommand({
    project: "restore-test-20260917",
    backupDirectory: "backups/test",
    collection: "devsignal_knowledge_chunks",
    helperPath: "scripts/qdrant-restore.mjs",
  });
  assert.equal(restore.copy.args.includes("secret"), false);
  assert.equal(restore.args.includes("--location"), true);
});
