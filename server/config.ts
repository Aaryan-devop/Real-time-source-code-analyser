import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const settings = {
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.CODEPULSE_DB_PATH || path.resolve(__dirname, '..', 'codepulse.db'),
  DEBOUNCE_MS: Number(process.env.CODEPULSE_DEBOUNCE_MS || 300),
  MAX_FILE_SIZE_BYTES: Number(process.env.CODEPULSE_MAX_FILE_SIZE_BYTES || 1048576),
  OLLAMA_URL: process.env.CODEPULSE_OLLAMA_URL || 'http://127.0.0.1:11434',
  OLLAMA_MODEL: process.env.CODEPULSE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b',
  WEIGHT_CRITICAL: Number(process.env.CODEPULSE_WEIGHT_CRITICAL || 10.0),
  WEIGHT_HIGH: Number(process.env.CODEPULSE_WEIGHT_HIGH || 5.0),
  WEIGHT_MEDIUM: Number(process.env.CODEPULSE_WEIGHT_MEDIUM || 2.0),
  WEIGHT_LOW: Number(process.env.CODEPULSE_WEIGHT_LOW || 0.5),
  ROOT_DIR: path.resolve(__dirname, '..'),
  FRONTEND_DIST: path.resolve(__dirname, '..', 'dist'),
};
