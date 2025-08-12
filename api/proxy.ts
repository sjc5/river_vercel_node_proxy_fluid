// api/proxy.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ChildProcess, spawn } from "child_process";
import getPort from "get-port";
import {
	createProxyMiddleware,
	type RequestHandler,
} from "http-proxy-middleware";
import { join } from "path";
import waitOn from "wait-on";

// Cache the running process between invocations
let goProcess: ChildProcess | null = null;
let goPort: number | null = null;
let isStarting = false;
let startPromise: Promise<number> | null = null;

// Configuration
const GO_APP_PATH = join(process.cwd(), "./app/__dist/main"); // Path to your Go binary
const GO_APP_STARTUP_TIMEOUT = 10000; // 10 seconds timeout
const HEALTH_CHECK_PATH = "/healthz"; // Optional: health check endpoint in your Go app

async function startGoApp(): Promise<number> {
	console.log("Starting Go app...");

	// If already starting, wait for the existing start process
	if (isStarting && startPromise) {
		return startPromise;
	}

	// If already running, return immediately
	if (goProcess && !goProcess.killed && goPort) {
		return goPort;
	}

	isStarting = true;

	startPromise = (async (): Promise<number> => {
		try {
			// Get an available port
			goPort = await getPort({ port: [8080, 8081, 8082, 8083, 8084] });

			// Spawn the Go application
			goProcess = spawn(GO_APP_PATH, [], {
				env: {
					...process.env,
					PORT: goPort.toString(),
				},
				stdio: "inherit", // This will help with debugging
			});

			// Handle process errors
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
			const healthUrl = `http://localhost:${goPort}${HEALTH_CHECK_PATH}`;
			await waitOn({
				resources: [healthUrl],
				timeout: GO_APP_STARTUP_TIMEOUT,
				interval: 100,
				simultaneous: 1,
				validateStatus: (status: number) =>
					status >= 200 && status < 400,
			});

			console.log(`Go app started successfully on port ${goPort}`);
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

// Create the proxy middleware instance (reused across requests)
let proxyMiddleware: RequestHandler | null = null;

export default async function handler(
	req: VercelRequest,
	res: VercelResponse,
): Promise<void> {
	try {
		// Start the Go app if needed
		const port = await startGoApp();

		// Create proxy middleware if not exists or port changed
		if (!proxyMiddleware || goPort !== port) {
			proxyMiddleware = createProxyMiddleware({
				target: `http://localhost:${port}`,
				changeOrigin: true,
				ws: true, // Enable WebSocket support
			});
		}

		console.log(`Proxying request to Go app on port ${port}`);

		// Proxy the request
		return new Promise<void>((resolve, reject) => {
			proxyMiddleware!(req as any, res as any, (err?: any) => {
				if (err) reject(err);
				else resolve();
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

// Handle graceful shutdown
process.on("SIGTERM", () => {
	if (goProcess) {
		console.log("Shutting down Go app...");
		goProcess.kill("SIGTERM");
	}
});
