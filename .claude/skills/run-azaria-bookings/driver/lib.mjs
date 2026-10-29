// Shared helpers for driving the Expo web app with playwright-core and the system Chrome.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const APP = process.env.APP_URL ?? 'http://localhost:8081';
export const OUT = process.env.OUT ?? '/tmp/azaria-run';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';

fs.mkdirSync(`${OUT}/shots`, { recursive: true });
fs.mkdirSync(`${OUT}/profiles`, { recursive: true });

// React Navigation keeps earlier stack screens mounted but hidden (e.g. Login under Register),
// so plain getByLabel/getByText can match an invisible copy. Match visible elements only.
export const field = (page, label) => page.locator(`[aria-label="${label}"]:visible`).first();
export const seen = (page, text) => page.locator(`:text("${text}"):visible`).first();
// getByRole already skips hidden elements.
export const button = (page, name) => page.getByRole('button', { name, exact: true });

/** Opens a page for a role; its localStorage (JWTs) is kept in OUT/profiles/<role>.json between runs. */
export async function open(role, { width = 1280, height = 900 } = {}) {
  const state = `${OUT}/profiles/${role}.json`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    acceptDownloads: true,
    ...(fs.existsSync(state) ? { storageState: state } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  // The app's confirm dialogs use window.confirm on web.
  page.on('dialog', (d) => d.accept());
  let n = 0;
  return {
    page,
    async shot(name) {
      n += 1;
      const file = `${OUT}/shots/${role}-${String(n).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log('shot', file);
    },
    async close() {
      await context.storageState({ path: state });
      // Expected 4xx responses (e.g. a refused action) are logged by the browser as errors too.
      if (errors.length) console.log('console errors:', JSON.stringify(errors));
      await browser.close();
    },
  };
}

/** Runs steps for a role, always saving the session; on failure takes a FAILED screenshot and exits 1. */
export async function run(role, steps, options) {
  const session = await open(role, options);
  try {
    await steps(session);
  } catch (error) {
    await session.shot('FAILED').catch(() => {});
    console.log('FAILED:', error.message.split('\n')[0]);
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

/** Signs in through the Login screen unless the saved session is still valid. */
export async function signIn(page, email, password) {
  await page.goto(`${APP}/login`);
  await page.waitForTimeout(1500);
  if (!page.url().includes('/login')) return;
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill(password);
  await button(page, 'Sign in').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
