import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./build.mjs";

const dir = path.join(ROOT, process.argv[2] || "dist");
const port = Number(process.argv[3] || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
http.createServer((req, res) => {
  if (req.url.startsWith("/__measure.mjs")) { res.writeHead(200, { "content-type": "text/javascript" }); fs.createReadStream(path.join(ROOT, "tools/measure.mjs")).pipe(res); return; }
  const p = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = p.endsWith(path.sep) || !path.extname(p) ? path.join(p, "index.html") : p;
  if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
