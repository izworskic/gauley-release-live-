import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
assert.match(html,/G-Y5D2V2W7HN/,'GA4 measurement ID missing from built HTML');
assert.match(html,/https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-Y5D2V2W7HN/,'GA4 loader missing');
assert.match(html,/https:\/\/chrisizworski\.com\/national-tools\/gauley-release-live\//,'canonical public route missing');
assert.match(html,/getJSON\('\.\/api\/live'\)/,'mounted live API path is not relative');
assert.match(html,/getJSON\('\.\/api\/history'\)/,'mounted history API path is not relative');
console.log('analytics/public-route gate: PASS');
