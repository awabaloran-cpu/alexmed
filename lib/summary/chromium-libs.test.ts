import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { tarFiles, unpackChromiumLibs } from "./chromium-libs";

// One tar entry: a 512-byte header and the content padded to 512.
function entry(name: string, content: string, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(Buffer.byteLength(content).toString(8).padStart(11, "0"), 124);
  header.write(type, 156);
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512);
  body.write(content);
  return Buffer.concat([header, body]);
}
const tar = (...entries: Buffer[]) =>
  Buffer.concat([...entries, Buffer.alloc(1024)]);

const made: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nl-libs-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("tarFiles", () => {
  it("reads the regular files of an archive, with their exact content", () => {
    const files = tarFiles(
      tar(
        entry("lib/", "", "5"),
        entry("lib/a.so", "AAAA"),
        entry("lib/b.so", "x".repeat(600))
      )
    );
    expect(files.map(f => [f.name, f.data.length])).toEqual([
      ["lib/a.so", 4],
      ["lib/b.so", 600],
    ]);
    expect(files[0].data.toString()).toBe("AAAA");
  });
});

describe("unpackChromiumLibs", () => {
  const pack = (dir: string, archive: Buffer) => {
    const file = path.join(dir, "pack.tar.br");
    fs.writeFileSync(file, zlib.brotliCompressSync(archive));
    return file;
  };

  it("unpacks the pack once and returns the folder of libraries", () => {
    const dir = temp();
    const file = pack(
      dir,
      tar(entry("lib/libnspr4.so", "NSPR"), entry("lib/libnss3.so", "NSS"))
    );
    const target = path.join(dir, "out");

    const lib = unpackChromiumLibs(target, file);
    expect(lib).toBe(path.join(target, "lib"));
    expect(fs.readFileSync(path.join(lib, "libnspr4.so"), "utf8")).toBe("NSPR");
    expect(fs.readdirSync(lib).sort()).toEqual(["libnspr4.so", "libnss3.so"]);

    // A second call does not read the pack again.
    fs.rmSync(file);
    expect(unpackChromiumLibs(target, file)).toBe(lib);
  });

  it("never writes outside its folder, and fails loudly on a pack without the library", () => {
    const dir = temp();
    const target = path.join(dir, "out");
    const file = pack(
      dir,
      tar(entry("../escaped.so", "bad"), entry("lib/other.so", "x"))
    );
    expect(() => unpackChromiumLibs(target, file)).toThrow(/libnspr4/);
    expect(fs.existsSync(path.join(dir, "escaped.so"))).toBe(false);
    // Not marked complete: the next call tries again.
    expect(fs.existsSync(path.join(target, ".complete"))).toBe(false);
  });

  it("unpacks the real pack shipped with the browser package", () => {
    const lib = unpackChromiumLibs(path.join(temp(), "real"));
    const names = fs.readdirSync(lib);
    expect(names).toEqual(
      expect.arrayContaining([
        "libnspr4.so",
        "libnss3.so",
        "libnssutil3.so",
        "libexpat.so.1",
      ])
    );
    expect(fs.statSync(path.join(lib, "libnspr4.so")).size).toBeGreaterThan(
      100_000
    );
  });
});
