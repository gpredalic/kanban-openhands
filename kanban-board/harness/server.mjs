// Minimal static server for the product-audit harness.
// Serves harness/index.html (with the session token injected) and the built
// extension.js. The page then talks to the live agent server directly (CORS is
// open), so no API proxy is needed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 8090);
const token = process.env.SESSION_TOKEN ?? "";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    // /extension.js is the built bundle at the kanban-board root (parent dir).
    const file = pathname === "/extension.js"
      ? normalize(join(root, "..", "extension.js"))
      : normalize(join(root, pathname));
    if (!file.startsWith(root) && !file.endsWith("extension.js")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    let data = await readFile(file);
    if (pathname === "/index.html") {
      data = data.toString("utf8").replace(/__TOKEN__/g, token);
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`harness on http://localhost:${port}`));
