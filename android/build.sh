#!/bin/sh
# Builds the Android app (android/) into publish/FlintNotes-<version>.apk. The tools are looked for in ~/.local/android (a JDK 17,
# the Android SDK with platform 35 and build-tools 35.0.0, Gradle through the wrapper); `android/build.sh setup` fetches them there.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$here/..
tools=${FLINT_ANDROID_TOOLS:-$HOME/.local/android}

if [ "${1:-}" = setup ]; then
  command -v curl >/dev/null || { echo "curl is needed" >&2; exit 1; }
  mkdir -p "$tools/dl" "$tools/jdk" "$tools/sdk/cmdline-tools"
  [ -x "$tools/jdk/bin/java" ] || {
    curl -fsSL -o "$tools/dl/jdk.tar.gz" 'https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse'
    tar -xzf "$tools/dl/jdk.tar.gz" -C "$tools/jdk" --strip-components=1
  }
  [ -d "$tools/sdk/cmdline-tools/latest" ] || {
    zip=$(curl -fsSL https://dl.google.com/android/repository/repository2-3.xml | grep -o 'commandlinetools-linux-[0-9]*_latest.zip' | head -n 1)
    curl -fsSL -o "$tools/dl/cmdline.zip" "https://dl.google.com/android/repository/$zip"
    unzip -q -o "$tools/dl/cmdline.zip" -d "$tools/sdk/cmdline-tools"
    mv "$tools/sdk/cmdline-tools/cmdline-tools" "$tools/sdk/cmdline-tools/latest"
  }
  # The licences of the Android SDK are accepted here (https://developer.android.com/studio/terms), as installing it means.
  yes | JAVA_HOME=$tools/jdk "$tools/sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$tools/sdk" "platforms;android-35" "build-tools;35.0.0"
  echo "Tools are in $tools"
  exit 0
fi

[ -x "$tools/jdk/bin/java" ] && [ -d "$tools/sdk/platforms/android-35" ] || { echo "The Android tools are not in $tools: run  android/build.sh setup" >&2; exit 1; }
export JAVA_HOME=$tools/jdk ANDROID_HOME=$tools/sdk
echo "sdk.dir=$ANDROID_HOME" >"$here/local.properties"
(cd "$here" && ./gradlew --no-daemon -q assembleRelease)
version=$(node -p "require('$root/package.json').version")
mkdir -p "$root/publish"
cp "$here/app/build/outputs/apk/release/app-release.apk" "$root/publish/FlintNotes-$version.apk"
echo "publish/FlintNotes-$version.apk"
