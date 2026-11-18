import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type CliDeps } from "../../src/cli/main.js";
import { LOOPBACK, localHost, reportPolicy, serveScreen, startReportServer, type RunningServer } from "../../src/cli/serve.js";
import { tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let file: string;
let server: RunningServer | null = null;

const POLICY = "default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-abc'; img-src data: blob:; font-src data:; media-src blob:; base-uri 'none'; form-action 'none'";
const REPORT = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${POLICY}">\n</head><body>private report</body></html>\n`;
const TOKEN = "0123456789abcdef0123456789abcdef";

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  await mkdir(join(home, "reports"), { recursive: true });
  file = join(home, "reports", "report.html");
  await writeFile(file, REPORT);
});
afterEach(async () => {
  await server?.close();
  server = null;
  await cleanup();
});

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function get(port: number, path: string, options: { host?: string; method?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: LOOPBACK, port, path, method: options.method ?? "GET", headers: { Host: options.host ?? `localhost:${port}` }, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
const start = async (idleMs?: number) => (server = await startReportServer({ file, port: 0, token: TOKEN, ...(idleMs ? { idleMs } : {}) }));

describe("the report server", () => {
  it("listens on the loopback address only, so nothing on the network can reach it", async () => {
    const s = await start();
    expect(LOOPBACK).toBe("127.0.0.1");
    expect(s.port).toBeGreaterThan(0);
    // The address the socket is bound to, not just what was asked for.
    const { createConnection } = await import("node:net");
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: s.port }, () => {
        expect(socket.remoteAddress).toBe("127.0.0.1");
        socket.end();
        resolve();
      });
      socket.on("error", reject);
    });
  });

  it("serves the report at its one secret path, with the report's own policy plus no framing", async () => {
    const s = await start();
    expect(s.path).toBe(`/${TOKEN}`);
    const reply = await get(s.port, s.path);
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(REPORT);
    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply.headers["content-security-policy"]).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(reply.headers).toMatchObject({ "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" });
  });

  it("makes a random path each time it starts, so another account on the server cannot guess it", async () => {
    const a = await startReportServer({ file, port: 0 });
    const b = await startReportServer({ file, port: 0 });
    try {
      expect(a.path).toMatch(/^\/[0-9a-f]{32}$/);
      expect(a.path).not.toBe(b.path);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("answers nothing else: no index, no listing, no other file, no query, no traversal", async () => {
    const s = await start();
    for (const path of ["/", "/report.html", `/${TOKEN}/`, `/${TOKEN}?x=1`, `/${TOKEN}/../report.html`, "/../../etc/passwd", "/favicon.ico", `/${TOKEN.slice(0, -1)}0`]) {
      const reply = await get(s.port, path);
      expect(reply.status, path).toBe(404);
      expect(reply.body).not.toContain("private report");
      expect(reply.headers["content-security-policy"]).toContain("default-src 'none'");
    }
  });

  it("refuses a Host that is not localhost, so a web page cannot reach it through DNS rebinding", async () => {
    const s = await start();
    for (const host of ["evil.example", `evil.example:${s.port}`, `127.0.0.1.evil.example:${s.port}`, "localhost.:1"]) {
      const reply = await get(s.port, s.path, { host });
      expect(reply.status, host).toBe(421);
      expect(reply.body).not.toContain("private report");
    }
    // A tunnel to a different local port still works.
    expect((await get(s.port, s.path, { host: "localhost:9000" })).status).toBe(200);
    expect((await get(s.port, s.path, { host: `127.0.0.1:${s.port}` })).status).toBe(200);
  });

  it("is read-only: only GET and HEAD, and HEAD sends no body", async () => {
    const s = await start();
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const reply = await get(s.port, s.path, { method });
      expect(reply.status, method).toBe(405);
      expect(reply.headers.allow).toBe("GET, HEAD");
    }
    const head = await get(s.port, s.path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });

  it("reads the report again on each visit, so a new run shows without restarting", async () => {
    const s = await start();
    await writeFile(file, REPORT.replace("private report", "newer report"));
    expect((await get(s.port, s.path)).body).toContain("newer report");
  });

  it("says the report is missing without naming the path when the file is gone", async () => {
    const s = await start();
    await writeFile(file, "");
    const { rm } = await import("node:fs/promises");
    await rm(file);
    const reply = await get(s.port, s.path);
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain(home);
  });

  it("stops by itself after the idle time, and then nothing listens", async () => {
    const s = await start(80);
    expect(await s.closed).toBe("idle");
    await expect(get(s.port, s.path)).rejects.toThrow();
  });
});

describe("host and policy checks", () => {
  it("accepts only localhost names", () => {
    expect(localHost("localhost:1234")).toBe(true);
    expect(localHost("LOCALHOST")).toBe(true);
    expect(localHost("127.0.0.1:1")).toBe(true);
    expect(localHost("[::1]:80")).toBe(true);
    for (const host of [undefined, "", "10.0.0.1:80", "localhost.evil", "evil.localhost:1", "localhost:1:2", "0.0.0.0:80"]) expect(localHost(host), String(host)).toBe(false);
  });

  it("keeps the report's policy and never loosens it; anything unexpected gets a policy that loads nothing", () => {
    expect(reportPolicy(REPORT)).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(reportPolicy("<html>no policy</html>")).toMatch(/^default-src 'none'; frame-ancestors 'none'/);
    expect(reportPolicy('<meta http-equiv="Content-Security-Policy" content="script-src *">')).toMatch(/^default-src 'none'; frame-ancestors 'none'/);
  });
});

describe("ai-insights serve", () => {
  let out: string;
  let err: string;
  const deps = (overrides: Partial<CliDeps> = {}): Partial<CliDeps> => ({
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
    env: { AI_INSIGHTS_HOME: home },
    sources: [],
    onInterrupt: () => () => {},
    ...overrides,
  });
  beforeEach(() => {
    out = "";
    err = "";
  });

  it("prints the SSH tunnel command and the link, then waits until the server stops", async () => {
    let started: { file: string; port: number } | null = null;
    const code = await run(["serve", "--port", "48123"], deps({
      serveReport: async (options) => {
        started = options;
        return { port: 48123, path: `/${TOKEN}`, closed: Promise.resolve("idle"), close: async () => {} };
      },
    }));
    expect(code).toBe(0);
    expect(started).toEqual({ file, port: 48123 });
    expect(out).toContain("ssh -L 48123:127.0.0.1:48123 user@host");
    expect(out).toContain(`http://localhost:48123/${TOKEN}`);
    expect(out).toContain("127.0.0.1 only");
    expect(out).toContain("Stopped: no visits for a while.");
  });

  it("stops on Ctrl-C", async () => {
    let interrupt = () => {};
    let resolveClosed: (why: "closed") => void = () => {};
    const closed = new Promise<"idle" | "closed">((resolve) => (resolveClosed = resolve));
    const running = run(["serve"], deps({
      onInterrupt: (handler) => {
        interrupt = handler;
        return () => {};
      },
      serveReport: async () => ({ port: 1, path: "/x", closed, close: async () => resolveClosed("closed") }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    interrupt();
    expect(await running).toBe(0);
    expect(out).toContain("Stopped.");
  });

  it("asks for a run first when there is no report yet", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(file);
    expect(await run(["serve"], deps())).toBe(1);
    expect(err).toContain("no report yet");
  });

  it("says when the chosen port is taken", async () => {
    const busy = await start();
    expect(await run(["serve", "--port", String(busy.port)], deps())).toBe(1);
    expect(err).toContain(`port ${busy.port} is in use`);
  });

  it("only takes a port from 1024 to 65535", async () => {
    for (const port of ["80", "70000", "abc"]) {
      err = "";
      expect(await run(["serve", "--port", port], deps())).toBe(2);
      expect(err).toContain("--port must be");
    }
  });

  it("prints the idle time it was started with", () => {
    expect(serveScreen(5000, "/t", 5 * 60_000)).toContain("after 5 minutes without a visit");
  });
});
