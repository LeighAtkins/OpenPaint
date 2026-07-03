import { notifyOpenPaint } from './notification-center';

export function showRewardAchievement(message: string): void {
  notifyOpenPaint({
    message,
    kind: 'reward',
    title: 'Gems',
    icon: '*',
    durationMs: 3200,
  });
}

export function getNoRewardMessage(reason?: string): string {
  if (reason === 'cooldown') return 'Save completed. No gems this time (cooldown active).';
  if (reason === 'daily_cap') return 'Save completed. Daily gem cap reached.';
  if (reason === 'already_earned') return 'Save completed. Gems already earned for this save.';
  if (reason === 'not_qualifying')
    return 'Save completed. No gems awarded: add at least one mark on an image.';
  if (reason === 'insufficient_new_marks')
    return 'Save completed. No gems awarded: add at least 2 new lines before next reward.';
  if (reason === 'pdf_cooldown') return 'PDF exported. No gems this time (PDF cooldown active).';
  return 'Save completed. No gems awarded this time.';
}
