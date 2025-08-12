import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import { join } from "node:path";
import waveConfig from "../app/wave.config.json" with { type: "json" };

console.log("[Node Proxy]: Initializing function container...");

const GO_APP_LOCATION = join(process.cwd(), waveConfig.Core.DistDir, "main");
const GO_APP_HEALTH_CHECK_ENDPOINT = waveConfig.Watch.HealthcheckEndpoint;
const GO_APP_STARTUP_TIMEOUT_IN_MS = 10_000; // 10s
const PORT = 8080;

let goProcess: ChildProcess | null = null;

async function waitForGoApp(url: string, timeout: number): Promise<void> {
	const startTime = Date.now();
	return new Promise((resolve, reject) => {
		const attempt = () => {
			http.get(url, (res) => {
				if (
					res.statusCode &&
					res.statusCode >= 200 &&
					res.statusCode < 400
				) {
					resolve();
				} else {
					scheduleNextAttempt();
				}
			}).on("error", scheduleNextAttempt);
		};

		const scheduleNextAttempt = (err?: Error) => {
			if (Date.now() - startTime > timeout) {
				return reject(err || new Error("Health check timed out."));
			}
			setTimeout(attempt, 50);
		};

		attempt();
	});
}

async function init() {
	try {
		const startTime = performance.now();
		console.log(
			"[Node Proxy]: Cold start detected. Starting Go process...",
		);

		goProcess = spawn(GO_APP_LOCATION, [], {
			env: { ...process.env, PORT: PORT.toString() },
			stdio: "pipe",
		});

		goProcess.stdout?.on("data", (data) =>
			console.log(`[Go]: ${data.toString().trim()}`),
		);
		goProcess.stderr?.on("data", (data) =>
			console.error(`[Go ERR]: ${data.toString().trim()}`),
		);

		goProcess.on("exit", (code, signal) => {
			console.log(
				`[Node Proxy]: Go process exited with code ${code}, signal ${signal}.`,
			);
			goProcess = null; // Mark as dead
		});

		const healthUrl = `http://localhost:${PORT}${GO_APP_HEALTH_CHECK_ENDPOINT}`;
		await waitForGoApp(healthUrl, GO_APP_STARTUP_TIMEOUT_IN_MS);

		const startupTime = performance.now() - startTime;
		console.log(
			`[Node Proxy]: Go app is ready in ${startupTime.toFixed(2)}ms.`,
		);
	} catch (error) {
		console.error(
			"[Node Proxy]: Fatal error during initialization:",
			error,
		);
		goProcess?.kill();
		goProcess = null;
		throw error;
	}
}

const startupPromise = init();
await startupPromise;

export default async function handler(req: VercelRequest, res: VercelResponse) {
	try {
		await startupPromise;

		if (!goProcess || goProcess.killed) {
			res.status(503).send(
				"Service Unavailable: The backend service is not running.",
			);
			return;
		}

		const proxyReq = http.request(
			{
				hostname: "localhost",
				port: PORT,
				path: req.url,
				method: req.method,
				headers: req.headers,
			},
			(proxyRes) => {
				res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
				proxyRes.pipe(res, { end: true });
			},
		);

		proxyReq.on("error", (err) => {
			console.error("[Node Proxy]: Error proxying request:", err);
			if (!res.headersSent) {
				res.status(502).send("Bad Gateway");
			}
			res.end();
		});

		req.pipe(proxyReq, { end: true });
	} catch (error) {
		console.error("[Node Proxy]: Handler error:", error);
		if (!res.headersSent) {
			res.status(500).send(
				"Internal Server Error: Initialization failed.",
			);
		}
	}
}

process.on("SIGTERM", () => {
	if (goProcess) {
		console.log(
			"[Node Proxy]: SIGTERM received, shutting down Go process.",
		);
		goProcess.kill("SIGTERM");
	}
});
