function normalizeSource(source) {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/, '');
}

function compareEntry({ name, appSource, functionsSource }) {
  if (appSource === null && functionsSource === null) {
    return { name, status: 'missing-both' };
  }
  if (appSource === null) {
    return { name, status: 'missing-app' };
  }
  if (functionsSource === null) {
    return { name, status: 'missing-functions' };
  }

  return {
    name,
    status: normalizeSource(appSource) === normalizeSource(functionsSource)
      ? 'same'
      : 'drift',
  };
}

function compareNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

export function compareSharedModules(entries) {
  const compared = entries.map(compareEntry).sort(compareNames);
  const problems = compared.filter(({ status }) => status !== 'same');

  return {
    ok: problems.length === 0,
    entries: compared,
    problems,
  };
}
