import fs from 'fs';

const content = fs.readFileSync('./src/components/layout/sftp-panel.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for imports in sftp-panel.tsx...");
lines.slice(0, 50).forEach((line, idx) => {
  if (line.includes('import')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
