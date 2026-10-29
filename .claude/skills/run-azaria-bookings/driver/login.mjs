// Usage: node login.mjs <role> <email> <password>
// Saves a signed-in session as OUT/profiles/<role>.json for shot.mjs and your own scripts.
import { run, signIn } from './lib.mjs';

const [role, email, password] = process.argv.slice(2);
if (!role || !email || !password) {
  console.log('usage: node login.mjs <role> <email> <password>');
  process.exit(2);
}
await run(role, async ({ page }) => {
  await signIn(page, email, password);
  console.log(`${role} signed in, now at ${page.url()}`);
});
