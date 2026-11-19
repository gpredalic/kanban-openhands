/**
 * register.mjs — registers the extensionless-import resolve hook.
 *
 * Loaded via `node --import ./test/register.mjs` so the hook is active before
 * any test file is resolved.
 */
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
