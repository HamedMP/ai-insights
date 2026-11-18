import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * `ai-insights serve`: shows the report to a browser on another computer through an SSH tunnel. It listens on the
 * loopback address only (127.0.0.1, never 0.0.0.0, with no option to change that), so nothing on the network can
 * reach it; the person forwards a port over their own SSH connection. It serves one file, the report it was
 * started with, at one unguessable path; it reads nothing the request names, lists nothing and accepts only GET
 * and HEAD. The random path keeps other accounts on a shared server from reading the report through the same
 * loopback port, and the Host check stops a web page from reaching it through a DNS name that points at 127.0.0.1.
 * Nothing here makes an outbound connection.
 */

export const LOOPBACK = "127.0.0.1";
export const IDLE_MS = 30 * 60_000;
/** A report is a few megabytes (fonts and the video muxer are inlined); anything far larger is not ours. */
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Fallback policy for error responses and for a report whose own policy cannot be read: load nothing at all. */
const LOCKED = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export interface ServeOptions {
  /** The report file. Only this file is ever read. */
  file: string;
  /** 0 picks a free port. */
  port: number;
  /** Stop after this long without a request. */
  idleMs?: number;
  /** The secret path segment; random unless a test passes one. */
  token?: string;
}

export interface RunningServer {
  port: number;
  /** The one path that serves the report, e.g. "/3f…9a". */
  path: string;
  /** Resolves once the server has stopped, by close() or the idle timeout. */
  closed: Promise<"idle" | "closed">;
  close(): Promise<void>;
}

/** Only the loopback names, on any port: the person may forward to a different local port. */
export function localHost(host: string | undefined): boolean {
  if (!host) return false;
  const match = /^(\[::1\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.exec(host.trim());
  return !!match && LOCAL_NAMES.has(match[1]!.toLowerCase());
}

/** The report's own Content-Security-Policy from its meta tag, so the header adds frame-ancestors without loosening it. */
export function reportPolicy(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]{1,2000})">/.exec(html.slice(0, 4096));
  const policy = match?.[1];
  return policy && /^default-src 'none';/.test(policy) && !/[\r\n]/.test(policy) ? `${policy}; frame-ancestors 'none'` : LOCKED;
}

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

function plain(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Security-Policy": LOCKED, "Content-Type": "text/plain; charset=utf-8", ...extra });
  res.end(`${text}\n`);
}

function samePath(url: string | undefined, path: string): boolean {
  if (!url || url.length !== path.length) return false;
  return timingSafeEqual(Buffer.from(url), Buffer.from(path));
}

export async function startReportServer(options: ServeOptions): Promise<RunningServer> {
  const token = options.token ?? randomBytes(16).toString("hex");
  const path = `/${token}`;
  const idleMs = options.idleMs ?? IDLE_MS;
  let timer: NodeJS.Timeout | undefined;
  let settle: (why: "idle" | "closed") => void = () => {};
  const closed = new Promise<"idle" | "closed">((resolve) => {
    settle = resolve;
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    arm();
    if (!localHost(req.headers.host)) return plain(res, 421, "This server answers only on localhost.");
    if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "Method not allowed.", { Allow: "GET, HEAD" });
    if (!samePath(req.url, path)) return plain(res, 404, "Not found. Open the full link printed in the terminal.");
    let html: string;
    try {
      const info = await stat(options.file);
      if (!info.isFile() || info.size > MAX_REPORT_BYTES) return plain(res, 500, "The report could not be read.");
      html = await readFile(options.file, "utf8");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return plain(res, 500, "The report could not be read. Run ai-insights again, then serve.");
    }
    const body = Buffer.from(html, "utf8");
    res.writeHead(200, { ...BASE_HEADERS, "Content-Security-Policy": reportPolicy(html), "Content-Type": "text/html; charset=utf-8", "Content-Length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) plain(res, 500, "Something went wrong.");
      else res.destroy(error instanceof Error ? error : undefined);
    });
  });
  // A browser needs a handful of connections; anything slow or large is not a browser loading one page.
  server.maxConnections = 16;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  const stop = (why: "idle" | "closed") =>
    new Promise<void>((resolve) => {
      if (timer) clearTimeout(timer);
      server.close(() => resolve());
      server.closeAllConnections();
      settle(why);
    });
  function arm() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void stop("idle"), idleMs);
    timer.unref();
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: LOOPBACK, port: options.port, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  arm();
  const port = (server.address() as AddressInfo).port;
  return { port, path, closed, close: () => stop("closed") };
}

/** What `serve` prints once it is listening. */
export function serveScreen(port: number, path: string, idleMs: number = IDLE_MS): string {
  const minutes = Math.round(idleMs / 60_000);
  return [
    `Serving your report on this server at http://localhost:${port}${path}`,
    "It listens on 127.0.0.1 only: nothing on the network can reach it.",
    "",
    "On your own computer, forward the port over SSH:",
    `  ssh -L ${port}:127.0.0.1:${port} user@host`,
    "then open:",
    `  http://localhost:${port}${path}`,
    "",
    `It stops after ${minutes} minutes without a visit, or press Ctrl-C.`,
    "",
  ].join("\n");
}
