// Usage: node dev-artifacts/build-board.js  (run from repo root)
import { readFileSync, writeFileSync } from 'fs';

const tickets = readFileSync('dev-artifacts/tickets.json', 'utf8');
let html = readFileSync('dev-artifacts/SprintBoard.html', 'utf8');

html = html.replace(
  /\/\* BEGIN_TICKETS \*\/[\s\S]*?\/\* END_TICKETS \*\//,
  `/* BEGIN_TICKETS */ ${tickets} /* END_TICKETS */`
);

writeFileSync('dev-artifacts/SprintBoard.html', html);
console.log('SprintBoard.html updated.');
