// Copy vendor files (highlight.js) into src/vendor for bundling
const fs = require("fs");
const path = require("path");

const vendorDir = path.join(__dirname, "..", "src", "vendor");
fs.mkdirSync(vendorDir, { recursive: true });

// Copy highlight.js minified
const hljsSrc = path.join(__dirname, "..", "node_modules", "highlight.js", "lib", "index.js");
// We'll use the pre-built CDN version which is a single file
const hljsMin = path.join(__dirname, "..", "node_modules", "highlight.js", "highlight.min.js");

// Try the pre-built version first, otherwise we'll create a small bundle note
if (fs.existsSync(hljsMin)) {
  fs.copyFileSync(hljsMin, path.join(vendorDir, "highlight.min.js"));
} else {
  // Fallback: copy the ES module entry
  console.log("Note: highlight.min.js not found at expected path, will need manual copy");
}

// Copy a highlight.js CSS theme
const cssThemes = [
  "github.min.css",
  "github-dark.min.css",
];

for (const theme of cssThemes) {
  const src = path.join(__dirname, "..", "node_modules", "highlight.js", "styles", theme);
  if (fs.existsSync(src)) {
    const dest = theme === "github.min.css" ? "hljs-github.css" : "hljs-github-dark.css";
    fs.copyFileSync(src, path.join(vendorDir, dest));
  }
}

console.log("Vendor files copied to src/vendor/");
