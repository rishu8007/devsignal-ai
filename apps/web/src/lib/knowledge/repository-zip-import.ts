import {
  BlobReader,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";

export const REPOSITORY_ZIP_LIMITS = {
  maxArchiveBytes: 5 * 1024 * 1024,
  maxEntries: 500,
  maxFiles: 50,
  maxFileBytes: 100 * 1024,
  maxTotalBytes: 1024 * 1024,
} as const;

export const KNOWLEDGE_TITLE_LIMITS = { min: 1, max: 120 } as const;
export const KNOWLEDGE_CONTENT_LIMITS = { min: 10, max: 20_000 } as const;

export interface RepositoryDocument {
  path: string;
  text: string;
}

export interface RepositoryZipInspection {
  archiveName: string;
  files: RepositoryDocument[];
  skipped: Array<{ path: string; reason: string }>;
}

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".venv",
]);

function normalizePath(filename: string): string {
  if (
    filename.includes("\0") ||
    filename.includes("\\") ||
    filename.startsWith("/") ||
    /^[a-z]:/i.test(filename)
  ) {
    throw new Error(`Unsafe archive path: ${filename}`);
  }
  const parts = filename.split("/");
  if (parts.some((part) => part === ".." || part === "." || part.length === 0)) {
    throw new Error(`Unsafe archive path: ${filename}`);
  }
  return parts.join("/");
}

function isHiddenOrExcluded(pathParts: string[]): boolean {
  return pathParts.some(
    (part) => part.startsWith(".") || EXCLUDED_DIRECTORIES.has(part.toLowerCase()),
  );
}

function isCredentialFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.includes("credentials") ||
    lower.includes("secret") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    lower === "id_rsa" ||
    lower === "id_ed25519" ||
    lower.endsWith(".ppk")
  );
}

function isRegularFile(entry: Entry): entry is FileEntry {
  if (entry.directory || entry.symlink) return false;
  const type = entry.unixMode === undefined ? 0 : entry.unixMode & 0o170000;
  return type === 0 || type === 0o100000;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
  }
}

export function assembleRepositoryDocuments(documents: RepositoryDocument[]): string {
  return documents
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, text }) => `## ${path}\n\n${text}`)
    .join("\n\n");
}

export function deriveRepositoryTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.zip$/i, "");
  return withoutExtension.trim().slice(0, KNOWLEDGE_TITLE_LIMITS.max);
}

export function validateRepositoryNote(title: string, content: string): string | null {
  const titleLength = title.trim().length;
  if (titleLength < KNOWLEDGE_TITLE_LIMITS.min || titleLength > KNOWLEDGE_TITLE_LIMITS.max) {
    return "The note title must contain 1–120 trimmed characters.";
  }
  const contentLength = content.trim().length;
  if (
    contentLength < KNOWLEDGE_CONTENT_LIMITS.min ||
    contentLength > KNOWLEDGE_CONTENT_LIMITS.max
  ) {
    return "The assembled note must contain 10–20,000 trimmed characters.";
  }
  return null;
}

export async function inspectRepositoryZip(
  file: Blob,
  signal?: AbortSignal,
): Promise<RepositoryZipInspection> {
  if (file.size > REPOSITORY_ZIP_LIMITS.maxArchiveBytes) {
    throw new Error("The ZIP file is too large. Choose an archive no larger than 5 MiB.");
  }
  ensureNotAborted(signal);

  const reader = new ZipReader(new BlobReader(file), {
    strictness: "strict",
    useWebWorkers: typeof window !== "undefined",
  });
  try {
    const entries = await reader.getEntries();
    if (entries.length > REPOSITORY_ZIP_LIMITS.maxEntries) {
      throw new Error("The ZIP file contains too many entries. Choose one with at most 500 entries.");
    }

    const skipped: Array<{ path: string; reason: string }> = [];
    const candidates: Array<{ entry: FileEntry; path: string }> = [];
    const paths = new Set<string>();

    for (const entry of entries) {
      ensureNotAborted(signal);
      const path = normalizePath(entry.filename);
      const normalizedKey = path.normalize("NFC").toLowerCase();
      if (paths.has(normalizedKey)) throw new Error(`The ZIP file contains a duplicate path: ${path}`);
      paths.add(normalizedKey);
      if (entry.directory) continue;
      if (entry.encrypted) throw new Error(`Encrypted archive entries are not supported: ${path}`);
      if (entry.symlink || !isRegularFile(entry)) {
        throw new Error(`Unsupported archive entry type: ${path}`);
      }
      const parts = path.split("/");
      if (isHiddenOrExcluded(parts)) {
        skipped.push({ path, reason: "hidden or excluded directory" });
        continue;
      }
      if (isCredentialFilename(parts[parts.length - 1])) {
        skipped.push({ path, reason: "credential or private-key filename" });
        continue;
      }
      if (!/\.(md|txt)$/i.test(path)) {
        skipped.push({ path, reason: "unsupported file type" });
        continue;
      }
      if (entry.uncompressedSize > REPOSITORY_ZIP_LIMITS.maxFileBytes) {
        skipped.push({ path, reason: "declared file size exceeds 100 KiB" });
        continue;
      }
      candidates.push({ entry, path });
    }

    if (candidates.length > REPOSITORY_ZIP_LIMITS.maxFiles) {
      throw new Error("The ZIP file contains more than 50 supported documentation files.");
    }
    const declaredTotal = candidates.reduce((sum, item) => sum + item.entry.uncompressedSize, 0);
    if (declaredTotal > REPOSITORY_ZIP_LIMITS.maxTotalBytes) {
      throw new Error("The supported documentation exceeds the 1 MiB total extraction limit.");
    }

    const files: RepositoryDocument[] = [];
    let totalBytes = 0;
    for (const candidate of candidates.sort((left, right) => left.path.localeCompare(right.path))) {
      ensureNotAborted(signal);
      try {
        const bytes = new Uint8Array(await candidate.entry.arrayBuffer({ signal }));
        if (bytes.byteLength > REPOSITORY_ZIP_LIMITS.maxFileBytes) {
          skipped.push({ path: candidate.path, reason: "extracted file size exceeds 100 KiB" });
          continue;
        }
        if (totalBytes + bytes.byteLength > REPOSITORY_ZIP_LIMITS.maxTotalBytes) {
          skipped.push({ path: candidate.path, reason: "extracted files exceed the 1 MiB total limit" });
          continue;
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
        if (text.includes("\0")) {
          skipped.push({ path: candidate.path, reason: "contains NUL characters" });
          continue;
        }
        if (text.trim().length === 0) {
          skipped.push({ path: candidate.path, reason: "blank document" });
          continue;
        }
        totalBytes += bytes.byteLength;
        files.push({ path: candidate.path, text });
      } catch (error) {
        if (signal?.aborted) throw error;
        skipped.push({
          path: candidate.path,
          reason: error instanceof TypeError ? "invalid UTF-8 text" : "unable to extract document",
        });
      }
    }
    if (files.length === 0) {
      throw new Error("The ZIP file contains no supported documentation files.");
    }
    return {
      archiveName:
        typeof File !== "undefined" && file instanceof File ? file.name : "repository.zip",
      files,
      skipped,
    };
  } finally {
    await reader.close();
  }
}
