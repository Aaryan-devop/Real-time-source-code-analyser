import { runEvaluationBenchmark } from './benchmarkSuite.ts';

const summary = runEvaluationBenchmark();

console.log('=== CodePulse Static Analysis Benchmark ===');
console.log(`Cases Evaluated      : ${summary.total_cases}`);
console.log(`Precision            : ${summary.precision}%`);
console.log(`Recall               : ${summary.recall}%`);
console.log(`F1 Score             : ${summary.f1_score}%`);
console.log(`Secret Redaction     : ${summary.secret_redaction_rate}%`);
console.log(`Avg Latency / File   : ${summary.avg_file_latency_ms} ms`);
console.log('-------------------------------------------');
for (const c of summary.cases) {
  const status = c.falsePositives === 0 && c.falseNegatives === 0 && c.redactionVerified ? 'PASS' : 'WARN';
  console.log(`[${status}] ${c.name} (${c.durationMs} ms) -> TP:${c.truePositives} FP:${c.falsePositives} FN:${c.falseNegatives}`);
}
