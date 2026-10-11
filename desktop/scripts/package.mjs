import { packager } from "@electron/packager";
import {
  mkdtemp,
  cp,
  rm,
  mkdir,
  readFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const temp = await mkdtemp(path.join(tmpdir(), "backstage-package-"));
try {
  const service = path.join(temp, "song-converter");
  await mkdir(service, { recursive: true });
  for (const file of ["run.py", "requirements.txt"])
    await cp(path.resolve("../song-converter", file), path.join(service, file));
  await cp(
    path.resolve("../song-converter/songmaker"),
    path.join(service, "songmaker"),
    {
      recursive: true,
      filter: (source) =>
        !source.includes("__pycache__") && !source.includes(".pyc"),
    },
  );
  // Ship editable sources for the adapted LGPL modules and licenses for bundled JS.
  const licensedSource = path.join(temp, "licensed-source");
  await mkdir(licensedSource, { recursive: true });
  for (const file of [
    "src/core/judgment.ts",
    "src/core/timeline.ts",
    "src/types.ts",
    "electron/chart.cjs",
  ]) {
    const target = path.join(licensedSource, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(file, target);
  }
  await mkdir("licenses/dependencies", { recursive: true });
  for (const name of [
    "react",
    "react-dom",
    "three",
    "@tonejs/midi",
    "midi-file",
  ]) {
    const source = path.join("node_modules", name);
    for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
      try {
        await cp(
          path.join(source, file),
          path.join(
            "licenses/dependencies",
            name.replaceAll("/", "-") + ".txt",
          ),
        );
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const output = await packager({
    dir: process.cwd(),
    name: "Backstage",
    appBundleId: "com.backstage.rhythm",
    appVersion: "0.2.0",
    extendInfo: {
      NSCameraUsageDescription:
        "Backstage uses the camera only to take your avatar photo. Photos stay on this computer.",
    },
    ...(process.platform === "darwin" ? { icon: "public/Backstage.icns" } : {}),
    out: "release",
    overwrite: true,
    // The Riffmaster reader runs as plain Node with administrator rights, so
    // it and the native usb module must be real files outside the archive.
    asar: {
      unpack:
        "{**/node_modules/usb/**,**/node_modules/node-gyp-build/**,**/node_modules/node-addon-api/**,**/electron/riff/**}",
    },
    prune: true,
    platform: process.platform,
    arch: process.arch,
    ignore: [
      /^\/src($|\/)/,
      /^\/tests($|\/)/,
      /^\/scripts($|\/)/,
      /^\/public($|\/)/,
      /^\/release($|\/)/,
      /^\/test-results($|\/)/,
      /^\/playwright-report($|\/)/,
      /^\/AGENTS\.md$/,
      /^\/tsconfig\.json$/,
      /^\/package-lock\.json$/,
      /^\/node_modules\/(three|react|react-dom|scheduler)($|\/)/,
      /^\/node_modules\/\.(vite|cache|bin)($|\/)/,
      /^\/node_modules\/\.package-lock\.json$/,
    ],
    extraResource: [service, licensedSource],
  });
  for (const folder of output) {
    if (process.platform === "darwin")
      execFileSync(
        "codesign",
        [
          "--force",
          "--deep",
          "--sign",
          "-",
          path.join(folder, "Backstage.app"),
        ],
        { stdio: "inherit" },
      );
    if (process.platform === "darwin")
      execFileSync(
        "codesign",
        ["--verify", "--deep", "--strict", path.join(folder, "Backstage.app")],
        { stdio: "inherit" },
      );
    console.log("Packaged:", folder);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
