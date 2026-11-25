#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
checkout="$(dirname -- "$source_root")/proyecto_sd-git"
repo='Alejandro7337/proyecto_sd'
[[ -d "$checkout/.git" ]] || { echo 'Primero ejecuta tuespacio/scripts/subir-avance.sh.' >&2; exit 1; }

source "$source_root/tuespacio/scripts/github-account.sh"
identity="$(institutional_identity)"
branch="$(git -C "$checkout" branch --show-current)"
[[ "$branch" == avance/tu-espacio-* ]] || { echo "No se creará un PR para una rama inesperada: $branch" >&2; exit 1; }
existing="$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url // empty')"
if [[ -n "$existing" ]]; then
  echo "$existing"
  exit 0
fi
base="$(gh repo view "$repo" --json defaultBranchRef --jq .defaultBranchRef.name)"
gh pr create --repo "$repo" --base "$base" --head "$branch" --draft \
  --title 'Tu Espacio: reservas, pagos y servicios regionales' \
  --body-file "$source_root/tuespacio/docs/PR_AVANCE.md"
