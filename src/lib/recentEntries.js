export function withoutRecentEntry(entries, name) {
  return entries.filter((entry) => entry.name !== name);
}

export function recentEntryRemovalUpdate(entry, arrayRemoveValue) {
  return { recentEntries: arrayRemoveValue(entry) };
}

export function removeRecentChip(chip, container, section) {
  chip.remove();
  section.hidden = container.childElementCount === 0;
}
