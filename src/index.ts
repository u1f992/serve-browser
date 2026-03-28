import {
  type Browser,
  type BrowserPlatform,
  CDP_WEBSOCKET_ENDPOINT_REGEX,
  type Process,
  WEBDRIVER_BIDI_WEBSOCKET_ENDPOINT_REGEX,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  launch,
  resolveBuildId,
} from "@puppeteer/browsers";
// @ts-expect-error no type definitions
import ProgressBar from "progress";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const browserEnumMap = {
  chrome: "chrome" as Browser.CHROME,
  chromium: "chromium" as Browser.CHROMIUM,
  firefox: "firefox" as Browser.FIREFOX,
} as const satisfies { [key: string]: Browser };

const platformEnumMap = {
  linux: "linux" as BrowserPlatform.LINUX,
  linux_arm: "linux_arm" as BrowserPlatform.LINUX_ARM,
  mac: "mac" as BrowserPlatform.MAC,
  mac_arm: "mac_arm" as BrowserPlatform.MAC_ARM,
  win32: "win32" as BrowserPlatform.WIN32,
  win64: "win64" as BrowserPlatform.WIN64,
} as const satisfies { [key: string]: BrowserPlatform };

type Platform = keyof typeof platformEnumMap;

export type BrowserType = keyof typeof browserEnumMap;

export const browserTypes: readonly BrowserType[] = Object.keys(
  browserEnumMap,
) as BrowserType[];

export function isBrowserType(value: string): value is BrowserType {
  return value in browserEnumMap;
}

export type Options = {
  browser: BrowserType;
  tag?: string | undefined;
  port?: number | undefined;
  args?: string[] | undefined;
  bindAddress?: string | undefined;
  handleAbortion?: boolean | undefined;
  onDownloadProgress?:
    | ((downloadedBytes: number, totalBytes: number) => void)
    | undefined;
};

export interface ServedBrowser extends AsyncDisposable {
  readonly wsEndpoint: string;
}

function toMegabytes(bytes: number): string {
  const mb = bytes / 1000 / 1000;
  return `${Math.round(mb * 10) / 10} MB`;
}

/**
 * Partial copy of Puppeteer's internal `makeProgressCallback` to allow
 * choosing between stdout and stderr as the output stream.
 *
 * @see https://github.com/puppeteer/puppeteer/blob/browsers-v2.13.0/packages/browsers/src/install.ts#L626
 */
export function createProgressCallback(
  browser: BrowserType,
  buildId: string,
  output: "stdout" | "stderr",
): (downloadedBytes: number, totalBytes: number) => void {
  const stream = output === "stdout" ? process.stdout : process.stderr;
  let progressBar: InstanceType<typeof ProgressBar> | undefined;
  let lastDownloadedBytes = 0;
  return (downloadedBytes: number, totalBytes: number) => {
    if (!progressBar) {
      progressBar = new ProgressBar(
        `Downloading ${browser} ${buildId} - ${toMegabytes(totalBytes)} [:bar] :percent :etas `,
        {
          complete: "=",
          incomplete: " ",
          width: 20,
          total: totalBytes,
          stream,
        },
      );
    }
    const delta = downloadedBytes - lastDownloadedBytes;
    lastDownloadedBytes = downloadedBytes;
    progressBar.tick(delta);
  };
}

function getOsCacheDir(platform: Platform): string {
  switch (platform) {
    case "linux":
    case "linux_arm":
      return process.env["XDG_CACHE_HOME"] || path.join(os.homedir(), ".cache");
    case "mac":
    case "mac_arm":
      return path.join(os.homedir(), "Library", "Caches");
    case "win32":
    case "win64":
      return (
        process.env["LOCALAPPDATA"] ||
        path.join(os.homedir(), "AppData", "Local")
      );
  }
}

function getCacheDir(platform: Platform): string {
  return path.join(getOsCacheDir(platform), "serve-browser");
}

interface BuildIdsCache {
  createdAt: number;
  buildIds: Record<string, Record<string, string>>;
}

async function cachedResolveBuildId(
  browser: Browser,
  platform: Platform,
  tag: string,
  cacheDir: string,
): Promise<string> {
  const cacheDataFilename = path.join(cacheDir, "build-ids.json");
  let cacheData: BuildIdsCache;
  try {
    cacheData = JSON.parse(fs.readFileSync(cacheDataFilename, "utf-8"));
    if (Date.now() - cacheData.createdAt > 24 * 60 * 60 * 1000) {
      cacheData = { createdAt: Date.now(), buildIds: {} };
    }
  } catch {
    cacheData = { createdAt: Date.now(), buildIds: {} };
  }
  const cached = cacheData.buildIds[browser]?.[tag];
  if (cached) {
    return cached;
  }

  const buildId = await resolveBuildId(browser, platformEnumMap[platform], tag);
  (cacheData.buildIds[browser] ??= {})[tag] = buildId;
  fs.mkdirSync(path.dirname(cacheDataFilename), { recursive: true });
  fs.writeFileSync(cacheDataFilename, JSON.stringify(cacheData));
  return buildId;
}

async function ensureBrowser(
  browserType: BrowserType,
  browser: Browser,
  buildId: string,
  cacheDir: string,
  onDownloadProgress:
    | ((downloadedBytes: number, totalBytes: number) => void)
    | undefined,
): Promise<string> {
  const executablePath = computeExecutablePath({
    cacheDir,
    browser,
    buildId,
  });
  if (fs.existsSync(executablePath)) {
    return executablePath;
  }

  const installed = await install({
    cacheDir,
    browser,
    buildId,
    downloadProgressCallback:
      typeof onDownloadProgress === "function"
        ? onDownloadProgress
        : createProgressCallback(browserType, buildId, "stderr"),
  });
  return installed.executablePath;
}

function buildBrowserArgs(
  browserType: BrowserType,
  port: number,
  extraArgs: string[],
): string[] {
  const args: string[] = [];

  if (browserType === "chrome" || browserType === "chromium") {
    args.push(`--remote-debugging-port=${port}`);
  } else {
    // Firefox uses a space-separated flag
    args.push("--remote-debugging-port", String(port));
  }

  args.push(...extraArgs);
  return args;
}

function getWsEndpointRegex(browserType: BrowserType): RegExp {
  if (browserType === "firefox") {
    return WEBDRIVER_BIDI_WEBSOCKET_ENDPOINT_REGEX;
  }
  return CDP_WEBSOCKET_ENDPOINT_REGEX;
}

function isPlatform(value: string): value is Platform {
  return value in platformEnumMap;
}

function requirePlatform(): Platform {
  const platform = detectBrowserPlatform();
  if (typeof platform === "undefined" || !isPlatform(platform)) {
    throw new Error("The current platform is not supported.");
  }
  return platform;
}

export async function uninstallOutdatedBrowser({
  maxAge,
}: {
  maxAge: number;
}): Promise<void> {
  const cacheDir = getCacheDir(requirePlatform());
  await Promise.all(
    Object.values(browserEnumMap).flatMap((browser) => {
      const browsersDir = path.join(cacheDir, browser);
      return !fs.existsSync(browsersDir)
        ? []
        : fs.readdirSync(browsersDir).flatMap((entry) => {
            const entryPath = path.join(browsersDir, entry);
            const stat = fs.statSync(entryPath);
            return stat.isDirectory() && Date.now() - stat.mtimeMs <= maxAge
              ? []
              : [fs.promises.rm(entryPath, { recursive: true, force: true })];
          });
    }),
  );
}

export async function serveBrowser(options: Options): Promise<ServedBrowser> {
  const {
    browser: browserType,
    tag = "latest",
    port = 0,
    args = [],
    bindAddress,
    handleAbortion = false,
    onDownloadProgress,
  } = options;

  const platform = requirePlatform();
  const cacheDir = getCacheDir(platform);
  const browser = browserEnumMap[browserType];
  const buildId = await cachedResolveBuildId(browser, platform, tag, cacheDir);
  const executablePath = await ensureBrowser(
    browserType,
    browser,
    buildId,
    cacheDir,
    onDownloadProgress,
  );

  const internalPort = typeof bindAddress === "string" ? 0 : port;
  const browserArgs = buildBrowserArgs(browserType, internalPort, args);
  const browserProcess: Process = launch({
    executablePath,
    args: browserArgs,
    env: process.env,
    handleSIGINT: handleAbortion,
    handleSIGTERM: handleAbortion,
    handleSIGHUP: handleAbortion,
  });

  const wsEndpointRegex = getWsEndpointRegex(browserType);
  const rawWsEndpoint = await browserProcess.waitForLineOutput(wsEndpointRegex);

  let wsEndpoint = rawWsEndpoint;
  let proxyServer: net.Server | undefined;

  if (typeof bindAddress === "string") {
    const rawUrl = new URL(rawWsEndpoint);
    const targetHost = rawUrl.hostname;
    const targetPort = parseInt(rawUrl.port, 10);

    proxyServer = net.createServer((client) => {
      const target = net.connect(targetPort, targetHost);
      client.pipe(target);
      target.pipe(client);
      client.on("error", () => target.destroy());
      target.on("error", () => client.destroy());
    });

    await new Promise<void>((resolve) => {
      proxyServer!.listen(port, bindAddress, () => resolve());
    });

    const addr = proxyServer.address() as net.AddressInfo;
    rawUrl.hostname = addr.address;
    rawUrl.port = String(addr.port);
    wsEndpoint = rawUrl.href;
  }

  return {
    wsEndpoint,
    async [Symbol.asyncDispose]() {
      proxyServer?.close();
      try {
        await browserProcess.close();
      } catch {
        browserProcess.kill();
      }
    },
  };
}
