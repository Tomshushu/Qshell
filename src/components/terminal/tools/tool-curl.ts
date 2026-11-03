/**
 * cURL 命令结构化解析与拆解引擎
 */

export interface ParsedCurl {
  valid: boolean;
  error?: string;
  method: string;
  url: string;
  urlBase: string;
  queryParams: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  body: string | null;
  bodyType: "json" | "form" | "text" | "none";
  formattedBody: string | null;
  pythonSnippet: string;
  nodeSnippet: string;
}

/**
 * 词法切分 cURL 命令，正确处理各种单双引号、换行续行符 (\)
 */
function tokenizeCommand(cmd: string): string[] {
  const clean = cmd
    .replace(/\\\r?\n/g, " ")
    .replace(/^\s*\$\s*curl/i, "curl")
    .trim();

  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * 解析 cURL 命令
 */
export function parseCurlCommand(rawCmd: string): ParsedCurl {
  const trimmed = rawCmd.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "请输入 cURL 命令",
      method: "GET",
      url: "",
      urlBase: "",
      queryParams: [],
      headers: [],
      body: null,
      bodyType: "none",
      formattedBody: null,
      pythonSnippet: "",
      nodeSnippet: "",
    };
  }

  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0 || !tokens[0].toLowerCase().endsWith("curl")) {
    return {
      valid: false,
      error: "输入的文本不是有效的 curl 命令（缺少 curl 引导）",
      method: "GET",
      url: "",
      urlBase: "",
      queryParams: [],
      headers: [],
      body: null,
      bodyType: "none",
      formattedBody: null,
      pythonSnippet: "",
      nodeSnippet: "",
    };
  }

  let method = "GET";
  let explicitMethod = false;
  let rawUrl = "";
  const headers: Array<{ key: string; value: string }> = [];
  const bodyParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    // Method: -X, --request
    if ((t === "-X" || t === "--request") && i + 1 < tokens.length) {
      method = tokens[++i].toUpperCase();
      explicitMethod = true;
      continue;
    }

    // URL: --url
    if (t === "--url" && i + 1 < tokens.length) {
      rawUrl = tokens[++i];
      continue;
    }

    // Headers: -H, --header
    if ((t === "-H" || t === "--header") && i + 1 < tokens.length) {
      const headerStr = tokens[++i];
      const colonIdx = headerStr.indexOf(":");
      if (colonIdx !== -1) {
        headers.push({
          key: headerStr.slice(0, colonIdx).trim(),
          value: headerStr.slice(colonIdx + 1).trim(),
        });
      }
      continue;
    }

    // Data / Body: -d, --data, --data-raw, --data-binary, --data-urlencode
    if (
      (t === "-d" ||
        t === "--data" ||
        t === "--data-raw" ||
        t === "--data-binary" ||
        t === "--data-urlencode") &&
      i + 1 < tokens.length
    ) {
      bodyParts.push(tokens[++i]);
      if (!explicitMethod) {
        method = "POST";
      }
      continue;
    }

    // 其它位置参数：未带参数名且看起来像 URL 的
    if (!t.startsWith("-") && !rawUrl) {
      rawUrl = t;
    }
  }

  if (!rawUrl) {
    return {
      valid: false,
      error: "未在命令中检测到目标 URL",
      method,
      url: "",
      urlBase: "",
      queryParams: [],
      headers,
      body: null,
      bodyType: "none",
      formattedBody: null,
      pythonSnippet: "",
      nodeSnippet: "",
    };
  }

  // 解析 URL 与 Query 参数
  let urlBase = rawUrl;
  const queryParams: Array<{ key: string; value: string }> = [];
  const qIdx = rawUrl.indexOf("?");
  if (qIdx !== -1) {
    urlBase = rawUrl.slice(0, qIdx);
    const queryString = rawUrl.slice(qIdx + 1);
    const pairs = queryString.split("&");
    for (const p of pairs) {
      const eqIdx = p.indexOf("=");
      if (eqIdx !== -1) {
        try {
          queryParams.push({
            key: decodeURIComponent(p.slice(0, eqIdx)),
            value: decodeURIComponent(p.slice(eqIdx + 1)),
          });
        } catch {
          queryParams.push({
            key: p.slice(0, eqIdx),
            value: p.slice(eqIdx + 1),
          });
        }
      } else if (p) {
        queryParams.push({ key: p, value: "" });
      }
    }
  }

  // 处理 Body
  let body: string | null = null;
  let bodyType: "json" | "form" | "text" | "none" = "none";
  let formattedBody: string | null = null;

  if (bodyParts.length > 0) {
    body = bodyParts.join("&");
    // 尝试探测是否是 JSON
    try {
      const parsed = JSON.parse(body);
      bodyType = "json";
      formattedBody = JSON.stringify(parsed, null, 2);
    } catch {
      if (body.includes("=") && !body.includes("\n")) {
        bodyType = "form";
      } else {
        bodyType = "text";
      }
      formattedBody = body;
    }
  }

  // 生成 Python Snippet
  const headerDict = headers.reduce((acc, h) => {
    acc[h.key] = h.value;
    return acc;
  }, {} as Record<string, string>);

  const pyHeaders = JSON.stringify(headerDict, null, 4);
  let pySnippet = `import requests\n\nurl = "${rawUrl}"\nheaders = ${pyHeaders}\n`;
  if (bodyType === "json") {
    pySnippet += `json_data = ${formattedBody}\nresponse = requests.${method.toLowerCase()}(url, headers=headers, json=json_data)\nprint(response.status_code, response.text)\n`;
  } else if (body) {
    pySnippet += `data = ${JSON.stringify(body)}\nresponse = requests.${method.toLowerCase()}(url, headers=headers, data=data)\nprint(response.status_code, response.text)\n`;
  } else {
    pySnippet += `response = requests.${method.toLowerCase()}(url, headers=headers)\nprint(response.status_code, response.text)\n`;
  }

  // 生成 Node.js Fetch Snippet
  let nodeSnippet = `const url = "${rawUrl}";\nconst options = {\n  method: "${method}",\n  headers: ${JSON.stringify(headerDict, null, 2)},\n`;
  if (body) {
    nodeSnippet += `  body: ${JSON.stringify(body)},\n`;
  }
  nodeSnippet += `};\n\nconst response = await fetch(url, options);\nconst data = await response.text();\nconsole.log(response.status, data);\n`;

  return {
    valid: true,
    method,
    url: rawUrl,
    urlBase,
    queryParams,
    headers,
    body,
    bodyType,
    formattedBody,
    pythonSnippet: pySnippet,
    nodeSnippet,
  };
}
