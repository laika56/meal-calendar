const CDN_PIN_PATTERN =
  /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(@[^/\s"'`]+\/[^/@\s"'`]+|[^/@\s"'`]+)@([^/\s"'`]+)\/[^\s"'`]+/g;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function extractCdnPins(source) {
  if (typeof source !== 'string') {
    throw new TypeError('source must be a string');
  }

  const pins = [];
  for (const match of source.matchAll(CDN_PIN_PATTERN)) {
    pins.push({
      url: match[0],
      package: match[1],
      version: match[2],
    });
  }

  return pins.sort((left, right) => compareStrings(left.url, right.url));
}

export function comparePinnedDeps(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array');
  }

  const packages = new Map();

  for (const { name, source } of entries) {
    for (const pin of extractCdnPins(source)) {
      if (!packages.has(pin.package)) {
        packages.set(pin.package, new Map());
      }

      const versions = packages.get(pin.package);
      if (!versions.has(pin.version)) {
        versions.set(pin.version, []);
      }
      versions.get(pin.version).push(name);
    }
  }

  const problems = [];

  for (const [packageName, versions] of packages) {
    for (const [version, files] of versions) {
      if (!EXACT_VERSION_PATTERN.test(version)) {
        problems.push({
          package: packageName,
          kind: 'unpinned',
          version,
          files: files.sort(compareStrings),
        });
      }
    }

    if (versions.size >= 2) {
      problems.push({
        package: packageName,
        kind: 'version-mismatch',
        versions: [...versions.keys()].sort(compareStrings),
      });
    }
  }

  problems.sort((left, right) => {
    const packageOrder = compareStrings(left.package, right.package);
    return packageOrder || compareStrings(left.kind, right.kind);
  });

  return {
    ok: problems.length === 0,
    problems,
  };
}
