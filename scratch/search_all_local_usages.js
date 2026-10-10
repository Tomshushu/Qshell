import fs from 'fs';

const content = fs.readFileSync('./src/components/layout/sftp-panel.tsx', 'utf8');
const lines = content.split('\n');

const list = ['handleRenameLocal', 'handleCreateFolderLocal', 'handleCreateFileLocal'];
list.forEach(v => {
  console.log(`=== USAGES OF ${v} ===`);
  lines.forEach((line, idx) => {
    if (line.includes(v)) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  });
});
