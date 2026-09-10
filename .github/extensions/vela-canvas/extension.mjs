import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import {
    existsSync,
    readFileSync,
    readdirSync,
    realpathSync,
    statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(EXTENSION_DIR, "..", "..", "..");
const SERVE_SCRIPT = join(REPO_ROOT, "tools", "vela-dev", "scripts", "serve.py");
const DEFAULT_DECK = join("examples", "vela-demo.vela");
const START_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 20 * 1024 * 1024;

const VENDOR_FILES = new Map([
    ["/__vela_vendor/react.min.js", join(REPO_ROOT, "vela-neutralino", "resources", "vendor", "react.min.js")],
    ["/__vela_vendor/react-dom.min.js", join(REPO_ROOT, "vela-neutralino", "resources", "vendor", "react-dom.min.js")],
    ["/__vela_vendor/lucide-react.min.js", join(REPO_ROOT, "vela-neutralino", "resources", "vendor", "lucide-react.min.js")],
    ["/__vela_vendor/babel.min.js", join(REPO_ROOT, "vela-neutralino", "resources", "vendor", "babel.min.js")],
]);

const CANVAS_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:* http://127.0.0.1:*",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
].join("; ");

const instances = new Map();

function isInsideRepo(candidate) {
    const rel = relative(REPO_ROOT, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function resolveDeckTarget(input) {
    const requested = input?.deckPath || DEFAULT_DECK;
    if (typeof requested !== "string" || requested.trim() === "") {
        throw new CanvasError("vela_invalid_path", "deckPath must be a non-empty string");
    }

    const candidate = resolve(REPO_ROOT, requested);
    if (!existsSync(candidate)) {
        throw new CanvasError("vela_deck_not_found", `Deck path does not exist: ${requested}`);
    }

    const realPath = realpathSync(candidate);
    if (!isInsideRepo(realPath)) {
        throw new CanvasError("vela_path_outside_workspace", "Deck paths must stay inside the repository");
    }

    const stats = statSync(realPath);
    if (!stats.isDirectory() && !(stats.isFile() && extname(realPath).toLowerCase() === ".vela")) {
        throw new CanvasError("vela_invalid_deck", "deckPath must name a .vela file or a directory");
    }

    return {
        path: realPath,
        relativePath: relative(REPO_ROOT, realPath),
        isDirectory: stats.isDirectory(),
    };
}

function rewriteVelaHtml(html) {
    const localDependencies = `<!-- Local canvas dependencies -->
  <script src="/__vela_vendor/react.min.js"></script>
  <script>window.react = window.React;</script>
  <script src="/__vela_vendor/react-dom.min.js"></script>
  <script src="/__vela_vendor/lucide-react.min.js"></script>
  <script>
    window.lucideReact = window.LucideReact;
    window._createRoot = window.ReactDOM.createRoot;
    window._depsReady = true;
    window.dispatchEvent(new Event("vela-deps-ready"));
  </script>

  `;

    return html
        .replace(
            /<!-- Import map for ES module resolution -->[\s\S]*?<!-- Babel standalone for JSX transpilation -->/,
            `${localDependencies}<!-- Babel standalone for JSX transpilation -->`,
        )
        .replace(
            /https:\/\/unpkg\.com\/@babel\/standalone@7\.24\.0\/babel\.min\.js/g,
            "/__vela_vendor/babel.min.js",
        )
        .replace(/\/vendor\/babel\.min\.js/g, "/__vela_vendor/babel.min.js");
}

function proxyHeaders(headers, htmlLength) {
    const result = { ...headers };
    delete result["content-security-policy"];
    delete result["x-frame-options"];
    result["content-security-policy"] = CANVAS_CSP;
    if (htmlLength !== undefined) {
        result["content-length"] = String(htmlLength);
    }
    return result;
}

function startProxy(backendPort) {
    const proxy = createServer((req, res) => {
        const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
        const vendorPath = VENDOR_FILES.get(pathname);
        if (vendorPath) {
            const body = readFileSync(vendorPath);
            res.writeHead(200, {
                "content-type": "application/javascript; charset=utf-8",
                "content-length": String(body.length),
                "cache-control": "public, max-age=86400",
                "content-security-policy": CANVAS_CSP,
            });
            res.end(body);
            return;
        }

        const upstream = httpRequest(
            {
                hostname: "127.0.0.1",
                port: backendPort,
                path: req.url,
                method: req.method,
                headers: req.headers,
            },
            (upstreamRes) => {
                const contentType = String(upstreamRes.headers["content-type"] || "");
                if (!contentType.includes("text/html")) {
                    res.writeHead(upstreamRes.statusCode || 502, proxyHeaders(upstreamRes.headers));
                    upstreamRes.pipe(res);
                    return;
                }

                const chunks = [];
                let size = 0;
                upstreamRes.on("data", (chunk) => {
                    size += chunk.length;
                    if (size > MAX_HTML_BYTES) {
                        upstreamRes.destroy(new Error("Vela HTML response exceeded the canvas limit"));
                        return;
                    }
                    chunks.push(chunk);
                });
                upstreamRes.on("end", () => {
                    const body = Buffer.from(rewriteVelaHtml(Buffer.concat(chunks).toString("utf8")));
                    res.writeHead(
                        upstreamRes.statusCode || 200,
                        proxyHeaders(upstreamRes.headers, body.length),
                    );
                    res.end(body);
                });
            },
        );

        upstream.on("error", (error) => {
            if (!res.headersSent) {
                res.writeHead(502, {
                    "content-type": "text/plain; charset=utf-8",
                    "content-security-policy": CANVAS_CSP,
                });
            }
            res.end(`Vela server unavailable: ${error.message}`);
        });
        req.pipe(upstream);
    });

    return new Promise((resolvePromise, reject) => {
        proxy.once("error", reject);
        proxy.listen(0, "127.0.0.1", () => {
            proxy.removeListener("error", reject);
            const address = proxy.address();
            resolvePromise({
                server: proxy,
                url: `http://127.0.0.1:${address.port}`,
            });
        });
    });
}

function startVelaServer(target) {
    const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(
        python,
        [
            "-u",
            SERVE_SCRIPT,
            target.path,
            "--port",
            "0",
            "--host",
            "127.0.0.1",
            "--no-open",
            "--no-auth",
        ],
        {
            cwd: target.isDirectory ? target.path : dirname(target.path),
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        },
    );

    return new Promise((resolvePromise, reject) => {
        let output = "";
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill();
                reject(new CanvasError("vela_start_timeout", "Timed out while starting the Vela server"));
            }
        }, START_TIMEOUT_MS);

        const finish = (error, port) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolvePromise({ child, port });
        };

        child.once("error", (error) => {
            finish(new CanvasError("vela_python_unavailable", `Could not start Python: ${error.message}`));
        });
        child.once("exit", (code) => {
            finish(new CanvasError("vela_server_exited", `Vela server exited with code ${code}: ${output.trim()}`));
        });
        child.stdout.on("data", (chunk) => {
            output = (output + chunk.toString()).slice(-8_000);
            const match = output.match(/Port:\s+(\d+)/);
            if (match) finish(null, Number(match[1]));
        });
        child.stderr.on("data", (chunk) => {
            output = (output + chunk.toString()).slice(-8_000);
        });
    });
}

async function startInstance(instanceId, input) {
    const target = resolveDeckTarget(input);
    const backend = await startVelaServer(target);
    try {
        const proxy = await startProxy(backend.port);
        const deckRoute = target.isDirectory
            ? "/"
            : `/deck/${encodeURIComponent(basename(target.path))}`;
        return {
            instanceId,
            target,
            child: backend.child,
            proxy: proxy.server,
            url: `${proxy.url}${deckRoute}`,
        };
    } catch (error) {
        backend.child.kill();
        throw error;
    }
}

async function stopInstance(entry) {
    await new Promise((resolvePromise) => entry.proxy.close(() => resolvePromise()));
    if (!entry.child.killed) {
        entry.child.kill();
    }
}

function countSlides(deck) {
    if (Array.isArray(deck?.lanes)) {
        return deck.lanes.reduce(
            (total, lane) => total + (lane.items || []).reduce(
                (laneTotal, item) => laneTotal + (item.slides || []).length,
                0,
            ),
            0,
        );
    }
    if (Array.isArray(deck?.G)) {
        return deck.G.reduce((total, group) => total + (group?.S || []).length, 0);
    }
    if (Array.isArray(deck?.S)) return deck.S.length;
    if (Array.isArray(deck?.slides)) return deck.slides.length;
    return 0;
}

function deckInfo(path) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
        return {
            path: relative(REPO_ROOT, path),
            kind: "directory",
            deckCount: readdirSync(path).filter((name) => extname(name).toLowerCase() === ".vela").length,
        };
    }

    const raw = JSON.parse(readFileSync(path, "utf8"));
    const deck = raw?._vela && raw.data ? raw.data : raw;
    return {
        path: relative(REPO_ROOT, path),
        kind: "deck",
        title: deck.deckTitle || deck.n || basename(path, ".vela"),
        slideCount: countSlides(deck),
        modifiedAt: stats.mtime.toISOString(),
        sizeBytes: stats.size,
    };
}

function listDecks() {
    const results = [];
    const excluded = new Set([".git", "node_modules", "evals"]);

    function walk(directory) {
        if (results.length >= 100) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (results.length >= 100 || excluded.has(entry.name)) continue;
            const fullPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".vela") {
                results.push(deckInfo(fullPath));
            }
        }
    }

    walk(REPO_ROOT);
    return results;
}

const canvas = createCanvas({
    id: "vela-deck",
    displayName: "Vela Slides",
    description: "Open and collaboratively edit a repository-local Vela slide deck with live file synchronization.",
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            deckPath: {
                type: "string",
                description: "Repository-relative path to a .vela deck or a directory of decks.",
            },
        },
    },
    actions: [
        {
            name: "deck_info",
            description: "Return metadata for the deck or deck directory open in this canvas.",
            handler: (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (!entry) throw new CanvasError("vela_instance_not_found", "The Vela canvas is not open");
                return deckInfo(entry.target.path);
            },
        },
        {
            name: "list_decks",
            description: "List Vela decks available in the current repository.",
            handler: () => listDecks(),
        },
    ],
    open: async (ctx) => {
        let entry = instances.get(ctx.instanceId);
        if (!entry) {
            entry = await startInstance(ctx.instanceId, ctx.input);
            instances.set(ctx.instanceId, entry);
        }
        return {
            title: entry.target.isDirectory
                ? `Vela Slides — ${basename(entry.target.path)}`
                : `Vela Slides — ${basename(entry.target.path, ".vela")}`,
            status: entry.target.relativePath,
            url: entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = instances.get(ctx.instanceId);
        if (!entry) return;
        instances.delete(ctx.instanceId);
        await stopInstance(entry);
    },
});

await joinSession({ canvases: [canvas] });

async function shutdown() {
    const entries = [...instances.values()];
    instances.clear();
    await Promise.allSettled(entries.map(stopInstance));
}

process.once("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
});
process.once("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
});
