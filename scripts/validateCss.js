import fs from 'fs';

const files = ['public/css/style.css', 'public/css/admin.css', 'public/css/admin-login.css'];

let totalErrors = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`Skipping non-existent: ${file}`);
    continue;
  }
  console.log(`\nValidating ${file}...`);
  const content = fs.readFileSync(file, 'utf8');
  let openBraces = 0;
  let inComment = false;
  let inString = false;
  let stringChar = '';
  let lineNum = 1;
  const errors = [];
  const braceStack = [];

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '\n') lineNum++;

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === stringChar && content[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      inComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      openBraces++;
      braceStack.push(lineNum);
    }
    if (ch === '}') {
      openBraces--;
      if (openBraces < 0) {
        errors.push(`Line ${lineNum}: Unexpected closing brace '}'`);
        openBraces = 0;
      } else {
        braceStack.pop();
      }
    }
  }

  if (openBraces > 0) {
    errors.push(`Unclosed '{' opened on lines: ${braceStack.join(', ')}`);
  }
  if (inComment) {
    errors.push(`Unclosed comment '/*'`);
  }
  if (inString) {
    errors.push(`Unclosed string quote ${stringChar}`);
  }

  if (errors.length === 0) {
    console.log(`✅ ${file}: 0 syntax errors! Perfect balance of all braces, quotes and comments.`);
  } else {
    console.error(`❌ ${file} has errors:`);
    errors.forEach(e => console.error('  ', e));
    totalErrors += errors.length;
  }
}

if (totalErrors === 0) {
  console.log('\n🎉 ALL CSS FILES VALIDATED CLEANLY WITH 0 SYNTAX ERRORS!');
  process.exit(0);
} else {
  console.error(`\n💥 FOUND ${totalErrors} CSS SYNTAX ERRORS!`);
  process.exit(1);
}
