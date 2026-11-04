import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_URL =
  "https://claude.com/docs/third-party/claude-desktop/schemas/bootstrap-config-v1.schema.json";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  packageRoot,
  "schemas/bootstrap-config-v1.schema.json",
);

const response = await fetch(SCHEMA_URL);
if (!response.ok) {
  throw new Error(
    `Failed to download bootstrap schema: ${response.status} ${response.statusText}`,
  );
}

const schema = await response.json();
if (
  typeof schema !== "object" ||
  schema === null ||
  !("definitions" in schema) ||
  typeof schema.definitions !== "object" ||
  schema.definitions === null ||
  !("BootstrapConfig" in schema.definitions) ||
  typeof schema.definitions.BootstrapConfig !== "object" ||
  schema.definitions.BootstrapConfig === null ||
  !("properties" in schema.definitions.BootstrapConfig) ||
  typeof schema.definitions.BootstrapConfig.properties !== "object" ||
  schema.definitions.BootstrapConfig.properties === null
) {
  throw new Error(
    "Downloaded schema is missing definitions.BootstrapConfig.properties",
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Updated ${outputPath} from ${SCHEMA_URL}`);
