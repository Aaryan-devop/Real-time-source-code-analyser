import type { Finding } from '../models.ts';

export type AnalyzerResult = Finding[] | [Finding[], number[]];

export interface BaseAnalyzer {
  readonly name: string;
  supports(language: string, filePath: string): boolean;
  analyze(filePath: string, source: string): AnalyzerResult;
}
