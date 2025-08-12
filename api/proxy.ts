import type { VercelRequest, VercelResponse } from "@vercel/node";
import getPort from "get-port";
import {
	createProxyMiddleware,
	type RequestHandler,
} from "http-proxy-middleware";
import { ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import waitOn from "wait-on";
import waveConfig from "../app/wave.config.json" with { type: "json" };

console.log("[proxy.ts]: Initializing...");

const GO_APP_LOCATION = join(process.cwd(), waveConfig.Core.DistDir, "main");
const GO_APP_HEALTH_CHECK_ENDPOINT = waveConfig.Watch.HealthcheckEndpoint;
const GO_APP_STARTUP_TIMEOUT_IN_MS = 10_000; // 10s

let goProcess: ChildProcess | null = null;
let goPort: number | null = null;
let isStarting = false;
let startPromise: Promise<number> | null = null;

const requestTimings = new WeakMap<any, number>();

await startGoApp();

let proxyMiddleware: RequestHandler | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
	requestTimings.set(req, performance.now());

	try {
		const port = await startGoApp();

		if (!proxyMiddleware || goPort !== port) {
			proxyMiddleware = createProxyMiddleware({
				target: `http://localhost:${port}`,
				changeOrigin: true,
				ws: true,
				on: {
					proxyRes: (proxyRes, req) => {
						const startTime = requestTimings.get(req);
						if (startTime) {
							const duration = performance.now() - startTime;
							console.log(
								`[Node proxy]: ${req.method} ${req.url} - ${proxyRes.statusCode} in ${duration.toFixed(2)}ms`,
							);
							requestTimings.delete(req);
						}
					},
					error: (err, req) => {
						const startTime = requestTimings.get(req);
						if (startTime) {
							const duration = performance.now() - startTime;
							console.error(
								`[Node proxy]: ${req.method} ${req.url} - error after ${duration.toFixed(2)}ms:`,
								err.message,
							);
							requestTimings.delete(req);
						}
					},
				},
			});
		}

		return new Promise<void>((resolve, reject) => {
			proxyMiddleware!(req as any, res as any, (err?: any) => {
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	} catch (error) {
		console.error("Handler error:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message: error instanceof Error ? error.message : "Unknown error",
		});
	}
}

process.on("SIGTERM", () => {
	if (goProcess) {
		console.log("Shutting down Go app...");
		goProcess.kill("SIGTERM");
	}
});

async function startGoApp(): Promise<number> {
	if (isStarting && startPromise) {
		return startPromise;
	}

	if (goProcess && !goProcess.killed && goPort) {
		return goPort;
	}

	isStarting = true;
	startPromise = (async (): Promise<number> => {
		try {
			const startTime = performance.now();
			goPort = await getPort({ port: [8080, 8081, 8082, 8083, 8084] });

			goProcess = spawn(GO_APP_LOCATION, [], {
				env: {
					...process.env,
					PORT: goPort.toString(),
				},
				stdio: "inherit",
			});

			goProcess.on("error", (err: Error) => {
				console.error("Failed to start Go app:", err);
				goProcess = null;
			});

			goProcess.on(
				"exit",
				(code: number | null, signal: string | null) => {
					console.log(
						`Go app exited with code ${code} and signal ${signal}`,
					);
					goProcess = null;
				},
			);

			// Wait for the Go app to be ready
			const healthUrl = `http://localhost:${goPort}${GO_APP_HEALTH_CHECK_ENDPOINT}`;
			await waitOn({
				resources: [healthUrl],
				timeout: GO_APP_STARTUP_TIMEOUT_IN_MS,
				interval: 10,
				simultaneous: 1,
				validateStatus: (status: number) =>
					status >= 200 && status < 400,
			});

			const startupTime = performance.now() - startTime;
			console.log(
				`[Node proxy]: Go app started in ${startupTime.toFixed(2)}ms`,
			);

			return goPort;
		} catch (error) {
			console.error("Failed to start Go app:", error);
			if (goProcess) {
				goProcess.kill();
				goProcess = null;
			}
			throw error;
		} finally {
			isStarting = false;
		}
	})();

	return startPromise;
}
