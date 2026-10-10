import fs from 'fs';

const logPath = 'C:\\Users\\15249\\.gemini\\antigravity-cli\\brain\\9b4b6644-b4bc-436c-9709-1f96dccc60fe\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.error("Log file not found!");
  process.exit(1);
}

const fileContent = fs.readFileSync(logPath, 'utf8');
const lines = fileContent.split('\n');

lines.forEach((line, idx) => {
  if (line.trim().length === 0) return;
  try {
    const obj = JSON.parse(line);
    if (obj.tool_calls) {
      obj.tool_calls.forEach(tc => {
        if (tc.name === 'write_to_file' || tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') {
          if (tc.args && tc.args.TargetFile && tc.args.TargetFile.includes('sftp-panel.tsx')) {
            console.log(`Step ${obj.step_index}: Tool ${tc.name}`);
            if (tc.args.ReplacementContent) {
              console.log("REPLACEMENT CONTENT PREVIEW:", tc.args.ReplacementContent.substring(0, 300));
            }
            if (tc.args.CodeContent) {
              console.log("CODE CONTENT PREVIEW:", tc.args.CodeContent.substring(0, 300));
            }
          }
        }
      });
    }
  } catch (err) {
  }
});
