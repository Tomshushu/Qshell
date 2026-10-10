import fs from 'fs';

const content = fs.readFileSync('./src/components/layout/sftp-panel.tsx', 'utf8');
const lines = content.split('\n');

console.log("Printing lines 300 to 450 of sftp-panel.tsx:");
for (let i = 299; i < 450; i++) {
  if (i < lines.length) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}
