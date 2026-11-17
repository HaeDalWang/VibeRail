'use strict';

// Review warning (never a block): a type or class name this work added that GLOSSARY.md
// does not define. Silent when the project has no GLOSSARY.md (upstream makes it lazily).
// ponytail: PascalCase declarations only (class/interface/type/enum/struct/record); other
// shapes of domain names wait until a project shows they matter.

const fs = require('node:fs');
const path = require('node:path');
const { isOwnCode, TEST_FILE, TOOL_FILE } = require('./policy');
const { addedLines } = require('./card');

const GLOSSARY = 'GLOSSARY.md';
const DECLARATION = /\b(?:class|interface|type|enum|struct|record)\s+([A-Z][A-Za-z0-9]*)\b/g;
// "OrderItem" is defined as "Order Item", "order-item" or itself.
const spellings = (name) => {
  const words = name.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) || [name];
  return [name.toLowerCase(), words.join(' ').toLowerCase(), words.join('-').toLowerCase()];
};

function glossaryWarnings(root, { changed, base }) {
  const file = path.join(root, GLOSSARY);
  if (!fs.existsSync(file)) return [];
  const glossary = fs.readFileSync(file, 'utf8').toLowerCase();
  const found = new Map();
  for (const f of changed.filter((x) => isOwnCode(x) && !TEST_FILE.test(x) && !TOOL_FILE.test(x) && fs.existsSync(path.join(root, x)))) {
    for (const line of addedLines(root, base, f)) {
      for (const m of line.matchAll(DECLARATION)) if (!found.has(m[1])) found.set(m[1], f);
    }
  }
  return [...found].filter(([name]) => !spellings(name).some((s) => glossary.includes(s)))
    .map(([name, f]) => `용어집: ${f}에 새 이름 ${name}이 생겼는데 ${GLOSSARY}에 없다 → 도메인 용어면 domain-modeling으로 용어집에 넣고, 아니면 무시 (막지 않음)`);
}

module.exports = { glossaryWarnings };
