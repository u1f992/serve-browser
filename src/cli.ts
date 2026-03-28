#!/usr/bin/env node

import util from "node:util";

const VERSION = "1.0.0";

const { browser, tag, port, version, help } = util.parseArgs({
  options: {
    browser: { type: "string", short: "b" },
    help: { type: "boolean", short: "h" },
    port: { type: "string", short: "p" },
    tag: { type: "string", short: "t" },
    version: { type: "boolean", short: "v" },
  },
}).values;

if (version) {
  console.log(VERSION);
  process.exit(0);
}

if (help) {
  console.log(`serve-browser [options]

Options:
  -b, --browser
  -h, --help
  -p, --port
  -t, --tag
  -v, --version`);
  process.exit(0);
}

browser;
tag;
port;
