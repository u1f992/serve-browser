#!/usr/bin/env node

import util from "node:util";
import {
  browserTypes,
  isBrowserType,
  serveBrowser,
  uninstallOutdatedBrowser,
} from "./index.ts";

const VERSION = "1.0.0";

const {
  values: {
    browser,
    tag,
    port,
    version,
    help,
    "uninstall-outdated-browser": uninstallMaxAge,
  },
  positionals,
} = util.parseArgs({
  options: {
    browser: { type: "string", short: "b" },
    help: { type: "boolean", short: "h" },
    port: { type: "string", short: "p" },
    tag: { type: "string", short: "t" },
    "uninstall-outdated-browser": { type: "string" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
});

if (version) {
  console.log(VERSION);
  process.exit(0);
}

if (help) {
  console.log(`serve-browser [options]

Options:
  -b, --browser                        Browser type (${browserTypes.join(", ")})
  -h, --help                           Show this help
  -p, --port                           Remote debugging port [0 = auto]
  -t, --tag                            Browser version tag [latest]
  --uninstall-outdated-browser MS      Uninstall cached browsers older than MS milliseconds
  -v, --version                        Show version

Arguments after -- are passed directly to the browser process.`);
  process.exit(0);
}

if (typeof uninstallMaxAge === "string") {
  const maxAge = Number(uninstallMaxAge);
  if (Number.isNaN(maxAge)) {
    console.error(
      "Error: --uninstall-outdated-browser requires a number (milliseconds)",
    );
    process.exit(1);
  }
  await uninstallOutdatedBrowser({ maxAge });
  process.exit(0);
}

if (typeof browser !== "string" || !isBrowserType(browser)) {
  console.error(
    `Error: --browser is required and must be one of: ${browserTypes.join(", ")}`,
  );
  process.exit(1);
}

const served = await serveBrowser({
  browser,
  tag,
  port: port !== undefined ? parseInt(port, 10) : undefined,
  args: positionals,
  handleAbortion: true,
});

console.log(served.wsEndpoint);
