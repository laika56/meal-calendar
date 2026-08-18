# meal-calendar

## Testing

Run the regular test suite with:

```sh
npm test
```

The Firestore catalog-rules integration test intentionally skips in that command when no emulator is running. Its non-skipping gate is:

```sh
npm run test:firestore-rules
```

That script uses the repository-pinned `firebase-tools@15.26.0` and starts a local Firestore Emulator. It never writes to the real Firebase project, but the emulator requires Java 21. Do not install a system JDK just for this gate: the following macOS procedure downloads an ephemeral official Temurin JRE, verifies the checksum published by Adoptium, and removes it even if the test fails.

```sh
set -euo pipefail

case "$(uname -m)" in
  arm64) adoptium_arch='aarch64' ;;
  x86_64) adoptium_arch='x64' ;;
  *) echo "unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

temporary_dir="$(mktemp -d)"
cleanup() { find "$temporary_dir" -depth -delete; }
trap cleanup EXIT

metadata_url="https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${adoptium_arch}&image_type=jre&os=mac&vendor=eclipse"
metadata_path="$temporary_dir/adoptium.json"
curl --fail --location --silent --show-error "$metadata_url" --output "$metadata_path"
archive_url="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(0, 'utf8'))[0].binary.package.link)" < "$metadata_path")"
published_sha256="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(0, 'utf8'))[0].binary.package.checksum)" < "$metadata_path")"
archive_path="$temporary_dir/temurin-jre.tar.gz"
curl --fail --location --silent --show-error "$archive_url" --output "$archive_path"
actual_sha256="$(shasum -a 256 "$archive_path" | cut -d ' ' -f 1)"
test "$actual_sha256" = "$published_sha256"

tar -xzf "$archive_path" -C "$temporary_dir"
java_home="$(find "$temporary_dir" -type d -path '*/Contents/Home' -print -quit)"
test -n "$java_home"
JAVA_HOME="$java_home" PATH="$java_home/bin:$PATH" npm run test:firestore-rules
```

The metadata URL selects the latest GA Temurin 21 HotSpot **JRE** for macOS `aarch64` (Apple Silicon) or `x64` (Intel); the downloaded archive is accepted only when its SHA-256 equals the value in that just-fetched official metadata. The `EXIT` trap cleans up the `mktemp` directory after emulator shutdown.
