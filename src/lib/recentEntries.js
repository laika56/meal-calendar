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

export function createRecentMutationQueue() {
  let tail = Promise.resolve();

  return function enqueue(operation) {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  };
}

export async function persistRecentChipDeletion({ chip, container, section, persist }) {
  removeRecentChip(chip, container, section);
  await persist();
}
