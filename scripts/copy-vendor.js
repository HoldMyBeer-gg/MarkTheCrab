// Copy highlight.js CSS themes into src/vendor. The hljs runtime itself is
// bundled via src/hljs-setup.js, so no JS copy is needed.
const fs = require("fs");
const path = require("path");

const vendorDir = path.join(__dirname, "..", "src", "vendor");
fs.mkdirSync(vendorDir, { recursive: true });

const cssThemes = [
  ["github.min.css", "hljs-github.css"],
  ["github-dark.min.css", "hljs-github-dark.css"],
];

for (const [src, dest] of cssThemes) {
  const srcPath = path.join(__dirname, "..", "node_modules", "highlight.js", "styles", src);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(vendorDir, dest));
  }
}

console.log("Vendor CSS copied to src/vendor/");
