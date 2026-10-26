export interface ParsedPyFunction {
  name: string;
  startLine: number;
  headerEndLine: number;
  endLine: number;
  indent: number;
  params: string[];
  rawParams: string;
  bodyLines: { lineNo: number; indent: number; raw: string; code: string }[];
}

export function stripPyCommentsAndStrings(line: string): string {
  // Replace string literals with harmless placeholders while preserving structure
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && (inSingle || inDouble)) {
      i += 2;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      out += "'";
      i++;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      out += '"';
      i++;
      continue;
    }
    if (!inSingle && !inDouble && ch === '#') {
      break;
    }
    out += inSingle || inDouble ? ' ' : ch;
    i++;
  }
  return out.trim();
}

export function getIndentSpaces(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

export function checkPythonSyntax(source: string): { line: number; message: string } | null {
  const lines = source.split(/\r?\n/);
  const stack: { char: string; line: number }[] = [];
  let inTripleSingle = false;
  let inTripleDouble = false;
  let tripleStartLine = 1;

  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];
    let i = 0;
    let inSingle = false;
    let inDouble = false;

    while (i < line.length) {
      if (inTripleSingle) {
        if (line.slice(i, i + 3) === "'''") {
          inTripleSingle = false;
          i += 3;
          continue;
        }
        i++;
        continue;
      }
      if (inTripleDouble) {
        if (line.slice(i, i + 3) === '"""') {
          inTripleDouble = false;
          i += 3;
          continue;
        }
        i++;
        continue;
      }
      const ch = line[i];
      if (ch === '\\' && (inSingle || inDouble)) {
        i += 2;
        continue;
      }
      if (!inSingle && !inDouble) {
        if (line.slice(i, i + 3) === "'''") {
          inTripleSingle = true;
          tripleStartLine = lineNo;
          i += 3;
          continue;
        }
        if (line.slice(i, i + 3) === '"""') {
          inTripleDouble = true;
          tripleStartLine = lineNo;
          i += 3;
          continue;
        }
        if (ch === '#') break;
        if (ch === '(' || ch === '[' || ch === '{') {
          stack.push({ char: ch, line: lineNo });
        } else if (ch === ')' || ch === ']' || ch === '}') {
          const top = stack.pop();
          if (!top || top.char !== pairs[ch]) {
            return { line: lineNo, message: `Unmatched closing '${ch}'` };
          }
        }
      }
      if (!inDouble && ch === "'") inSingle = !inSingle;
      else if (!inSingle && ch === '"') inDouble = !inDouble;
      i++;
    }

    if (inSingle || inDouble) {
      if (!line.trimEnd().endsWith('\\')) {
        return { line: lineNo, message: 'Unterminated string literal' };
      }
    }
  }

  if (inTripleSingle || inTripleDouble) {
    return { line: tripleStartLine, message: 'Unterminated triple-quoted string literal' };
  }
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return { line: unclosed.line, message: `Unclosed '${unclosed.char}' delimiter` };
  }

  // Check single-line def/class missing trailing colon when parens are balanced on that line
  for (let idx = 0; idx < lines.length; idx++) {
    const code = stripPyCommentsAndStrings(lines[idx]);
    if (/^(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*(?:->\s*[^:]+)?$/.test(code)) {
      return { line: idx + 1, message: "Expected ':' at end of function definition" };
    }
  }

  return null;
}

export function parsePythonFunctions(source: string): ParsedPyFunction[] {
  const lines = source.split(/\r?\n/);
  const functions: ParsedPyFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = raw.match(/^([ \t]*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!match) continue;

    const funcIndent = getIndentSpaces(raw);
    const funcName = match[2];
    const startLine = i + 1;

    // Collect full signature until balanced parens + colon
    let sigText = '';
    let headerEndIdx = i;
    let parenDepth = 0;
    let startedParens = false;

    for (let j = i; j < lines.length; j++) {
      const cleanLine = stripPyCommentsAndStrings(lines[j]);
      sigText += (j === i ? '' : ' ') + lines[j].trim();
      for (const ch of cleanLine) {
        if (ch === '(') {
          parenDepth++;
          startedParens = true;
        } else if (ch === ')') {
          parenDepth--;
        }
      }
      headerEndIdx = j;
      if (startedParens && parenDepth <= 0 && cleanLine.endsWith(':')) {
        break;
      }
    }

    // Extract raw parameter text inside outer parentheses
    const openIdx = sigText.indexOf('(');
    let closeIdx = sigText.lastIndexOf(')');
    if (closeIdx < openIdx) closeIdx = sigText.length;
    const rawParams = openIdx >= 0 ? sigText.slice(openIdx + 1, closeIdx) : '';

    const params = splitTopLevelParams(rawParams)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== '/' && p !== '*');

    // Collect indented body lines belonging to this function
    const bodyLines: { lineNo: number; indent: number; raw: string; code: string }[] = [];
    let endLine = headerEndIdx + 1;

    for (let k = headerEndIdx + 1; k < lines.length; k++) {
      const bRaw = lines[k];
      const bTrim = bRaw.trim();
      if (!bTrim || bTrim.startsWith('#')) {
        continue;
      }
      const bIndent = getIndentSpaces(bRaw);
      if (bIndent <= funcIndent) {
        // Handle closing multiline literals/decorators? If <= funcIndent, block ended
        break;
      }
      endLine = k + 1;
      bodyLines.push({
        lineNo: k + 1,
        indent: bIndent,
        raw: bRaw,
        code: stripPyCommentsAndStrings(bRaw),
      });
    }

    functions.push({
      name: funcName,
      startLine,
      headerEndLine: headerEndIdx + 1,
      endLine,
      indent: funcIndent,
      params,
      rawParams,
      bodyLines,
    });
  }

  return functions;
}

function splitTopLevelParams(rawParams: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;

  for (const ch of rawParams) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;

    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}
