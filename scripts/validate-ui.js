const fs = require('fs');

const html = fs.readFileSync('wwwroot/index.html', 'utf8');
const js = fs.readFileSync('wwwroot/js/app2.js', 'utf8');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

if (duplicates.length) {
  fail('IDs duplicados no index.html: ' + duplicates.join(', '));
}

const staticIdRefs = [
  ...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g),
  ...js.matchAll(/\$\$\('#([A-Za-z0-9_-]+)'\)/g)
].map(match => match[1]);

const missingIds = [...new Set(staticIdRefs.filter(id => !ids.includes(id)))];

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

console.log('UI references ok');
console.log('Unique IDs ok');
console.log('Selector collections ok');
