function parseJsError(error) {
  const message = String(error?.message || "Syntax error");
  const match = message.match(/:(\d+):(\d+)/);
  return {
    ok: false,
    message: message.replace(/^SyntaxError:\s*/i, ""),
    line: match ? Number(match[1]) : null,
    column: match ? Number(match[2]) : null,
  };
}

function parseJsonError(error) {
  const message = String(error?.message || "Invalid JSON");
  const match = message.match(/position (\d+)/i);
  let line = null;
  if (match) {
    const pos = Number(match[1]);
    line = String(error?.source || "").slice(0, pos).split("\n").length;
  }
  return {
    ok: false,
    message: message.replace(/^JSON\.parse:\s*/i, ""),
    line,
    column: null,
  };
}

function checkBalance(code) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  let line = 1;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char === "\n") line += 1;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === stringChar) inString = false;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === "/" && code[index + 1] === "/") {
      while (index < code.length && code[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      index += 2;
      while (index < code.length && !(code[index] === "*" && code[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }

    if (pairs[char]) {
      stack.push({ char, line });
      continue;
    }

    const open = Object.entries(pairs).find(([, close]) => close === char);
    if (open) {
      const last = stack.pop();
      if (!last || last.char !== open[0]) {
        return {
          ok: false,
          message: `Unexpected "${char}"`,
          line,
          column: null,
        };
      }
    }
  }

  if (inString) {
    return { ok: false, message: "Unclosed string", line, column: null };
  }
  if (stack.length) {
    const last = stack[stack.length - 1];
    return {
      ok: false,
      message: `Unclosed "${last.char}"`,
      line: last.line,
      column: null,
    };
  }
  return { ok: true };
}

function lintJavaScript(code, { jsx = false } = {}) {
  const balance = checkBalance(code);
  if (!balance.ok) return balance;

  const stripped = jsx
    ? code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/<[A-Za-z][^>]*\/>/g, "null")
        .replace(/<\/[^>]+>/g, "")
        .replace(/<[A-Za-z][^>]*>/g, "null")
    : code;

  try {
    new Function(stripped);
    return { ok: true };
  } catch (error) {
    return parseJsError(error);
  }
}

export function lintSource(filename, code) {
  const name = String(filename || "").toLowerCase();
  const text = String(code || "");
  if (!text.trim()) return { ok: true };

  if (name.endsWith(".json")) {
    try {
      JSON.parse(text);
      return { ok: true };
    } catch (error) {
      error.source = text;
      return parseJsonError(error);
    }
  }

  if (/\.(jsx|tsx)$/.test(name)) {
    return lintJavaScript(text, { jsx: true });
  }

  if (/\.(js|mjs|cjs|ts|tsx)$/.test(name)) {
    return lintJavaScript(text, { jsx: false });
  }

  if (name.endsWith(".css")) {
    return checkBalance(text);
  }

  return { ok: true };
}
