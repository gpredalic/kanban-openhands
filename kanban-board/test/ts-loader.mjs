/**
 * ts-loader.mjs — ESM resolve hook for headless `node --test`.
 *
 * The source uses bundler-style extensionless relative imports (e.g.
 * `import { x } from "./date"`), which esbuild resolves fine but Node's native
 * ESM loader does not. This hook rewrites an extensionless relative specifier
 * to its `.ts` file so the native type-stripping loader can load it.
 */
export async function resolve(specifier, context, next) {
  const isRelative =
    specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension =
    /\.(ts|js|mjs|cjs|json|css|svg)$/.test(specifier);

  if (isRelative && !hasExtension) {
    try {
      return await next(specifier + ".ts", context);
    } catch {
      // Fall through to the default resolver (may be a directory or .js).
    }
  }
  return next(specifier, context);
}
