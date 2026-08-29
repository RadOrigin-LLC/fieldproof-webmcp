import type { CloseoutPhase } from '../domain/closeout.ts';
import type { WorkdayStatus } from '../domain/workdays.ts';

export const HANDOFF_STATUS_LABELS: Record<CloseoutPhase, string> = {
  'not-checked': 'Not checked',
  checking: 'Checking',
  'needs-attention': 'Needs attention',
  'ready-with-warnings': 'Ready with notes',
  ready: 'Ready for handoff',
  'check-again': 'Check again',
  'check-failed': 'Review failed',
};

export const HANDOFF_ACTION_LABELS: Record<CloseoutPhase, string> = {
  'not-checked': 'Run handoff review',
  checking: 'Show current progress',
  'needs-attention': 'Review Suggested Updates',
  'ready-with-warnings': 'Review notes',
  ready: 'Open Handoff Packet',
  'check-again': 'Check again',
  'check-failed': 'Try again',
};

export const WORKDAY_STATUS_LABELS: Record<WorkdayStatus, string> = {
  'not-checked': 'Not checked',
  checking: 'Checking',
  complete: 'Complete',
  'needs-attention': 'Needs attention',
  'worth-a-look': 'Worth a look',
  'check-again': 'Check again',
};

export function startsHandoffReview(phase: CloseoutPhase): boolean {
  return ['not-checked', 'check-again', 'check-failed'].includes(phase);
}
