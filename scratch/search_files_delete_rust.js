import fs from 'fs';

const content = fs.readFileSync('./src-tauri/src/commands/files.rs', 'utf8');
const lines = content.split('\n');

console.log("Searching for files_delete in Rust files.rs...");
lines.forEach((line, idx) => {
  if (line.includes('pub async fn files_delete') || line.includes('files_delete')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
    // Print next 30 lines
    for (let i = 1; i <= 30; i++) {
      if (lines[idx + i]) console.log(`   ${lines[idx + i].trim()}`);
    }
  }
});
