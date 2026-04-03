const kickInProgress = new Set<string>();

function key(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function markKickInProgress(chatId: number, userId: number): void {
  kickInProgress.add(key(chatId, userId));
  setTimeout(() => kickInProgress.delete(key(chatId, userId)), 30_000);
}

export function isKickInProgress(chatId: number, userId: number): boolean {
  return kickInProgress.has(key(chatId, userId));
}

export function clearKick(chatId: number, userId: number): void {
  kickInProgress.delete(key(chatId, userId));
}

