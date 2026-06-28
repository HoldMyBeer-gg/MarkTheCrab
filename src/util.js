// Pure, side-effect-free helpers shared between the app and its tests.
//
// Everything here is deliberately free of DOM, Tauri, and module state so it
// can be unit-tested without a browser or simulator. The point is to lock the
// desktop/mobile branching and the path/URL logic so iOS work can't silently
// change desktop behavior.

// The single source of truth for "is this a mobile target." Desktop
// (macos/windows/linux), the browser demo, and the "desktop" fallback must
// all return false so they keep taking the desktop code paths.
export function isMobilePlatform(name) {
  return name === "ios" || name === "android";
}

// Directory portion of a path, honoring Windows backslashes only when the
// path has no forward slashes (so mixed separators don't misfire).
export function parentDir(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

// Join a base dir and a relative path with the dir's own separator.
export function joinPath(dir, rel) {
  const useBackslash = dir.includes("\\") && !dir.includes("/");
  const sep = useBackslash ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  const cleanedRel = rel.replace(/^[\\/]+/, "");
  return `${trimmed}${sep}${cleanedRel}`;
}

// Wrap URLs that contain spaces/parens in CommonMark's `<...>` form so they
// survive the `[alt](url)` syntax. Clean URLs pass through untouched to avoid
// double-encoding pre-encoded remote links.
export function encodeMarkdownUrl(url) {
  if (!url) return "";
  if (/[\s()<>]/.test(url)) {
    return `<${url.replace(/[<>]/g, "")}>`;
  }
  return url;
}

// Re-base a stored absolute path onto the live Documents directory. iOS
// rotates the sandbox container UUID on reinstall, so the prefix before
// "/Documents/" goes stale while the tail stays stable. Returns the original
// path unchanged when it has no Documents segment.
export function rebaseDocumentsPath(storedPath, liveDir) {
  const marker = "/Documents/";
  const idx = storedPath.lastIndexOf(marker);
  if (idx === -1) return storedPath;
  return `${liveDir.replace(/\/+$/, "")}/${storedPath.slice(idx + marker.length)}`;
}

// base64-encode bytes in chunks so large images don't blow btoa's argument
// limit via String.fromCharCode(...).
export function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
