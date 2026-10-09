// 📝 The shared libraries the bundled Chromium needs (NSS, NSPR, expat).
//
// @sparticuz/chromium ships them in bin/al2023.tar.br but unpacks them, and
// points LD_LIBRARY_PATH at them, only when it detects AWS Lambda — and
// once /tmp/chromium exists it unpacks nothing more. On Railway neither
// happened: three live summaries (2026-10-09) were written in full and
// then failed with "libnspr4.so: cannot open shared object file", the
// second time after setting the variable the package looks for. So the
// pack is unpacked here, by us, and its folder handed to the browser
// explicitly (lib/summary/pdf.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

// Regular files of a tar archive held in memory (ustar: 512-byte headers,
// the name in the first 100 bytes, the size in octal at 124, the type at
// 156; content padded to 512). Enough for a flat pack of library files.
export function tarFiles(archive: Buffer): { name: string; data: Buffer }[] {
  const files: { name: string; data: Buffer }[] = [];
  const field = (start: number, length: number) =>
    archive
      .toString("utf8", start, start + length)
      .replace(/\0[\s\S]*$/, "")
      .trim();
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const name = field(offset, 100);
    if (!name) break;
    const size = parseInt(field(offset + 124, 12), 8) || 0;
    const type = field(offset + 156, 1);
    if (type === "" || type === "0") {
      files.push({
        name,
        data: archive.subarray(offset + 512, offset + 512 + size),
      });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

// Unpacks the pack into `target` (once per container) and returns the
// folder holding the .so files. `packPath` is for tests.
export function unpackChromiumLibs(
  target = path.join(os.tmpdir(), "nirolearn-chromium-libs"),
  packPath = bundledPackPath()
): string {
  const lib = path.join(target, "lib");
  const marker = path.join(target, ".complete");
  if (fs.existsSync(marker)) return lib;
  const files = tarFiles(zlib.brotliDecompressSync(fs.readFileSync(packPath)));
  for (const file of files) {
    // Only plain names under the pack's own folders: nothing may be
    // written outside `target`.
    const safe = path.normalize(file.name);
    if (path.isAbsolute(safe) || safe.split(path.sep).includes("..")) continue;
    const out = path.join(target, safe);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, file.data, { mode: 0o755 });
  }
  if (!fs.existsSync(path.join(lib, "libnspr4.so"))) {
    throw new Error("The Chromium library pack did not contain libnspr4.so");
  }
  fs.writeFileSync(marker, "");
  return lib;
}

// The package is a direct dependency, external to the server bundle
// (next.config.ts), so it sits in the project's own node_modules at run
// time. A plain path on purpose: the bundler rejects require.resolve() of
// an ESM-only package.
function bundledPackPath(): string {
  return path.join(
    process.cwd(),
    "node_modules",
    "@sparticuz",
    "chromium",
    "bin",
    "al2023.tar.br"
  );
}
