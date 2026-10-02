import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

/** Read access to one platform's source tree. Behind an interface so verification can be tested in memory. */
export interface SourceReader {
  /** Returns the file's text, or null if it does not exist or lies outside the root. */
  read(relativePath: string): Promise<string | null>;
}

/**
 * Resolves a path claimed by the model against a root, refusing anything that would escape it.
 * Model output is untrusted, so "../../etc/passwd" or absolute paths must never be read.
 */
export function resolveInsideRoot(root: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

export class FsSourceReader implements SourceReader {
  constructor(private readonly root: string) {}

  async read(relativePath: string): Promise<string | null> {
    const resolved = resolveInsideRoot(this.root, relativePath);
    if (resolved === null) return null;
    try {
      // A symlink inside the repo could still point outside it, so check the real paths too
      const [realRoot, realFile] = await Promise.all([realpath(this.root), realpath(resolved)]);
      if (resolveInsideRoot(realRoot, path.relative(realRoot, realFile)) === null) return null;
      return await readFile(realFile, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw e;
    }
  }
}
