import path from 'node:path';
import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';

const AWS_PATTERN = /\b(AKIA[0-9A-Z]{16})\b/;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----/;
const BEARER_PATTERN = /\bbearer\s+([a-zA-Z0-9_\-.]{25,})\b/i;
const GENERIC_SECRET_PATTERN =
  /(?:api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token)\s*(?:=|:)\s*['"]([^\s'"]{8,})['"]/i;
const CONN_STR_PATTERN =
  /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[a-zA-Z0-9_-]+:([^\s@'"]+)@[a-zA-Z0-9.-]+/;

const PLACEHOLDERS = [
  'changeme',
  'your_api_key',
  'your-api-key',
  'your_password',
  'your-password',
  'my_gemini_api_key',
  'xxxx',
  'example_placeholder',
  'dummy',
  'placeholder',
  '123456',
  'password123',
  'null',
  'none',
  'true',
  'false',
];

export function shannonEntropy(str: string): number {
  if (!str) return 0.0;
  const counts = new Map<string, number>();
  for (const ch of str) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0.0;
  const len = str.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function isPlaceholder(val: string): boolean {
  const v = val.toLowerCase().trim();
  if (PLACEHOLDERS.some((p) => v.includes(p))) return true;
  const uniqueChars = new Set(v).size;
  return uniqueChars <= 2;
}

export function redactSecret(secret: string): string {
  if (secret.length <= 3) return '***';
  return `${secret.slice(0, 3)}***`;
}

export class SecretsAnalyzer implements BaseAnalyzer {
  readonly name = 'SecretsAnalyzer';

  supports(_language: string, filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    // Skip .env.example template files by design
    if (base === '.env.example' || base === 'vulnerablepackages.ts') return false;
    return true;
  }

  analyze(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const lines = source.split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const line = lines[idx];
      const stripped = line.trim();
      if (!stripped || stripped.startsWith('#') || stripped.startsWith('//') || stripped.startsWith('/*') || stripped.startsWith('*')) {
        continue;
      }

      // 1. AWS Access Key ID
      const awsMatch = AWS_PATTERN.exec(line);
      if (awsMatch) {
        const raw = awsMatch[1];
        if (!isPlaceholder(raw)) {
          const redactedSnippet = line.replace(raw, redactSecret(raw)).trim();
          findings.push({
            id: `sec-secret-aws-${lineNo}`,
            file: filePath,
            line: lineNo,
            end_line: lineNo,
            rule_id: 'CP-SEC-101',
            category: 'security',
            severity: 'critical',
            confidence: 'high',
            title: 'Hardcoded AWS Access Key [CWE-798]',
            message: 'AWS IAM Access Key ID committed in source text.',
            why_it_matters: 'Exposed cloud IAM keys allow automated credential harvesters to compromise cloud resources.',
            suggested_fix: 'Rotate this IAM key immediately and load credentials via environment variables or IAM roles.',
            snippet: redactedSnippet,
            fingerprint: computeFingerprint(filePath, 'CP-SEC-101', redactedSnippet),
            is_new: false,
            dismissed: false,
          });
        }
      }

      // 2. PEM / OpenSSH Private Key Block
      if (PRIVATE_KEY_PATTERN.test(line)) {
        const redactedSnippet = '-----BEGIN PRIVATE KEY----- [REDACTED]';
        findings.push({
          id: `sec-secret-privkey-${lineNo}`,
          file: filePath,
          line: lineNo,
          end_line: lineNo,
          rule_id: 'CP-SEC-102',
          category: 'security',
          severity: 'critical',
          confidence: 'high',
          title: 'Hardcoded Private Key Block [CWE-798]',
          message: 'Asymmetric private key PEM header detected in source.',
          why_it_matters: 'Compromises TLS/SSH identity verification and allows impersonation or payload decryption.',
          suggested_fix: 'Remove key material from repository history and mount secrets from a key vault at runtime.',
          snippet: redactedSnippet,
          fingerprint: computeFingerprint(filePath, 'CP-SEC-102', redactedSnippet),
          is_new: false,
          dismissed: false,
        });
      }

      // 3. High-entropy secret assignment
      const genMatch = GENERIC_SECRET_PATTERN.exec(line);
      if (genMatch) {
        const raw = genMatch[1];
        if (!isPlaceholder(raw) && !AWS_PATTERN.test(raw) && shannonEntropy(raw) >= 2.8) {
          const redactedSnippet = line.replace(raw, redactSecret(raw)).trim();
          findings.push({
            id: `sec-secret-gen-${lineNo}`,
            file: filePath,
            line: lineNo,
            end_line: lineNo,
            rule_id: 'CP-SEC-103',
            category: 'security',
            severity: 'high',
            confidence: 'medium',
            title: 'Hardcoded High-Entropy Credential [CWE-798]',
            message: `High-entropy secret literal (entropy ${shannonEntropy(raw).toFixed(2)} bits) assigned in code.`,
            why_it_matters: 'Hardcoded secrets persist in Git commits, build artifacts, and developer clones.',
            suggested_fix: 'Read secrets from process environment variables or a dedicated secrets manager.',
            snippet: redactedSnippet,
            fingerprint: computeFingerprint(filePath, 'CP-SEC-103', redactedSnippet),
            is_new: false,
            dismissed: false,
          });
        }
      }

      // 4. Hardcoded Bearer Token
      const bearerMatch = BEARER_PATTERN.exec(line);
      if (bearerMatch) {
        const raw = bearerMatch[1];
        if (!isPlaceholder(raw) && shannonEntropy(raw) >= 3.0) {
          const redactedSnippet = line.replace(raw, redactSecret(raw)).trim();
          findings.push({
            id: `sec-secret-bearer-${lineNo}`,
            file: filePath,
            line: lineNo,
            end_line: lineNo,
            rule_id: 'CP-SEC-104',
            category: 'security',
            severity: 'high',
            confidence: 'high',
            title: 'Hardcoded Bearer Token [CWE-798]',
            message: 'Static Authorization Bearer token embedded in source.',
            why_it_matters: 'Grants direct API access to anyone with repository read permissions.',
            suggested_fix: 'Retrieve short-lived bearer tokens dynamically at runtime.',
            snippet: redactedSnippet,
            fingerprint: computeFingerprint(filePath, 'CP-SEC-104', redactedSnippet),
            is_new: false,
            dismissed: false,
          });
        }
      }

      // 5. Database URI with inline password
      const connMatch = CONN_STR_PATTERN.exec(line);
      if (connMatch) {
        const raw = connMatch[1];
        if (!isPlaceholder(raw) && !raw.startsWith('$') && !raw.startsWith('{')) {
          const redactedSnippet = line.replace(raw, redactSecret(raw)).trim();
          findings.push({
            id: `sec-secret-conn-${lineNo}`,
            file: filePath,
            line: lineNo,
            end_line: lineNo,
            rule_id: 'CP-SEC-105',
            category: 'security',
            severity: 'high',
            confidence: 'high',
            title: 'Database Connection URI with Inline Password [CWE-798]',
            message: 'Connection string embeds plaintext database credentials.',
            why_it_matters: 'Exposes production or staging data stores to direct unauthorized access.',
            suggested_fix: 'Inject DATABASE_URL from environment configuration without committing credentials.',
            snippet: redactedSnippet,
            fingerprint: computeFingerprint(filePath, 'CP-SEC-105', redactedSnippet),
            is_new: false,
            dismissed: false,
          });
        }
      }
    }

    return findings;
  }
}
