export function withoutRecentEntry(entries, name) {
  return entries.filter((entry) => entry.name !== name);
}
