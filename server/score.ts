import { settings } from './config.ts';
import { SEVERITIES } from './models.ts';
import type { Finding, Severity } from './models.ts';

export function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90.0) return 'A';
  if (score >= 80.0) return 'B';
  if (score >= 70.0) return 'C';
  if (score >= 60.0) return 'D';
  return 'F';
}

export function calculateHealthScore(
  findings: Finding[],
  totalLoc: number
): {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  countsBySeverity: Record<Severity, number>;
  countsByCategory: Record<string, number>;
} {
  const countsBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const s of SEVERITIES) {
    countsBySeverity[s] = 0;
  }

  const countsByCategory: Record<string, number> = {};
  let totalPenalty = 0.0;

  for (const f of findings) {
    if (f.dismissed) {
      continue;
    }

    countsBySeverity[f.severity] = (countsBySeverity[f.severity] || 0) + 1;
    countsByCategory[f.category] = (countsByCategory[f.category] || 0) + 1;

    if (f.severity === 'critical') {
      totalPenalty += settings.WEIGHT_CRITICAL;
    } else if (f.severity === 'high') {
      totalPenalty += settings.WEIGHT_HIGH;
    } else if (f.severity === 'medium') {
      totalPenalty += settings.WEIGHT_MEDIUM;
    } else if (f.severity === 'low') {
      totalPenalty += settings.WEIGHT_LOW;
    }
  }

  // Normalize penalty density against lines of code (minimum baseline of 50 LOC)
  const effectiveLoc = Math.max(totalLoc, 50);
  const penaltyDensity = (totalPenalty / effectiveLoc) * 100.0;
  const rawScore = 100.0 - penaltyDensity;
  const score = Math.max(0.0, Math.min(100.0, Math.round(rawScore * 10) / 10));
  const grade = scoreToGrade(score);

  return { score, grade, countsBySeverity, countsByCategory };
}
