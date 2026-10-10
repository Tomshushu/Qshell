import fs from 'fs';

const content = fs.readFileSync('./src/components/layout/sftp-panel.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for split/Split in sftp-panel.tsx...");
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('split')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
