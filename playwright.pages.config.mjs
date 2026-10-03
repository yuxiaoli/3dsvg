import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pages',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173/3dsvg/',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    // The vendor-packaged Chrome channel has a usable sandbox on Ubuntu 24.
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'],
      // Use ANGLE's software driver in GPU-less CI, keeping the sandbox on.
      // Do not enable unsafe WebGL fallback or disable browser security.
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .pages-preview',
    url: 'http://127.0.0.1:4173/3dsvg/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
