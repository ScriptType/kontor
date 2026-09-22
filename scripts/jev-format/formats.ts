/** Serializers for the same state content in other text formats. */
type Json = unknown;
const isPlainObject = (value: Json): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isPrimitive = (value: Json) =>
  value === null || typeof value !== "object";

// YAML: block style, plain scalars where unambiguous, literal blocks for
// multi-line text, JSON-style double quotes otherwise.
function yamlScalar(value: Json, indent: string): string {
  if (typeof value !== "string") return JSON.stringify(value);
  if (value.includes("\n"))
    return `|-\n${value
      .split("\n")
      .map((line) => (line ? `${indent}  ${line}` : ""))
      .join("\n")}`;
  const plain =
    value !== "" &&
    !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/(: |\s#|:$)/.test(value) &&
    !/^(true|false|null|~|yes|no|on|off|[-+]?[\d.]+(e[-+]?\d+)?)$/i.test(
      value,
    ) &&
    value.trim() === value;
  return plain ? value : JSON.stringify(value);
}
export function yaml(value: Json, indent = ""): string {
  if (isPrimitive(value)) return yamlScalar(value, indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (isPrimitive(item)) return `${indent}- ${yamlScalar(item, indent)}`;
        const inner = yaml(item, `${indent}  `);
        return `${indent}- ${inner.slice(indent.length + 2)}`;
      })
      .join("\n");
  }
  const entries = Object.entries(value as Record<string, Json>);
  if (!entries.length) return "{}";
  return entries
    .map(([key, inner]) => {
      if (isPrimitive(inner))
        return `${indent}${key}: ${yamlScalar(inner, indent)}`;
      if (Array.isArray(inner) && !inner.length) return `${indent}${key}: []`;
      if (isPlainObject(inner) && !Object.keys(inner).length)
        return `${indent}${key}: {}`;
      const child = Array.isArray(inner) ? indent : `${indent}  `;
      return `${indent}${key}:\n${yaml(inner, child)}`;
    })
    .join("\n");
}

// TOON (Token-Oriented Object Notation): indentation for objects, inline
// arrays of primitives, tabular rows for arrays of flat objects with the same
// keys, list items otherwise.
function toonScalar(value: Json): string {
  if (typeof value !== "string") return JSON.stringify(value);
  const needsQuotes =
    value === "" ||
    value.trim() !== value ||
    /[,:"\\\n\t[\]{}]/.test(value) ||
    value.startsWith("- ") ||
    /^(true|false|null|[-+]?\d+(\.\d+)?(e[-+]?\d+)?)$/i.test(value);
  return needsQuotes ? JSON.stringify(value) : value;
}
function tabularKeys(items: Json[]) {
  if (!items.length || !items.every(isPlainObject)) return null;
  const keys = Object.keys(items[0] as Record<string, Json>);
  const same = items.every((item) => {
    const own = Object.keys(item as Record<string, Json>);
    return (
      own.length === keys.length &&
      own.every((key, i) => key === keys[i]) &&
      own.every((key) => isPrimitive((item as Record<string, Json>)[key]))
    );
  });
  return same ? keys : null;
}
function toonField(key: string, value: Json, indent: string): string {
  if (isPrimitive(value)) return `${indent}${key}: ${toonScalar(value)}`;
  if (Array.isArray(value)) {
    if (value.every(isPrimitive))
      return `${indent}${key}[${value.length}]: ${value.map(toonScalar).join(",")}`;
    const keys = tabularKeys(value);
    if (keys)
      return [
        `${indent}${key}[${value.length}]{${keys.join(",")}}:`,
        ...value.map(
          (item) =>
            `${indent}  ${keys.map((k) => toonScalar((item as Record<string, Json>)[k])).join(",")}`,
        ),
      ].join("\n");
    return [
      `${indent}${key}[${value.length}]:`,
      ...value.map((item) => toonItem(item, `${indent}  `)),
    ].join("\n");
  }
  const body = toon(value, `${indent}  `);
  return body ? `${indent}${key}:\n${body}` : `${indent}${key}: {}`;
}
function toonItem(item: Json, indent: string): string {
  if (isPrimitive(item)) return `${indent}- ${toonScalar(item)}`;
  if (Array.isArray(item))
    return `${indent}- ${toonField("", item, "").trimStart()}`;
  const lines = toon(item, `${indent}  `).split("\n");
  return [`${indent}- ${(lines[0] ?? "").trimStart()}`, ...lines.slice(1)].join(
    "\n",
  );
}
export function toon(value: Json, indent = ""): string {
  if (isPlainObject(value))
    return Object.entries(value)
      .map(([key, inner]) => toonField(key, inner, indent))
      .join("\n");
  return toonField("value", value, indent);
}

// Markdown: a heading per top-level part, a table per list of flat records,
// bullets for records, a fenced block for multi-line text.
const cell = (value: Json) =>
  (typeof value === "string" ? value : JSON.stringify(value))
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
function markdownValue(value: Json, depth: number): string {
  if (typeof value === "string" && value.includes("\n"))
    return `\n\`\`\`\n${value}\n\`\`\``;
  if (isPrimitive(value)) return ` ${cell(value)}`;
  if (Array.isArray(value)) {
    if (!value.length) return " none";
    const keys = tabularKeys(value);
    if (keys)
      return `\n\n| ${keys.join(" | ")} |\n| ${keys.map(() => "---").join(" | ")} |\n${value
        .map(
          (item) =>
            `| ${keys.map((k) => cell((item as Record<string, Json>)[k])).join(" | ")} |`,
        )
        .join("\n")}\n`;
    if (value.every(isPrimitive))
      return ` ${value.map((item) => cell(item)).join(", ")}`;
    return `\n${value.map((item) => `- ${cell(item)}`).join("\n")}`;
  }
  const entries = Object.entries(value as Record<string, Json>);
  if (!entries.length) return " none";
  if (depth >= 2)
    return `\n${entries.map(([k, v]) => `- ${k}: ${cell(v)}`).join("\n")}`;
  return `\n${entries
    .map(([k, v]) => {
      const inner = markdownValue(v, depth + 1);
      return inner.startsWith("\n")
        ? `${"#".repeat(depth + 3)} ${k}${inner}`
        : `- ${k}:${inner}`;
    })
    .join("\n")}`;
}
export function markdown(state: Record<string, Json>): string {
  return Object.entries(state)
    .map(([key, value]) => `## ${key}${markdownValue(value, 0)}`)
    .join("\n\n");
}

/** One `path=value` line per leaf; strings raw unless they span lines. */
export function keyValue(value: Json, path = ""): string[] {
  if (isPrimitive(value)) {
    const text =
      typeof value === "string" && !value.includes("\n")
        ? value
        : JSON.stringify(value);
    return [`${path}=${text}`];
  }
  if (Array.isArray(value))
    return value.length
      ? value.flatMap((item, i) => keyValue(item, `${path}[${i}]`))
      : [`${path}=[]`];
  const entries = Object.entries(value as Record<string, Json>);
  return entries.length
    ? entries.flatMap(([key, inner]) =>
        keyValue(inner, path ? `${path}.${key}` : key),
      )
    : [`${path}={}`];
}

/** Top-level parts as XML-tagged sections; text raw, structures as compact JSON. */
export function xmlSections(state: Record<string, Json>): string {
  return Object.entries(state)
    .map(
      ([key, value]) =>
        `<${key}>${typeof value === "string" ? value : JSON.stringify(value)}</${key}>`,
    )
    .join("\n");
}
