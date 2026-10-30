// End-to-end flow in the browser:
// guest searches (no results) -> Request options -> gate -> register -> request sent
// -> admin responds with a custom offer -> customer books it -> admin confirms, marks paid,
// uploads a PDF and a PNG, sends them -> customer downloads both and they match.
//
// Usage: AZARIA_ADMIN_EMAIL=... AZARIA_ADMIN_PASSWORD=... node flow.mjs
// Needs the API, a Celery worker and the web app running (see SKILL.md).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { run, APP, OUT, signIn, field, button, seen } from './lib.mjs';

const ADMIN_EMAIL = process.env.AZARIA_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.AZARIA_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.log('Set AZARIA_ADMIN_EMAIL and AZARIA_ADMIN_PASSWORD (create one with manage.py create_admin).');
  process.exit(2);
}
// A route with no public deals, so Explore shows "Request options". Airports are picked by IATA code.
const [FROM, TO] = (process.env.ROUTE ?? 'NBO-ZNZ').split('-');
const stamp = Date.now();
const CUSTOMER = { email: `flow.${stamp}@example.com`, password: 'Flow-Cust-2026!', name: `Flow Customer ${stamp}` };

const nairobiDate = (days) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(Date.now() + days * 864e5));

// Small but valid files: the API checks extension, content type and the leading bytes.
function boardingPassFiles() {
  const dir = `${OUT}/files`;
  fs.mkdirSync(dir, { recursive: true });
  const text = 'BT /F1 14 Tf 20 100 Td (Boarding pass) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const [w, h] = [120, 60];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([0x0b, 0x5c, 0x8a]).flat())]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const files = { pdf: `${dir}/Passenger one.pdf`, png: `${dir}/Passenger two.png` };
  fs.writeFileSync(files.pdf, pdf);
  fs.writeFileSync(files.png, png);
  return files;
}

async function pickAirport(page, label, code, index = 0) {
  await page.locator(`[aria-label="${label}"]:visible`).nth(index).fill(code);
  await page.getByRole('button', { name: new RegExp(`^${code}\\b`) }).first().click();
}

let queryId;
let bookingId;

console.log('== guest -> register -> request');
await run(`customer-${stamp}`, async ({ page, shot }) => {
  await page.goto(APP);
  await seen(page, 'Find a flight deal').waitFor();
  await pickAirport(page, 'From', FROM);
  await pickAirport(page, 'To', TO);
  await button(page, 'Search').click();
  await seen(page, 'No flight deals match').waitFor();
  await shot('no-results');
  // The gate remembers the action in memory only: sign-up must happen in this same page.
  await button(page, 'Request options').click();
  await page.waitForURL('**/login');
  await button(page, 'New here? Create an account').click();
  await page.waitForURL('**/register');
  await field(page, 'Full name').fill(CUSTOMER.name);
  await field(page, 'Email').fill(CUSTOMER.email);
  await field(page, 'Phone').fill('+254700123456');
  await field(page, 'Password').fill(CUSTOMER.password);
  await button(page, 'Create account').click();
  await seen(page, 'Request flight options').waitFor();
  await shot('request-prefilled');
  await button(page, 'Send request').click();
  await seen(page, 'Options from Azaria Bookings').waitFor();
  queryId = Number(new URL(page.url()).pathname.split('/').pop());
  console.log('request', queryId, 'from', CUSTOMER.email);
});
if (!queryId) process.exit(1);

console.log('== admin responds');
await run('admin', async ({ page, shot }) => {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${APP}/admin/settings`);
  await field(page, 'Payment instructions').waitFor();
  await page.waitForTimeout(800);
  if (!(await field(page, 'Payment instructions').inputValue()).trim()) {
    await field(page, 'Payment instructions').fill('Pay by M-Pesa paybill 000000 (sample instructions from the run skill).');
    await button(page, 'Save settings').click();
    await seen(page, 'Settings saved.').waitFor();
    console.log('payment instructions were empty: saved sample text');
  }
  await page.goto(`${APP}/admin/requests/${queryId}/respond`);
  await seen(page, 'Custom offers').waitFor();
  await page.waitForTimeout(1000);
  // The custom offer form is prefilled with the request's airports.
  await field(page, 'Departure date').fill(nairobiDate(21));
  await field(page, 'Valid until (inclusive)').fill(nairobiDate(10));
  await page.getByRole('radio', { name: 'Economy' }).nth(1).click();
  await field(page, 'Airline').fill('Flow Air');
  await field(page, 'Price per person (USD)').fill('500');
  await field(page, 'Stopovers').fill('0');
  await button(page, 'Add custom offer').click();
  await seen(page, 'Custom:').waitFor();
  await field(page, 'Message to the customer').fill('Option from the run skill flow.');
  await button(page, 'Send response').click();
  await seen(page, 'Responses sent').waitFor();
  await shot('responded');
});

console.log('== customer books');
await run(`customer-${stamp}`, async ({ page, shot }) => {
  await page.goto(`${APP}/requests/${queryId}`);
  await seen(page, 'Option from the run skill flow.').waitFor();
  // Offer cards are links labelled "<city> to <city>, <date>".
  await page.getByRole('link', { name: / to / }).first().click();
  await button(page, 'Book').click();
  await seen(page, 'Book this flight').waitFor();
  await field(page, 'Passengers').fill('2');
  await button(page, 'Request booking').click();
  await seen(page, 'Timeline').waitFor();
  bookingId = Number(new URL(page.url()).pathname.split('/').pop());
  await shot('booking-requested');
  console.log('booking', bookingId);
});
if (!bookingId) process.exit(1);

const files = boardingPassFiles();
console.log('== admin confirms, marks paid, uploads and sends');
await run('admin', async ({ page, shot }) => {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${APP}/admin/bookings/${bookingId}`);
  await button(page, 'Confirm availability').click();
  await seen(page, 'Payment due by').waitFor();
  await button(page, 'Mark paid').click();
  await seen(page, 'Add files').waitFor();
  await page.locator('input[type=file]').setInputFiles([files.pdf, files.png]);
  await seen(page, 'Passenger two.png').waitFor();
  await shot('passes-uploaded');
  await button(page, 'Send boarding passes').click();
  await seen(page, 'Boarding passes sent').waitFor();
  await shot('completed');
});

console.log('== customer downloads');
await run(`customer-${stamp}`, async ({ page, shot }) => {
  await page.goto(`${APP}/bookings/${bookingId}`);
  await seen(page, 'We have also emailed these to you.').waitFor();
  await shot('customer-completed');
  for (const [index, file] of [files.pdf, files.png].entries()) {
    const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Download').nth(index).click()]);
    const same = Buffer.compare(fs.readFileSync(await download.path()), fs.readFileSync(file)) === 0;
    if (!same) throw new Error(`${download.suggestedFilename()} differs from the uploaded file`);
    console.log('downloaded', download.suggestedFilename(), '- matches upload');
  }
});
console.log(process.exitCode ? 'FLOW FAILED' : `FLOW OK (request ${queryId}, booking ${bookingId})`);
