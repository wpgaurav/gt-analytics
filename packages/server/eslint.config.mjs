import { createConfig } from "@counterscale/eslint-config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default createConfig({
    baseDirectory: __dirname,
    ignores: [
        "public/tracker.js",
        "build/*",
        "node_modules",
        "dist/*",
        ".react-router",
        "coverage",
        // Wrangler's generated dev/deploy bundles. Transient, not authored,
        // and they drown real findings -- a running dev server put nearly two
        // thousand errors in this report.
        ".wrangler",
    ],
    includeReact: true,
    includeTypeScript: true,
    tsconfigRootDir: "./",
    project: "./tsconfig.json",
    additionalGlobals: {
        counterscale: true,
    },
});
