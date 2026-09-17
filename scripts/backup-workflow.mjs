import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const MANIFEST_FILE = "backup-manifest.json";
export const INCOMPLETE_MANIFEST_FILE = "backup-manifest.incomplete.json";

export function safeProjectName(value, { restore = false } = {}) {
  if (!/^[a-z][a-z0-9_-]{2,48}$/.test(value)) {
    throw new Error("Project name must contain 3-49 lowercase letters, digits, underscores, or hyphens.");
  }
  if (restore && !value.startsWith("restore-test-")) {
    throw new Error("Restore project must start with restore-test-.");
  }
  return value;
}

export function parseArgs(argv) {
  const options = { composeFiles: [], dryRun: false, execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--execute") {
      options.execute = true;
      continue;
    }
    if (argument === "--writes-paused") {
      options.writespaused = true;
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[++index];
    if (key === "compose-file") {
      options.composeFiles.push(value);
      options.composeFile = value;
    }
    else if (key === "env-path") options.envFile = value;
    else options[key.replaceAll("-", "")] = value;
  }
  return options;
}

export function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required option --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
  }
  return value;
}

export function composeArgs({ project, composeFiles, envFile }, command) {
  const args = ["compose", "-p", safeProjectName(project)];
  for (const file of composeFiles) args.push("-f", file);
  if (envFile) args.push("--env-file", envFile);
  return [...args, ...command];
}

export function mongoDumpCommand(options) {
  const shellCommand =
    'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" ' +
    "--authenticationDatabase admin --db devsignal --archive";
  return {
    command: "docker",
    args: composeArgs(options, ["exec", "-T", "mongo", "sh", "-c", shellCommand]),
    log: "docker compose ... exec -T mongo mongodump --username \"$MONGO_INITDB_ROOT_USERNAME\" --password [redacted] ...",
  };
}

export function qdrantSnapshotCommand({ project, outputDirectory, collection, helperPath }) {
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      `${safeProjectName(project)}_default`,
      "-v",
      `${resolve(outputDirectory)}:/backup:rw`,
      "-v",
      `${resolve(helperPath)}:/qdrant-snapshot.mjs:ro`,
      "node:22-bookworm-slim",
      "node",
      "/qdrant-snapshot.mjs",
      "--collection",
      collection,
      "--output",
      "/backup/qdrant-collection.snapshot",
    ],
    log: "docker run --rm --network <project>_default node:22-bookworm-slim qdrant snapshot helper",
  };
}

export function mongoRestoreCommand(options) {
  const shellCommand =
    'mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" ' +
    "--authenticationDatabase admin --archive --stopOnError";
  return {
    command: "docker",
    args: composeArgs(options, ["exec", "-T", "mongo", "sh", "-c", shellCommand]),
    log: "docker compose ... exec -T mongo mongorestore --username \"$MONGO_INITDB_ROOT_USERNAME\" --password [redacted] --archive --stopOnError",
  };
}

export function qdrantRestoreCommand({ project, backupDirectory, collection, helperPath }) {
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--network",
      `${safeProjectName(project)}_default`,
      "-v",
      `${resolve(backupDirectory)}:/backup:ro`,
      "-v",
      `${resolve(helperPath)}:/qdrant-restore.mjs:ro`,
      "node:22-bookworm-slim",
      "node",
      "/qdrant-restore.mjs",
      "--collection",
      collection,
      "--input",
      "/backup/qdrant-collection.snapshot",
    ],
    log: "docker run --rm --network <restore-project>_default node:22-bookworm-slim qdrant restore helper",
  };
}

export async function sha256File(filePath) {
  const digest = createHash("sha256");
  digest.update(await readFile(filePath));
  return digest.digest("hex");
}

function artifactPath(backupDirectory, filename) {
  if (typeof filename !== "string" || filename.length === 0 || isAbsolute(filename)) {
    throw new Error(`Unsafe artifact filename: ${String(filename)}`);
  }
  const root = resolve(backupDirectory);
  const candidate = resolve(root, filename);
  if (relative(root, candidate).startsWith("..") || basename(candidate) !== filename) {
    throw new Error(`Unsafe artifact filename: ${filename}`);
  }
  return candidate;
}

export async function validateManifest(manifest, backupDirectory) {
  if (!manifest || manifest.formatVersion !== 1 || manifest.status !== "complete") {
    throw new Error("Backup manifest is not a complete supported manifest.");
  }
  if (
    manifest.database?.name !== "devsignal" ||
    manifest.database?.service !== "mongo" ||
    typeof manifest.qdrant?.collection !== "string" ||
    manifest.qdrant.collection.length === 0
  ) {
    throw new Error("Backup manifest database metadata is invalid.");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 2) {
    throw new Error("Backup manifest must contain MongoDB and Qdrant artifacts.");
  }
  const kinds = new Set(manifest.artifacts.map((artifact) => artifact.kind));
  if (!kinds.has("mongodb-dump") || !kinds.has("qdrant-collection-snapshot") || kinds.size !== 2) {
    throw new Error("Backup manifest must contain one MongoDB dump and one Qdrant snapshot.");
  }
  for (const artifact of manifest.artifacts) {
    const filePath = artifactPath(backupDirectory, artifact.filename);
    const details = await stat(filePath);
    if (!Number.isSafeInteger(artifact.sizeBytes) || details.size !== artifact.sizeBytes) {
      throw new Error(`Backup artifact size mismatch: ${artifact.filename}`);
    }
    if (artifact.sha256 !== await sha256File(filePath)) {
      throw new Error(`Backup artifact checksum mismatch: ${artifact.filename}`);
    }
  }
  return manifest;
}

export { artifactPath };
