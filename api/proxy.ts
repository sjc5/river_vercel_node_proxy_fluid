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

console.log("[Node Proxy]: Initializing function container...");

const GO_APP_LOCATION = join(process.cwd(), waveConfig.Core.DistDir, "main");
const GO_APP_HEALTH_CHECK_ENDPOINT = waveConfig.Watch.HealthcheckEndpoint;
const GO_APP_STARTUP_TIMEOUT_IN_MS = 10_000; // 10s

let goProcess: ChildProcess | null = null;
let proxy: RequestHandler;

async function init() {
	try {
		const startTime = performance.now();
		console.log(
			"[Node Proxy]: Cold start detected. Starting Go process...",
		);

		const port = await getPort({ port: [8080, 8081, 8082, 8083, 8084] });

		goProcess = spawn(GO_APP_LOCATION, [], {
			env: {
				...process.env,
				PORT: port.toString(),
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		goProcess.stdout?.on("data", (data: Buffer) => {
			console.log(`[Go STDOUT]: ${data.toString().trim()}`);
		});
		goProcess.stderr?.on("data", (data: Buffer) => {
			console.error(`[Go STDERR]: ${data.toString().trim()}`);
		});

		goProcess.on("error", (err: Error) => {
			console.error("[Node Proxy]: Failed to start Go process:", err);
			goProcess = null;
		});

		goProcess.on("exit", (code: number | null, signal: string | null) => {
			console.log(
				`[Node Proxy]: Go process exited with code ${code} and signal ${signal}.`,
			);
			goProcess = null;
		});

		const healthUrl = `http://localhost:${port}${GO_APP_HEALTH_CHECK_ENDPOINT}`;
		await waitOn({
			resources: [healthUrl],
			timeout: GO_APP_STARTUP_TIMEOUT_IN_MS,
			interval: 20,
			simultaneous: 1,
			validateStatus: (status: number) => status >= 200 && status < 400,
		});

		proxy = createProxyMiddleware({
			target: `http://localhost:${port}`,
			changeOrigin: true,
			ws: true,
		});

		const startupTime = performance.now() - startTime;
		console.log(
			`[Node Proxy]: Go app and proxy are ready in ${startupTime.toFixed(2)}ms.`,
		);
	} catch (error) {
		console.error(
			"[Node Proxy]: Fatal error during initialization:",
			error,
		);
		if (goProcess) {
			goProcess.kill();
			goProcess = null;
		}
		throw error;
	}
}

const startupPromise = init();
await startupPromise;

export default async function handler(req: VercelRequest, res: VercelResponse) {
	try {
		await startupPromise;

		if (!goProcess || goProcess.killed) {
			res.status(503).json({
				error: "Service Unavailable",
				message: "The backend service is not running.",
			});
			return;
		}

		return new Promise<void>((resolve, reject) => {
			proxy(req as any, res as any, (result) => {
				if (result instanceof Error) {
					return reject(result);
				}
				resolve();
			});
		});
	} catch (error) {
		console.error("[Node Proxy]: Handler error:", error);
		res.status(500).json({
			error: "Internal Server Error",
			message:
				"Failed to proxy request due to an initialization failure.",
		});
	}
}

process.on("SIGTERM", () => {
	if (goProcess) {
		console.log(
			"[Node Proxy]: SIGTERM received. Shutting down Go process...",
		);
		goProcess.kill("SIGTERM");
	}
});
