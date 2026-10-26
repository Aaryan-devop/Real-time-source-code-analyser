import React from 'react';
import { AlertCircle, AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import type { Severity } from '../types';

interface SeverityLabelProps {
  severity: Severity;
  showIcon?: boolean;
}

const CONFIG: Record<
  Severity,
  {
    label: string;
    textClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  critical: {
    label: 'Critical',
    textClass: 'text-red-400',
    Icon: AlertOctagon,
  },
  high: {
    label: 'High',
    textClass: 'text-orange-400',
    Icon: AlertTriangle,
  },
  medium: {
    label: 'Medium',
    textClass: 'text-amber-300',
    Icon: AlertCircle,
  },
  low: {
    label: 'Low',
    textClass: 'text-sky-400',
    Icon: Info,
  },
  info: {
    label: 'Info',
    textClass: 'text-slate-400',
    Icon: Info,
  },
};

export function SeverityLabel({ severity, showIcon = true }: SeverityLabelProps) {
  const entry = CONFIG[severity] || CONFIG.info;
  const IconComp = entry.Icon;

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${entry.textClass}`}>
      {showIcon && <IconComp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{entry.label}</span>
    </span>
  );
}
