const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../public/contact.html'),'utf8');
const landing = fs.readFileSync(path.join(__dirname,'../public/decouvrir.html'),'utf8');

test('contact page includes the same footer links as the public landing', () => {
  const footer = html.match(/<footer class="mk-footer lp-footer"[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer,'footer is present');
  for (const href of ['/legal.html#privacy','/legal.html#terms','/legal.html#notice','/legal.html#cookies','/contact.html','/decouvrir.html']) {
    assert.ok(footer.includes(`href="${href}"`),`missing footer link: ${href}`);
    assert.ok(landing.includes(`href="${href}"`),`landing missing matching link: ${href}`);
  }
  assert.ok(footer.includes('href="/decouvrir.html#faq"'),'FAQ points to public page rather than a nonexistent contact anchor');
  assert.ok(footer.includes('aria-current="page"'),'active contact link identified');
});
