import { performance } from 'node:perf_hooks';
import { Database } from '../db.ts';
import { Engine } from '../engine.ts';

export interface SuiteCaseResult {
  name: string;
  suite: string;
  expectedRules: string[];
  detectedRules: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  redactionVerified: boolean;
  durationMs: number;
}

export interface BenchmarkSummary {
  ran_at: string;
  total_cases: number;
  precision: number;
  recall: number;
  f1_score: number;
  secret_redaction_rate: number;
  avg_file_latency_ms: number;
  cases: SuiteCaseResult[];
}

interface GroundTruthFixture {
  name: string;
  suite: string;
  virtualPath: string;
  source: string;
  expectedRules: string[];
  forbiddenRawSecrets?: string[];
}

const FIXTURES: readonly GroundTruthFixture[] = [
  {
    name: 'Python RCE, SQLi, Pickle & Weak Hash (Positive)',
    suite: 'Python Security',
    virtualPath: 'vuln_service.py',
    source: `import hashlib
import pickle
import subprocess
import requests

def handle_req(conn, user_cmd, blob, uid):
    eval(user_cmd)
    pickle.loads(blob)
    subprocess.call(user_cmd, shell=True)
    conn.execute(f"SELECT * FROM items WHERE uid = '{uid}'")
    hashlib.md5(b"seed")
    requests.get("https://internal.local", verify=False)
`,
    expectedRules: ['CP-SEC-001', 'CP-SEC-002', 'CP-SEC-003', 'CP-SEC-004', 'CP-SEC-005', 'CP-SEC-007'],
  },
  {
    name: 'Python Parameterized SQL & Safe YAML (Negative)',
    suite: 'Python Security',
    virtualPath: 'safe_service.py',
    source: `import ast
import hashlib
import subprocess
import yaml

def safe_handler(conn, literal_str, raw_yaml, uid):
    parsed = ast.literal_eval(literal_str)
    cfg = yaml.safe_load(raw_yaml)
    subprocess.run(["ls", "-la"], shell=False)
    conn.execute("SELECT * FROM items WHERE uid = ?", (uid,))
    digest = hashlib.sha256(str(parsed).encode("utf-8")).hexdigest()
    return cfg, digest
`,
    expectedRules: [],
  },
  {
    name: 'Python Code Smells Suite (Positive)',
    suite: 'Python Smells',
    virtualPath: 'smelly_mod.py',
    source: `import math
import uuid

def mutate_items(val, bucket=[]):
    unused_temp = 42
    print("debug trace")
    try:
        return val
        unreachable_after_return = 99
    except:
        pass
`,
    expectedRules: ['CP-SML-001', 'CP-SML-002', 'CP-SML-003', 'CP-SML-004', 'CP-SML-006', 'CP-SML-007'],
  },
  {
    name: 'Secrets Detection & Mandatory Redaction',
    suite: 'Secrets & Redaction',
    virtualPath: 'credentials.py',
    // Note: These are FAKE test secrets for validation only - not real credentials
    source: `AWS_ID = "AKIA" + "IOSFODNN7" + "REALKEY"
API_SECRET = "sk_" + "test_" + "99aBcDeFgHiJkLmNoPqRsTuVwXyZ"
PLACEHOLDER_KEY = "your_api_key_here"
`,
    expectedRules: ['CP-SEC-101', 'CP-SEC-103'],
    forbiddenRawSecrets: ['AKIAIOSFODNN7REALKEY', 'sk_test_99aBcDeFgHiJkLmNoPqRsTuVwXyZ'],
  },
  {
    name: 'JS/TS XSS, Shell Injection & Smells (Positive)',
    suite: 'JS / TypeScript',
    virtualPath: 'widget.ts',
    source: `import cp from "node:child_process";

export function updateView(el: HTMLElement, raw: string, flag: string) {
  eval(raw);
  el.innerHTML = raw;
  cp.exec(\`ls \${raw}\`);
  if (flag == "1") {
    console.log(flag);
  }
  try {
    JSON.parse(raw);
  } catch (err) {}
}
`,
    expectedRules: ['CP-JS-001', 'CP-JS-003', 'CP-JS-005', 'CP-JS-006', 'CP-JS-007', 'CP-JS-008'],
  },
  {
    name: 'JS/TS Safe DOM & Strict Equality (Negative)',
    suite: 'JS / TypeScript',
    virtualPath: 'safeWidget.ts',
    source: `export function renderCleanText(el: HTMLElement, label: string, active: boolean): string {
  el.textContent = label;
  if (active === true) {
    return label.trim();
  }
  return "inactive";
}
`,
    expectedRules: [],
  },
  {
    name: 'Cross-File Rolling Hash Duplication',
    suite: 'Duplicates',
    virtualPath: 'dup_b.py',
    source: `def validate_invoice_totals(subtotal, tax_rate, discount):
    if subtotal <= 0:
        raise ValueError("Subtotal must be positive")
    if discount < 0:
        discount = 0.0
    tax_amount = round(subtotal * tax_rate, 2)
    net_total = subtotal + tax_amount - discount
    return max(0.0, net_total)
`,
    expectedRules: ['CP-DUP-001'],
  },
  {
    name: 'Offline Dependency CVE Audit (PyPI & npm)',
    suite: 'Dependencies',
    virtualPath: 'requirements.txt',
    source: `requests==2.28.0
flask==2.1.0
fastapi==0.115.0
`,
    expectedRules: ['CP-DEP-001'],
  },
];

export function runEvaluationBenchmark(): BenchmarkSummary {
  const memDb = new Database(':memory:');
  const evalEngine = new Engine(memDb);

  // Prime first half of duplicate pair into index
  evalEngine.analyzeSourceInMemory(
    'dup_a.py',
    `def verify_order_totals(subtotal, tax_rate, discount):
    if subtotal <= 0:
        raise ValueError("Subtotal must be positive")
    if discount < 0:
        discount = 0.0
    tax_amount = round(subtotal * tax_rate, 2)
    net_total = subtotal + tax_amount - discount
    return max(0.0, net_total)
`
  );

  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;
  let redactionChecks = 0;
  let redactionPasses = 0;
  let totalDuration = 0;

  const cases: SuiteCaseResult[] = [];

  for (const fix of FIXTURES) {
    const t0 = performance.now();
    const report = evalEngine.analyzeSourceInMemory(fix.virtualPath, fix.source);
    const elapsed = Math.round((performance.now() - t0) * 100) / 100;
    totalDuration += elapsed;

    const detectedSet = new Set(report.findings.map((f) => f.rule_id));
    const expectedSet = new Set(fix.expectedRules);

    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const r of detectedSet) {
      if (expectedSet.has(r)) tp++;
      else fp++;
    }
    for (const r of expectedSet) {
      if (!detectedSet.has(r)) fn++;
    }

    totalTP += tp;
    totalFP += fp;
    totalFN += fn;

    let redactionOk = true;
    if (fix.forbiddenRawSecrets && fix.forbiddenRawSecrets.length > 0) {
      redactionChecks++;
      for (const f of report.findings) {
        for (const rawSecret of fix.forbiddenRawSecrets) {
          if (f.snippet.includes(rawSecret) || f.message.includes(rawSecret)) {
            redactionOk = false;
          }
        }
      }
      if (redactionOk) redactionPasses++;
    }

    cases.push({
      name: fix.name,
      suite: fix.suite,
      expectedRules: [...expectedSet],
      detectedRules: [...detectedSet],
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      redactionVerified: redactionOk,
      durationMs: elapsed,
    });
  }

  const precision = totalTP + totalFP > 0 ? Math.round((totalTP / (totalTP + totalFP)) * 1000) / 10 : 100;
  const recall = totalTP + totalFN > 0 ? Math.round((totalTP / (totalTP + totalFN)) * 1000) / 10 : 100;
  const f1 =
    precision + recall > 0 ? Math.round(((2 * precision * recall) / (precision + recall)) * 10) / 10 : 100;
  const secretRedactionRate =
    redactionChecks > 0 ? Math.round((redactionPasses / redactionChecks) * 1000) / 10 : 100;
  const avgLatency = Math.round((totalDuration / FIXTURES.length) * 100) / 100;

  return {
    ran_at: new Date().toISOString(),
    total_cases: FIXTURES.length,
    precision,
    recall,
    f1_score: f1,
    secret_redaction_rate: secretRedactionRate,
    avg_file_latency_ms: avgLatency,
    cases,
  };
}
