import { createServer } from "http";
import handler from "./api/proxy.ts";

const PORT = 3000;

const server = createServer(async (req, res) => {
	const vercelReq = req as any;
	const vercelRes = res as any;

	vercelRes.status = (code: number) => {
		res.statusCode = code;
		return vercelRes;
	};

	vercelRes.json = (data: any) => {
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify(data));
		return vercelRes;
	};

	try {
		await handler(vercelReq, vercelRes);
	} catch (error) {
		console.error("Handler error:", error);
		res.statusCode = 500;
		res.end("Internal Server Error");
	}
});

server.listen(PORT, () => {
	console.log(`Test server running on http://localhost:${PORT}`);
	console.log(
		"Your Go app will be started automatically when you make a request",
	);
});
