import type { Severity } from '../models.ts';

export interface VulnerablePackageAdvisory {
  ecosystem: 'pypi' | 'npm';
  package: string;
  affected_below: string;
  cve: string;
  severity: Severity;
  description: string;
}

export const VULNERABLE_PACKAGES: readonly VulnerablePackageAdvisory[] = [
  {
    ecosystem: 'pypi',
    package: 'requests',
    affected_below: '2.31.0',
    cve: 'CVE-2023-32681',
    severity: 'medium',
    description: 'Proxy-Authorization header leakage to unintended destinations upon HTTPS redirect.',
  },
  {
    ecosystem: 'pypi',
    package: 'flask',
    affected_below: '2.2.5',
    cve: 'CVE-2023-30861',
    severity: 'high',
    description: 'Cookie Vary header omission enables session caching under certain reverse proxies.',
  },
  {
    ecosystem: 'pypi',
    package: 'urllib3',
    affected_below: '2.0.7',
    cve: 'CVE-2023-45803',
    severity: 'medium',
    description: 'Request body not stripped after HTTP redirect changing method to GET.',
  },
  {
    ecosystem: 'pypi',
    package: 'cryptography',
    affected_below: '41.0.6',
    cve: 'CVE-2023-49083',
    severity: 'medium',
    description: 'NULL pointer dereference when loading malformed PKCS#7 certificates.',
  },
  {
    ecosystem: 'pypi',
    package: 'django',
    affected_below: '4.2.8',
    cve: 'CVE-2023-46695',
    severity: 'high',
    description: 'Denial-of-service in UsernameField via NFKC normalization of large inputs.',
  },
  {
    ecosystem: 'pypi',
    package: 'jinja2',
    affected_below: '3.1.3',
    cve: 'CVE-2024-22195',
    severity: 'medium',
    description: 'Cross-site scripting via xmlattr template filter accepting keys with whitespace.',
  },
  {
    ecosystem: 'pypi',
    package: 'pillow',
    affected_below: '10.2.0',
    cve: 'CVE-2024-28219',
    severity: 'critical',
    description: 'Buffer overflow in _imagingcms.c string copying allowing arbitrary code execution.',
  },
  {
    ecosystem: 'pypi',
    package: 'pyyaml',
    affected_below: '5.4.0',
    cve: 'CVE-2020-14343',
    severity: 'critical',
    description: 'Arbitrary code execution through untrusted YAML tags via FullLoader.',
  },
  {
    ecosystem: 'npm',
    package: 'lodash',
    affected_below: '4.17.21',
    cve: 'CVE-2021-23337',
    severity: 'high',
    description: 'Command injection via template function variable option interpolation.',
  },
  {
    ecosystem: 'npm',
    package: 'axios',
    affected_below: '1.6.0',
    cve: 'CVE-2023-45857',
    severity: 'high',
    description: 'XSRF-TOKEN cookie leaked to third-party hosts when withCredentials is active.',
  },
  {
    ecosystem: 'npm',
    package: 'express',
    affected_below: '4.19.2',
    cve: 'CVE-2024-29041',
    severity: 'medium',
    description: 'Open redirect vulnerability via malformed URL encoding in res.location.',
  },
  {
    ecosystem: 'npm',
    package: 'minimist',
    affected_below: '1.2.6',
    cve: 'CVE-2021-44906',
    severity: 'critical',
    description: 'Prototype pollution via crafted CLI argument keys.',
  },
  {
    ecosystem: 'npm',
    package: 'json5',
    affected_below: '2.2.2',
    cve: 'CVE-2022-46175',
    severity: 'high',
    description: 'Prototype pollution via __proto__ property in JSON5.parse.',
  },
  {
    ecosystem: 'npm',
    package: 'semver',
    affected_below: '7.5.2',
    cve: 'CVE-2022-25883',
    severity: 'medium',
    description: 'Regular expression denial of service (ReDoS) on untrusted version strings.',
  },
  {
    ecosystem: 'npm',
    package: 'tar',
    affected_below: '6.1.11',
    cve: 'CVE-2021-37712',
    severity: 'high',
    description: 'Arbitrary file creation/overwrite via symlink path traversal during extraction.',
  },
];
