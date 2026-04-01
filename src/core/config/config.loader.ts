import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { configSchema, type AppConfig } from './config.schema.js';

function loadYamlFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const content = readFileSync(filePath, 'utf-8');
  return (yaml.load(content) as Record<string, unknown>) || {};
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const prefix = 'DBOT__';
  const result = { ...config };

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;

    const parts = key
      .slice(prefix.length)
      .toLowerCase()
      .split('__')
      .map((p) => p.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()));

    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    const lastKey = parts[parts.length - 1];
    // Try to parse as number or boolean
    if (value === 'true') current[lastKey] = true;
    else if (value === 'false') current[lastKey] = false;
    else if (/^\d+$/.test(value)) current[lastKey] = parseInt(value, 10);
    else current[lastKey] = value;
  }

  return result;
}

export function loadConfig(configDir?: string): AppConfig {
  const dir = configDir || resolve(process.cwd(), 'config');
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Layer 1: default.yaml
  let config = loadYamlFile(resolve(dir, 'default.yaml'));

  // Layer 2: {NODE_ENV}.yaml
  const envConfig = loadYamlFile(resolve(dir, `${nodeEnv}.yaml`));
  config = deepMerge(config, envConfig);

  // Layer 3: environment variables (highest priority)
  config = applyEnvOverrides(config);

  // Validate with zod
  return configSchema.parse(config);
}

// Direct execution for verification
const isDirectExecution =
  process.argv[1]?.endsWith('config.loader.ts') || process.argv[1]?.endsWith('config.loader.js');

if (isDirectExecution) {
  const config = loadConfig();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(config, null, 2));
}
