// Usage: node shot.mjs <role> <path> [width]
// Screenshots APP<path> as <role> ("guest" = never signed in) and reports horizontal overflow.
import { run, APP } from './lib.mjs';

const [role = 'guest', path = '/', width = '1280'] = process.argv.slice(2);
await run(
  role,
  async ({ page, shot }) => {
    await page.goto(`${APP}${path}`);
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`final url ${page.url()}; horizontal overflow ${overflow}px`);
    await shot(`${width}${path.replace(/[^a-z0-9]+/gi, '-')}`);
  },
  { width: Number(width), height: 900 },
);
