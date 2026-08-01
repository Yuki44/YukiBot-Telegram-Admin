/**
 * Canonical placeholder used when a topic is discovered passively and its real
 * name is unknown. The deletion sweep must never probe a placeholder-named row:
 * Telegram would accept the rename and retitle a live topic to this string.
 */
export const placeholderTopicName = (topicId: number): string => `Tema #${topicId}`;

export const isPlaceholderTopicName = (name: string, topicId: number): boolean =>
  name.trim() === "" || name === placeholderTopicName(topicId);
