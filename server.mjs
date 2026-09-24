import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const distRoot = resolve(projectRoot, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

function applyHeaders(response, filePath) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
  const filePath = resolve(distRoot, relativePath);

  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return filePath;
  }

  return join(distRoot, "index.html");
}

if (!existsSync(join(distRoot, "index.html"))) {
  console.error("未找到 dist/index.html，请先运行 npm run build");
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(request.url || "/");
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const fileSize = statSync(filePath).size;
  applyHeaders(response, filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": fileSize
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`thumb-guessr 已启动：http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
