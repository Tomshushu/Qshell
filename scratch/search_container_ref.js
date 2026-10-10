import fs from 'fs';

const content = fs.readFileSync('./src/components/layout/sftp-panel.tsx', 'utf8');
const lines = content.split('\n');

console.log("Searching for containerRef in sftp-panel.tsx...");
lines.forEach((line, idx) => {
  if (line.includes('containerRef')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
