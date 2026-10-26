import path from 'node:path';
import { VULNERABLE_PACKAGES } from '../data/vulnerablePackages.ts';
import type { VulnerablePackageAdvisory } from '../data/vulnerablePackages.ts';
import { computeFingerprint } from '../models.ts';
import type { Finding } from '../models.ts';
import type { BaseAnalyzer } from './base.ts';

function parseSemver(versionStr: string): [number, number, number] {
  const cleaned = versionStr.trim().replace(/^[\^~>=<v\s]+/, '');
  const parts = cleaned.split(/[.\-+]/);
  const nums: number[] = [];
  for (let i = 0; i < 3; i++) {
    const n = Number.parseInt(parts[i] || '0', 10);
    nums.push(Number.isNaN(n) ? 0 : n);
  }
  return [nums[0], nums[1], nums[2]];
}

export function isVersionBelow(version: string, threshold: string): boolean {
  const [majA, minA, patA] = parseSemver(version);
  const [majB, minB, patB] = parseSemver(threshold);
  if (majA !== majB) return majA < majB;
  if (minA !== minB) return minA < minB;
  return patA < patB;
}

export class DependencyAnalyzer implements BaseAnalyzer {
  readonly name = 'DependencyAnalyzer';

  supports(_language: string, filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    return base === 'requirements.txt' || base === 'package.json' || base === 'pyproject.toml';
  }

  analyze(filePath: string, source: string): Finding[] {
    const base = path.basename(filePath).toLowerCase();
    if (base === 'requirements.txt') return this.checkRequirements(filePath, source);
    if (base === 'package.json') return this.checkPackageJson(filePath, source);
    if (base === 'pyproject.toml') return this.checkPyproject(filePath, source);
    return [];
  }

  private checkRequirements(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const lines = source.split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const stripped = lines[idx].trim();
      if (!stripped || stripped.startsWith('#')) continue;

      const m = stripped.match(/^([a-zA-Z0-9_.-]+)\s*(?:==|~=)\s*([a-zA-Z0-9_.-]+)/);
      if (!m) continue;

      const pkgName = m[1].toLowerCase();
      const version = m[2];
      for (const vuln of VULNERABLE_PACKAGES) {
        if (vuln.ecosystem === 'pypi' && vuln.package === pkgName && isVersionBelow(version, vuln.affected_below)) {
          findings.push(this.buildFinding(filePath, lineNo, pkgName, version, vuln, stripped));
        }
      }
    }
    return findings;
  }

  private checkPackageJson(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(source) as Record<string, unknown>;
    } catch {
      return findings;
    }

    const mergedDeps: Record<string, string> = {};
    for (const key of ['dependencies', 'devDependencies']) {
      const section = parsed[key];
      if (section && typeof section === 'object') {
        for (const [k, v] of Object.entries(section as Record<string, unknown>)) {
          if (typeof v === 'string') mergedDeps[k] = v;
        }
      }
    }

    const lines = source.split(/\r?\n/);
    for (const [pkg, rawVer] of Object.entries(mergedDeps)) {
      const cleanVer = rawVer.replace(/^[\^~>=<\s]+/, '');
      if (!/^\d/.test(cleanVer)) continue;

      for (const vuln of VULNERABLE_PACKAGES) {
        if (vuln.ecosystem === 'npm' && vuln.package === pkg.toLowerCase() && isVersionBelow(cleanVer, vuln.affected_below)) {
          let targetLine = 1;
          for (let idx = 0; idx < lines.length; idx++) {
            if (lines[idx].includes(`"${pkg}"`)) {
              targetLine = idx + 1;
              break;
            }
          }
          const snippet = (lines[targetLine - 1] || `"${pkg}": "${rawVer}"`).trim();
          findings.push(this.buildFinding(filePath, targetLine, pkg, cleanVer, vuln, snippet));
        }
      }
    }
    return findings;
  }

  private checkPyproject(filePath: string, source: string): Finding[] {
    const findings: Finding[] = [];
    const lines = source.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const m = lines[idx].match(/["']([a-zA-Z0-9_.-]+)==([a-zA-Z0-9_.-]+)["']/);
      if (!m) continue;
      const pkgName = m[1].toLowerCase();
      const version = m[2];
      for (const vuln of VULNERABLE_PACKAGES) {
        if (vuln.ecosystem === 'pypi' && vuln.package === pkgName && isVersionBelow(version, vuln.affected_below)) {
          findings.push(this.buildFinding(filePath, idx + 1, pkgName, version, vuln, lines[idx].trim()));
        }
      }
    }
    return findings;
  }

  private buildFinding(
    filePath: string,
    line: number,
    pkg: string,
    version: string,
    vuln: VulnerablePackageAdvisory,
    snippet: string
  ): Finding {
    return {
      id: `dep-${pkg}-${line}`,
      file: filePath,
      line,
      end_line: line,
      rule_id: 'CP-DEP-001',
      category: 'dependency',
      severity: vuln.severity,
      confidence: 'high',
      title: `Vulnerable Dependency '${pkg}@${version}' (${vuln.cve})`,
      message: `${vuln.description} Patched in ${pkg} >= ${vuln.affected_below}.`,
      why_it_matters: 'Publicly disclosed CVEs in pinned packages expose known exploitation vectors.',
      suggested_fix: `Upgrade '${pkg}' to version >= ${vuln.affected_below} in ${path.basename(filePath)}.`,
      snippet,
      fingerprint: computeFingerprint(filePath, 'CP-DEP-001', snippet),
      is_new: false,
      dismissed: false,
      can_autofix: true,
    };
  }
}
