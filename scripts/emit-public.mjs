import { mkdirSync, cpSync, copyFileSync, existsSync } from "fs";

console.log("📦 Emitting public/ directory...");

// Ensure public/ exists
mkdirSync("public", { recursive: true });

// Copy index.html to public/
const SRC_INDEX = "index.html";
if (existsSync(SRC_INDEX)) {
  copyFileSync(SRC_INDEX, "public/index.html");
  console.log("✅ Copied index.html to public/");
} else {
  console.error("❌ index.html not found at root");
  process.exit(1);
}

// Copy favicon if it exists
if (existsSync("public/favicon.ico")) {
  console.log("✅ favicon.ico already in public/");
}

// Public JS files should already be in public/js/
if (existsSync("public/js/paint.js")) {
  console.log("✅ JavaScript files already in public/js/");
} else {
  console.warn("⚠️  Warning: public/js/paint.js not found");
}

// Copy css/ directory to public/css/ (for source files if needed)
if (existsSync("css")) {
  cpSync("css", "public/css", { recursive: true, force: true });
  console.log("✅ Copied css/ to public/css/");
}

// Copy src/ directory to public/src/ (for TypeScript sources served to client)
if (existsSync("src")) {
  cpSync("src", "public/src", { recursive: true, force: true });
  console.log("✅ Copied src/ to public/src/");
}

// Copy js/ directory to public/js/ if it exists at root (backup files)
if (existsSync("js") && !existsSync("js/node_modules")) {
  cpSync("js", "public/js", { recursive: true, force: true });
  console.log("✅ Copied js/ to public/js/");
}

console.log("✨ Public directory ready!");
