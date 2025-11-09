import { existsSync } from "fs";

console.log("🔍 Checking public/ directory...");

const requiredFiles = [
  "public/index.html",
  "public/tailwind.build.css"
];

let allPresent = true;

for (const file of requiredFiles) {
  if (existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.error(`❌ Missing: ${file}`);
    allPresent = false;
  }
}

// Check optional but expected files
const optionalFiles = [
  "public/js/paint.js",
  "public/favicon.ico"
];

for (const file of optionalFiles) {
  if (existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.warn(`⚠️  Optional: ${file} not found`);
  }
}

if (!allPresent) {
  console.error("\n❌ Build validation failed: Required files missing in public/");
  console.error("Ensure your build script copies all necessary files to public/");
  process.exit(1);
}

console.log("\n✨ Build validation passed! public/ is ready for deployment.");
