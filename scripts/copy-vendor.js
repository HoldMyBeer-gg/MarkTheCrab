// Copy third-party CSS + font assets into src/vendor. JS runtimes are
// bundled via esbuild.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vendorDir = path.join(root, "src", "vendor");
fs.mkdirSync(vendorDir, { recursive: true });

// highlight.js code-block themes
const hljsThemes = [
  ["github.min.css", "hljs-github.css"],
  ["github-dark.min.css", "hljs-github-dark.css"],
];
for (const [src, dest] of hljsThemes) {
  const srcPath = path.join(root, "node_modules", "highlight.js", "styles", src);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(vendorDir, dest));
  }
}

// KaTeX: stylesheet + fonts (OFL-1.1). The CSS references fonts/ relatively,
// so we mirror that structure under src/vendor/.
const katexCss = path.join(root, "node_modules", "katex", "dist", "katex.min.css");
if (fs.existsSync(katexCss)) {
  fs.copyFileSync(katexCss, path.join(vendorDir, "katex.css"));
  const fontsSrc = path.join(root, "node_modules", "katex", "dist", "fonts");
  const fontsDest = path.join(vendorDir, "fonts");
  fs.mkdirSync(fontsDest, { recursive: true });
  for (const name of fs.readdirSync(fontsSrc)) {
    fs.copyFileSync(path.join(fontsSrc, name), path.join(fontsDest, name));
  }
}

console.log("Vendor assets copied to src/vendor/");
