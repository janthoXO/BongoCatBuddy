#!/bin/sh
# Decompiles the installed game's C# (Assembly-CSharp.dll, Mono build) to ./decompiled/
# with ilspycmd in a throwaway .NET container. Game dir mounted read-only.
#   scripts/decompile-game.sh [path/to/Managed]
set -eu
MANAGED=${1:-"$HOME/Library/Application Support/Steam/steamapps/common/BongoCat/BongoCat.app/Contents/Resources/Data/Managed"}
OUT="$(cd "$(dirname "$0")/.." && pwd)/decompiled"
[ -f "$MANAGED/Assembly-CSharp.dll" ] || { echo "no Assembly-CSharp.dll in $MANAGED" >&2; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"
docker run --rm -v "$MANAGED:/in:ro" -v "$OUT:/out" mcr.microsoft.com/dotnet/sdk:8.0 sh -c '
  dotnet tool install -g ilspycmd --version 9.1.0.7988 >/dev/null &&
  ~/.dotnet/tools/ilspycmd -p -r /in -o /out /in/Assembly-CSharp.dll'
echo "decompiled to $OUT"
