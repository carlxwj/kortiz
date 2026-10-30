const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('public landing is crawlable and includes detailed content',()=>{
  const html=read('public/decouvrir.html');
  assert.match(html,/<html lang="fr">/);
  assert.match(html,/<meta[^>]*name="robots"[^>]*content="index,follow|<meta[^>]*content="index,follow[^>]*name="robots"/);
  assert.match(html,/class="mk-faq-list"/);
  assert.equal((html.match(/class="mk-faq-item"/g)||[]).length,7);
  assert.match(html,/href="\/contact\.html"/);
  assert.match(read("public/contact.html"), /mailto:carlxwj@gmail.com/);
  assert.match(html,/href="\/legal\.html#privacy"/);
  assert.match(html,/href="\/\?entry=guide"/);
  assert.doesNotMatch(html,/href="\/\?entry=signup"/);
  assert.match(html,/href="\/\?entry=login"/);
});
test('marketing entrypoints and AdSense ownership verification metadata are preserved',()=>{
  const app=read('public/app.js');
  const rootHtml=read('public/index.html');
  const landing=read('public/decouvrir.html');
  assert.equal((app.match(/function renderPublicLanding\(\)/g)||[]).length,1);
  assert.match(app,/const publicEntry = new URLSearchParams\(location.search\)/);
  assert.match(app,/ACT\["marketing-login"\]/);
  assert.match(app,/ACT\["marketing-signup"\]/);
  assert.match(rootHtml,/google-adsense-account[^>]+ca-pub-4201455737479851/);
  assert.match(landing,/google-adsense-account[^>]+ca-pub-4201455737479851/);
  assert.doesNotMatch(rootHtml,/adsbygoogle\.js/);
  assert.doesNotMatch(landing,/adsbygoogle\.js/);
  assert.match(read('firebase.json'),/pagead2\.googlesyndication\.com/);
});
test('public landing is responsive and found by crawlers',()=>{
  const css=read('public/styles.css');
  assert.match(css,/mk-faq-item/);
  assert.match(css,/mk-contact-panel/);
  assert.match(css,/@media\s*\(max-width:760px\)/);
  assert.match(read('public/robots.txt'),/sitemap\.xml/);
  assert.match(read('public/sitemap.xml'),/decouvrir\.html/);
  const i18n=read('public/i18n.js');
  assert.match(i18n,/Les réponses aux questions fréquentes\./);
});

test('separate offline cache entries prevent landing/legal pages overwriting the app',()=>{
  const sw=read('public/firebase-messaging-sw.js');
  assert.match(sw,/const pageKey = url\.pathname === '\/decouvrir\.html' \? '\/decouvrir\.html'/);
  assert.match(sw,/url\.pathname === '\/legal\.html' \? '\/legal\.html'/);
  assert.match(sw,/caches\.open\(CACHE\)\.then\(\(c\) => c\.put\(pageKey, cp\)\)/);
});
