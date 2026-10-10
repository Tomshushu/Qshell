import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { ESLint } from "eslint";
import ts from "typescript";

// TypeScript ESLint normally disables core no-undef because tsc is expected to
// catch it. This project uses a solution-style root tsconfig, so an accidental
// undeclared runtime reference could previously pass the regular build.
// Run the rule explicitly. Core no-undef is runtime-oriented and does not know
// TypeScript type space, so type-only identifiers are filtered with the TS AST.

const eslint = new ESLint({
  overrideConfig: {
    rules: {
      "no-undef": "error",
    },
  },
});

const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
const failures = [];

async function isTypeOnlyReference(filePath, line, column) {
  const sourceText = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
  let target;
  const visit = (node) => {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) return;
    target = node;
    node.forEachChild(visit);
  };
  visit(sourceFile);
  for (let node = target; node; node = node.parent) {
    if (ts.isTypeNode(node)) return true;
  }
  return false;
}

for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== "no-undef") continue;
    if (await isTypeOnlyReference(result.filePath, message.line, message.column)) continue;
    failures.push({ result, message });
  }
}

if (failures.length > 0) {
  console.error("\nBlocking undefined runtime references found:\n");
  for (const { result, message } of failures) {
    const file = path.relative(process.cwd(), result.filePath);
    console.error(`  ${file}:${message.line}:${message.column}  ${message.message}`);
  }
  console.error(`\n${failures.length} blocking undefined reference(s).\n`);
  process.exitCode = 1;
} else {
  console.log("Undefined runtime reference check passed.");
}
