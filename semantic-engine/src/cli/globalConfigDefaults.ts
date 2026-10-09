/**
 * Fill command-line defaults from `<dataRoot>/config.json`.
 *
 * `flag > env > config.json > built-in default`: this module only supplies
 * the third layer. An option that is already present (a real flag) is never
 * touched, and the environment variables that other code reads directly
 * (`SEMANTIC_ENGINE_ARTIFACT_LOCATION`, `SEMANTIC_ENGINE_DATA_DIR`) keep
 * precedence over the file.
 *
 * `start` is the "everything on" command, so it also takes the deep-scan and
 * embedding switches from the file. `index` and `watch` only take them when
 * the user already asked for vectors, because `--embedding-provider` implies
 * `--vectors` and quietly turning that on would change what `index` does.
 */

import { ParsedArgs, OptionValue, stringOption } from './args';
import { resolveDataRoot } from '../core/config/DataRootResolver';
import {
  GlobalConfig,
  LOCAL_DEFAULT_EMBEDDING_MODEL,
  LoadedGlobalConfig,
  ensureGlobalConfig,
  loadGlobalConfig,
  modelsDirFor,
} from '../core/config/GlobalConfig';
import { PROVIDER_CATALOG } from '../services/providers/EmbeddingProviderService';

const ARTIFACT_LOCATION_ENV = 'SEMANTIC_ENGINE_ARTIFACT_LOCATION';

export interface AppliedConfig {
  readonly args: ParsedArgs;
  readonly loaded: LoadedGlobalConfig;
  readonly dataRoot: string;
}

/** Commands that create the config file when it is missing. */
const CREATES_FILE = new Set(['start', 'ui']);

export function applyGlobalConfig(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv = process.env
): AppliedConfig | null {
  if (!args.command) return null;

  const dataDirFlag = stringOption(args.options, 'dataDir');
  const dataRoot = resolveDataRoot({ ...(dataDirFlag ? { dataDir: dataDirFlag } : {}), env });
  const loaded = CREATES_FILE.has(args.command)
    ? ensureGlobalConfig(dataRoot)
    : loadGlobalConfig(dataRoot);
  const config = loaded.config;

  const options: Record<string, OptionValue> = { ...args.options };
  const fill = (name: string, value: OptionValue | undefined): void => {
    if (value === undefined || options[name] !== undefined) return;
    options[name] = value;
  };

  /* Everything that reads data must agree on one data directory. */
  if (dataDirFlag && !env['SEMANTIC_ENGINE_DATA_DIR']) {
    env['SEMANTIC_ENGINE_DATA_DIR'] = dataRoot;
  }
  if (!env['SEMANTIC_ENGINE_MODELS_DIR']) {
    env['SEMANTIC_ENGINE_MODELS_DIR'] = modelsDirFor(dataRoot, config);
  }

  if (!env[ARTIFACT_LOCATION_ENV]) fill('artifactLocation', config.artifacts.location);

  const command = args.command;
  const scanning = command === 'index' || command === 'watch' || command === 'start';
  if (scanning) {
    fill('treeSitter', config.scan.treeSitter);
    fill('git', config.scan.git);
    fill('blueprint', config.scan.blueprint);
  }

  if (command === 'start') {
    fill('host', config.server.host);
    fill('uiPort', String(config.server.uiPort));
    fill('mcpPort', String(config.server.mcpPort));
    fill('watch', config.start.watch);
    fill('vectors', config.embedding.enabled);
    fill('lspDiagnostics', config.scan.lspDiagnostics);
    fill('diagnosticsBudget', String(config.scan.diagnosticsBudgetMs));
  } else if (command === 'ui') {
    fill('host', config.server.host);
    fill('port', String(config.server.uiPort));
  } else if (command === 'serve') {
    fill('host', config.server.host);
    if (options['http'] === true) fill('port', String(config.server.mcpPort));
  }

  const wantsEmbedding =
    command === 'start'
      ? options['vectors'] !== false && options['vectors'] !== 'false'
      : (command === 'index' || command === 'watch') &&
        (options['vectors'] === true || options['vectors'] === 'true');
  if (wantsEmbedding) applyEmbedding(config, fill);

  return { args: { ...args, options }, loaded, dataRoot };
}

function applyEmbedding(
  config: GlobalConfig,
  fill: (name: string, value: OptionValue | undefined) => void
): void {
  const embedding = config.embedding;
  fill('embeddingProvider', embedding.provider);
  fill('embeddingNormalize', embedding.normalize);

  if (embedding.provider === 'local') {
    if (!embedding.useDefaultModel && embedding.model !== LOCAL_DEFAULT_EMBEDDING_MODEL) {
      fill('embeddingModel', embedding.model);
    }
    return;
  }

  const fallback = PROVIDER_CATALOG.find(entry => entry.kind === embedding.provider)?.defaultModel;
  const model = !embedding.useDefaultModel && embedding.model !== '' ? embedding.model : fallback;
  fill('embeddingModel', model);
  if (embedding.baseUrl !== '') fill('embeddingBaseUrl', embedding.baseUrl);
  if (embedding.apiKeyEnvVar !== '') fill('embeddingApiKeyEnv', embedding.apiKeyEnvVar);
}
