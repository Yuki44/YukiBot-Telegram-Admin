/** Canonical first+last name: the ONE composition used by every writer and comparator of a
 *  user's stored name, so two paths can't manufacture a phantom "profile changed" diff (G17). */
export function fullName(from: { first_name?: string; last_name?: string }): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}
