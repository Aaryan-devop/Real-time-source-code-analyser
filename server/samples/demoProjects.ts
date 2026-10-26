import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitAvailable } from '../gitdiff.ts';

export interface WorkspacePreset {
  id: string;
  name: string;
  subtitle: string;
  stack: string;
}

export const WORKSPACE_PRESETS: readonly WorkspacePreset[] = [
  {
    id: 'fintech-gateway',
    name: 'FinPay Core Gateway',
    subtitle: 'Multi-language payment service with uncommitted regressions, SQLi, secrets, and duplicates',
    stack: 'Python · TypeScript · Git',
  },
  {
    id: 'telemetry-portal',
    name: 'CloudOps Node Portal',
    subtitle: 'Web portal exhibiting DOM XSS sinks, shell command interpolation, and npm CVEs',
    stack: 'TypeScript · React · npm',
  },
  {
    id: 'clean-reference',
    name: 'Zero-Trust Baseline',
    subtitle: 'Production-hardened reference service with parameterized queries and strict types',
    stack: 'Python · TypeScript',
  },
];

function writeTree(rootDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function initGitBaselineAndDirtyDiff(
  rootDir: string,
  baselineFiles: Record<string, string>,
  dirtyOverrides: Record<string, string>
): void {
  writeTree(rootDir, baselineFiles);

  if (isGitAvailable()) {
    try {
      execFileSync('git', ['init', '-q'], { cwd: rootDir, timeout: 3000 });
      execFileSync('git', ['config', 'user.email', 'ci@codepulse.local'], { cwd: rootDir, timeout: 2000 });
      execFileSync('git', ['config', 'user.name', 'CodePulse Baseline'], { cwd: rootDir, timeout: 2000 });
      execFileSync('git', ['add', '.'], { cwd: rootDir, timeout: 3000 });
      execFileSync('git', ['commit', '-q', '-m', 'Initial baseline snapshot'], { cwd: rootDir, timeout: 3000 });
    } catch {
      // Git setup optional fallback
    }
  }

  // Apply uncommitted working-tree modifications so git diff HEAD flags new issues as is_new: true
  writeTree(rootDir, dirtyOverrides);
}

export function materializePresetWorkspace(presetId: string): { path: string; preset: WorkspacePreset } {
  const preset = WORKSPACE_PRESETS.find((p) => p.id === presetId) || WORKSPACE_PRESETS[0];
  const baseRoot = path.join(os.tmpdir(), 'codepulse_workspaces', preset.id);

  if (fs.existsSync(baseRoot)) {
    fs.rmSync(baseRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(baseRoot, { recursive: true });

  if (preset.id === 'fintech-gateway') {
    const baseline: Record<string, string> = {
      'api/payments.py': `import hashlib
import sqlite3
import subprocess
import requests

WEBHOOK_ENDPOINT = "https://hooks.finpay.internal/v1/events"


def lookup_ledger_entry(conn: sqlite3.Connection, account_id: str):
    cursor = conn.cursor()
    cursor.execute("SELECT id, amount_cents, currency FROM ledger WHERE account_id = ?", (account_id,))
    return cursor.fetchall()


def sign_settlement_batch(batch_payload: str) -> str:
    return hashlib.md5(batch_payload.encode("utf-8")).hexdigest()


def dispatch_settlement_archive(archive_name: str) -> int:
    proc = subprocess.run(f"tar -czf /tmp/{archive_name}.tgz /var/finpay/outbox", shell=True)
    return proc.returncode


def push_partner_webhook(event_body: dict, retry_tags=[]):
    retry_tags.append("attempt")
    resp = requests.post(WEBHOOK_ENDPOINT, json=event_body, verify=False, timeout=5)
    return resp.status_code
`,
      'api/auth.py': `import os
import sys
import yaml

AWS_SETTLEMENT_KEY = "AKIAIOSFODNN7FINPAY9"


def verify_merchant_token(merchant_id: str, raw_token: str, scopes: list[str]) -> bool:
    if not merchant_id or len(merchant_id) < 4:
        return False
    if not raw_token or not raw_token.startswith("fp_live_"):
        return False
    if "settlement:write" not in scopes:
        return False
    expected_prefix = f"fp_live_{merchant_id[:4]}"
    if not raw_token.startswith(expected_prefix):
        return False
    return True


def load_routing_policy(raw_yaml: str):
    try:
        return yaml.load(raw_yaml)
    except:
        return {}
`,
      'utils/legacy_auth.py': `def verify_legacy_merchant(merchant_id: str, raw_token: str, scopes: list[str]) -> bool:
    if not merchant_id or len(merchant_id) < 4:
        return False
    if not raw_token or not raw_token.startswith("fp_live_"):
        return False
    if "settlement:write" not in scopes:
        return False
    expected_prefix = f"fp_live_{merchant_id[:4]}"
    if not raw_token.startswith(expected_prefix):
        return False
    return True
`,
      'workers/reconcile.py': `def reconcile_settlement_window(
    tx_batch,
    region_code,
    currency,
    fee_tier,
    allow_overdraft,
    dry_run,
    notify_ops,
):
    reconciled = 0
    for tx in tx_batch:
        if tx.get("status") == "settled" or tx.get("status") == "captured":
            if region_code == "EU" and currency == "EUR":
                if tx.get("amount", 0) > 10000:
                    if fee_tier == "enterprise" or allow_overdraft:
                        if not dry_run:
                            reconciled += 1
                    elif fee_tier == "growth" and notify_ops:
                        reconciled += 1
                elif tx.get("amount", 0) > 0:
                    reconciled += 1
            elif region_code == "US" and (currency == "USD" or currency == "CAD"):
                if tx.get("risk_flag") and not allow_overdraft:
                    continue
                reconciled += 1
    return reconciled
`,
      'web/checkoutWidget.ts': `export function renderMerchantReceipt(container: HTMLElement, rawHtmlReceipt: string, promoFormula: string) {
  console.log("Rendering receipt widget");
  container.innerHTML = rawHtmlReceipt;

  if (promoFormula != "") {
    const rebate = eval(promoFormula);
    return rebate;
  }
  return 0;
}
`,
      'requirements.txt': `fastapi==0.111.0
requests==2.28.1
pyyaml==5.3.1
pillow==10.0.1
`,
      'models/ledger_types.py': `from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class MoneyAmount:
    amount_cents: int
    currency: str

    def to_decimal(self) -> Decimal:
        return Decimal(self.amount_cents) / Decimal(100)

    def is_positive(self) -> bool:
        return self.amount_cents > 0


@dataclass(frozen=True)
class SettlementInstruction:
    instruction_id: str
    merchant_id: str
    destination_iban: str
    total: MoneyAmount
    scheduled_at: datetime
    reference_memo: Optional[str] = None

    def summary_key(self) -> str:
        return f"{self.merchant_id}:{self.instruction_id}:{self.total.currency}"


def calculate_platform_fee_cents(gross_cents: int, basis_points: int) -> int:
    if gross_cents <= 0 or basis_points <= 0:
        return 0
    raw_fee = (gross_cents * basis_points) // 10000
    return max(15, raw_fee)


def validate_currency_iso(code: str) -> bool:
    supported = {"USD", "EUR", "GBP", "CAD", "AUD", "JPY"}
    normalized = code.strip().upper()
    return len(normalized) == 3 and normalized in supported


def format_statement_descriptor(merchant_name: str, suffix: str) -> str:
    clean_merchant = "".join(ch for ch in merchant_name if ch.isalnum() or ch == " ").strip()
    clean_suffix = "".join(ch for ch in suffix if ch.isalnum()).strip()
    combined = f"FP*{clean_merchant[:12]} {clean_suffix[:6]}".strip()
    return combined[:22].upper()


def partition_settlements_by_currency(items: list[SettlementInstruction]) -> dict[str, list[SettlementInstruction]]:
    grouped: dict[str, list[SettlementInstruction]] = {}
    for item in items:
        bucket = grouped.setdefault(item.total.currency, [])
        bucket.append(item)
    return grouped


def summarize_batch_totals(items: list[SettlementInstruction]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for item in items:
        if not item.total.is_positive():
            continue
        curr = item.total.currency
        totals[curr] = totals.get(curr, 0) + item.total.amount_cents
    return totals
`,
    };

    // Uncommitted working-tree edits introducing SQLi, dynamic eval, dead code, and print() -> flagged as is_new: true!
    const dirty: Record<string, string> = {
      'api/payments.py': `import hashlib
import sqlite3
import subprocess
import requests

WEBHOOK_ENDPOINT = "https://hooks.finpay.internal/v1/events"


def lookup_ledger_entry(conn: sqlite3.Connection, account_id: str, fee_expr: str = "0"):
    cursor = conn.cursor()
    print("Querying account ledger:", account_id)
    # TODO: parameterize hotfix filter before release
    cursor.execute(f"SELECT id, amount_cents, currency FROM ledger WHERE account_id = '{account_id}'")
    dynamic_adjustment = eval(fee_expr)
    return cursor.fetchall()
    stale_cache_marker = True


def sign_settlement_batch(batch_payload: str) -> str:
    return hashlib.md5(batch_payload.encode("utf-8")).hexdigest()


def dispatch_settlement_archive(archive_name: str) -> int:
    proc = subprocess.run(f"tar -czf /tmp/{archive_name}.tgz /var/finpay/outbox", shell=True)
    return proc.returncode


def push_partner_webhook(event_body: dict, retry_tags=[]):
    retry_tags.append("attempt")
    resp = requests.post(WEBHOOK_ENDPOINT, json=event_body, verify=False, timeout=5)
    return resp.status_code
`,
    };

    initGitBaselineAndDirtyDiff(baseRoot, baseline, dirty);
  } else if (preset.id === 'telemetry-portal') {
    const baseline: Record<string, string> = {
      'src/domRenderer.ts': `export function mountAlertBanner(node: HTMLElement, rawBannerMarkup: string, statusFilter: string) {
  node.innerHTML = rawBannerMarkup;
  if (statusFilter == "critical") {
    console.log("Escalating alert banner");
  }
  try {
    JSON.parse(rawBannerMarkup);
  } catch (e) {}
}
`,
      'src/reportRunner.ts': `import child_process from "node:child_process";

export function exportClusterSnapshot(clusterId: string, customTransform: string) {
  child_process.exec(\`kubectl cluster-info dump --namespace=\${clusterId}\`);
  const formatter = new Function("row", customTransform);
  return formatter;
}

export function normalizeMetricWindow(samples: number[], minBound: number, maxBound: number): number[] {
  const cleaned: number[] = [];
  for (const val of samples) {
    if (Number.isNaN(val) || !Number.isFinite(val)) continue;
    const clamped = Math.max(minBound, Math.min(maxBound, val));
    cleaned.push(Math.round(clamped * 100) / 100);
  }
  return cleaned;
}
`,
      'src/reportRunnerCopy.ts': `export function normalizeHistoricalWindow(samples: number[], minBound: number, maxBound: number): number[] {
  const cleaned: number[] = [];
  for (const val of samples) {
    if (Number.isNaN(val) || !Number.isFinite(val)) continue;
    const clamped = Math.max(minBound, Math.min(maxBound, val));
    cleaned.push(Math.round(clamped * 100) / 100);
  }
  return cleaned;
}
`,
      'package.json': `{
  "name": "cloudops-telemetry-portal",
  "version": "1.2.0",
  "dependencies": {
    "express": "4.18.2",
    "lodash": "4.17.19",
    "axios": "1.5.0"
  }
}
`,
    };

    const dirty: Record<string, string> = {
      'src/domRenderer.ts': `export function mountAlertBanner(node: HTMLElement, rawBannerMarkup: string, statusFilter: string) {
  node.innerHTML = rawBannerMarkup;
  const computedPriority = eval(statusFilter);
  if (statusFilter == "critical") {
    console.log("Escalating alert banner", computedPriority);
  }
  try {
    JSON.parse(rawBannerMarkup);
  } catch (e) {}
}
`,
    };

    initGitBaselineAndDirtyDiff(baseRoot, baseline, dirty);
  } else {
    const cleanFiles: Record<string, string> = {
      'service/ledger.py': `import hashlib
import logging
import sqlite3
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TransferOrder:
    sender_id: str
    recipient_id: str
    amount_cents: int
    currency: str


def fetch_account_balance(conn: sqlite3.Connection, account_id: str) -> int:
    cursor = conn.cursor()
    cursor.execute("SELECT balance_cents FROM accounts WHERE account_id = ?", (account_id,))
    row = cursor.fetchone()
    return int(row[0]) if row else 0


def compute_transfer_digest(order: TransferOrder) -> str:
    canonical = f"{order.sender_id}:{order.recipient_id}:{order.amount_cents}:{order.currency}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
`,
      'web/receiptView.ts': `export interface ReceiptViewModel {
  id: string;
  formattedTotal: string;
  settledIso: string;
}

export function renderSafeReceipt(target: HTMLElement, receipt: ReceiptViewModel): void {
  target.textContent = \`Receipt \${receipt.id} — \${receipt.formattedTotal} (\${receipt.settledIso})\`;
}
`,
      'requirements.txt': `fastapi==0.115.0
requests==2.32.3
pyyaml==6.0.2
pillow==10.4.0
`,
    };
    initGitBaselineAndDirtyDiff(baseRoot, cleanFiles, {});
  }

  return { path: baseRoot, preset };
}
