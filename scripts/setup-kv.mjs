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
    "m",
  );
  const blockMatch = toml.match(blockRegex);
  if (!blockMatch) {
    throw new Error(`kv_namespaces block not found for binding: ${binding}`);
  }

  const updatedBlock = blockMatch[0]
    .replace(/id\s*=\s*"[^"]*"/, `id = "${id}"`)
    .replace(/preview_id\s*=\s*"[^"]*"/, `preview_id = "${previewId}"`);

  return toml.replace(blockRegex, updatedBlock);
}

const toml = readFileSync(wranglerTomlPath, "utf8");
const workerName = parseWorkerName(toml);
const bindings = ["APP_CACHE", "FX_CACHE"];

for (const binding of bindings) {
  run(`npx wrangler kv namespace create ${binding}`, true);
  run(`npx wrangler kv namespace create ${binding} --preview`, true);
}

const namespaces = JSON.parse(run("npx wrangler kv namespace list --json"));

let nextToml = toml;
for (const binding of bindings) {
  const id = findNamespaceId(namespaces, `${workerName}-${binding}`, binding, false);
  const previewId = findNamespaceId(namespaces, `${workerName}-${binding}_preview`, binding, true);
  nextToml = updateBindingBlock(nextToml, binding, id, previewId);
}

writeFileSync(wranglerTomlPath, nextToml, "utf8");

console.log("KV namespaces ready and wrangler.toml updated:");
for (const binding of bindings) {
  const idLine = nextToml.match(new RegExp(`binding\\s*=\\s*"${binding}"[\\s\\S]*?id\\s*=\\s*"([^"]+)"`));
  const previewLine = nextToml.match(new RegExp(`binding\\s*=\\s*"${binding}"[\\s\\S]*?preview_id\\s*=\\s*"([^"]+)"`));
  console.log(`- ${binding}.id = ${idLine?.[1] ?? "N/A"}`);
  console.log(`- ${binding}.preview_id = ${previewLine?.[1] ?? "N/A"}`);
}
