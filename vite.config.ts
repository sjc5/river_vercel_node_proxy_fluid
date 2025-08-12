import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { riverVitePlugin } from "./frontend/river.gen.ts";

export default defineConfig({
	plugins: [react(), riverVitePlugin()],
});
