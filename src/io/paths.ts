import path from "node:path";

/** True when `target` is `root` itself or lies below it. Purely lexical: resolve symlinks first where they matter. */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(root, target));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
