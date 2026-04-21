import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const wranglerTomlPath = resolve(process.cwd(), "wrangler.toml");

function run(command, ignoreError = false) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    if (!ignoreError) {
      throw new Error(output || `command failed: ${command}`);
    }
    return output;
  }
}

function parseWorkerName(toml) {
  const match = toml.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("wrangler.toml missing worker name");
  }
  return match[1];
}

function parseNamespaceListOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("kv namespace list returned empty output");
  }
  const jsonStart = trimmed.indexOf("[");
  const jsonText = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      throw new Error("kv namespace list output is not an array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`cannot parse kv namespace list output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findNamespaceId(all, expectedTitle, binding, preview) {
  const exact = all.find((item) => item.title === expectedTitle);
  if (exact?.id) return exact.id;

  const suffix = preview ? `-${binding}_preview` : `-${binding}`;
  const fallback = all.filter((item) => item.title.endsWith(suffix));
  if (fallback.length === 1 && fallback[0].id) return fallback[0].id;

  throw new Error(
    `cannot resolve namespace id for ${binding}${preview ? " preview" : ""}, expected title: ${expectedTitle}`,
  );
}

function updateBindingBlock(toml, binding, id, previewId) {
  const blockRegex = new RegExp(
    `\\[\\[kv_namespaces\\]\\]\\n\\s*binding\\s*=\\s*"${binding}"\\n[\\s\\S]*?(?=\\n\\[\\[kv_namespaces\\]\\]|$)`,
  );
  const blockMatch = toml.match(blockRegex);
  if (!blockMatch) {
    throw new Error(`kv_namespaces block not found for binding: ${binding}`);
  }

  const updatedBlock = blockMatch[0]
    .replace(/^id\s*=\s*"[^"]*"/m, `id = "${id}"`)
    .replace(/^preview_id\s*=\s*"[^"]*"/m, `preview_id = "${previewId}"`);

  return toml.replace(blockRegex, updatedBlock);
}

const toml = readFileSync(wranglerTomlPath, "utf8");
parseWorkerName(toml);
const bindings = ["APP_CACHE", "FX_CACHE"];

for (const binding of bindings) {
  run(`npx wrangler kv namespace create ${binding}`, true);
  run(`npx wrangler kv namespace create ${binding} --preview`, true);
}

const namespaces = parseNamespaceListOutput(run("npx wrangler kv namespace list"));

let nextToml = toml;
for (const binding of bindings) {
  const id = findNamespaceId(namespaces, binding, binding, false);
  const previewId = findNamespaceId(namespaces, `${binding}_preview`, binding, true);
  nextToml = updateBindingBlock(nextToml, binding, id, previewId);
}

writeFileSync(wranglerTomlPath, nextToml, "utf8");

console.log("KV namespaces ready and wrangler.toml updated:");
for (const binding of bindings) {
  const block = nextToml.match(
    new RegExp(`\\[\\[kv_namespaces\\]\\]\\n\\s*binding\\s*=\\s*"${binding}"\\n[\\s\\S]*?(?=\\n\\[\\[kv_namespaces\\]\\]|$)`),
  )?.[0];
  const idLine = block?.match(/^id\s*=\s*"([^"]+)"/m);
  const previewLine = block?.match(/^preview_id\s*=\s*"([^"]+)"/m);
  console.log(`- ${binding}.id = ${idLine?.[1] ?? "N/A"}`);
  console.log(`- ${binding}.preview_id = ${previewLine?.[1] ?? "N/A"}`);
}
