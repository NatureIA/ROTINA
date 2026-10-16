const fs = require('fs');

const html = fs.readFileSync('wwwroot/index.html', 'utf8');
const js = fs.readFileSync('wwwroot/js/app2.js', 'utf8');
const serviceWorker = fs.readFileSync('wwwroot/service-worker.js', 'utf8');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const dynamicIds = [...js.matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g)].map(match => match[1]);
const knownIds = [...new Set([...ids, ...dynamicIds])];
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

if (duplicates.length) {
  fail('IDs duplicados no index.html: ' + duplicates.join(', '));
}

const staticIdRefs = [
  ...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g),
  ...js.matchAll(/\$\$\('#([A-Za-z0-9_-]+)'\)/g)
].map(match => match[1]);

const missingIds = [...new Set(staticIdRefs.filter(id => !knownIds.includes(id)))];

if (missingIds.length) {
  fail('IDs referenciados no app2.js mas ausentes no index.html: ' + missingIds.join(', '));
}

const invalidCollectionLines = js
  .split(/\r?\n/)
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(item => /(?<!\$)\$\([^)]*\)\.forEach/.test(item.line));

if (invalidCollectionLines.length) {
  fail(
    'Uso de querySelector único com forEach:\n' +
    invalidCollectionLines.map(item => item.number + ': ' + item.line.trim()).join('\n')
  );
}

const invalidSelectorHelpers = js
  .split(/\r?\n/)
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(item => /\$\$\$\s*\(/.test(item.line));

if (invalidSelectorHelpers.length) {
  fail(
    'Helper de seletor inválido encontrado (use $ ou $, nunca $$):\n' +
    invalidSelectorHelpers.map(item => item.number + ': ' + item.line.trim()).join('\n')
  );
}

console.log('UI references ok');
console.log('Unique IDs ok');
console.log('Selector collections ok');


const versionedPwaAssets = [
  ...html.matchAll(/(?:src|href)=["'](\/(?:js\/app2\.js|css\/routine2\.css)\?v=[^"']+)["']/g)
].map(match => match[1]);

if (versionedPwaAssets.length < 2) {
  fail('Não foi possível localizar os assets versionados principais do PWA no index.html.');
}

const missingFromServiceWorker = versionedPwaAssets.filter(asset => !serviceWorker.includes("'" + asset + "'"));

if (missingFromServiceWorker.length) {
  fail('Assets do index.html ausentes ou com versão diferente no Service Worker: ' + missingFromServiceWorker.join(', '));
}

console.log('PWA asset versions ok');
