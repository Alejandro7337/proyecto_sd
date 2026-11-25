#!/usr/bin/env bash
set -euo pipefail

repo='https://github.com/Alejandro7337/proyecto_sd.git'
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
patch_file="$source_root/artifacts/tu-espacio-avance.patch"
destination="$(dirname -- "$source_root")/proyecto_sd-git"
branch="avance/tu-espacio-$(date +%Y%m%d-%H%M%S)"

command -v git >/dev/null
command -v gh >/dev/null
[[ ! -e "$destination" ]] || { echo "El destino ya existe: $destination. No se sobrescribió nada." >&2; exit 1; }

# Regenerar antes de autenticar: nunca enviar un parche antiguo ni inventar historial.
python3 "$source_root/tuespacio/scripts/preparar-entrega.py"
source "$source_root/tuespacio/scripts/github-account.sh"
identity="$(institutional_identity)"
IFS=$'\t' read -r login account_id <<< "$identity"

git -c credential.helper= -c 'credential.helper=!gh auth git-credential' clone "$repo" "$destination"
git -C "$destination" switch -c "$branch"
git -C "$destination" apply --check "$patch_file"
git -C "$destination" apply "$patch_file"
git -C "$destination" config user.name 'santyshark1'
git -C "$destination" config user.email "${account_id}+santyshark1@users.noreply.github.com"
git -C "$destination" add --all
git -C "$destination" commit --file "$source_root/tuespacio/docs/COMMIT_ENTREGA.txt"
git -C "$destination" -c credential.helper= -c 'credential.helper=!gh auth git-credential' push --set-upstream origin "$branch"

echo "Subido: https://github.com/Alejandro7337/proyecto_sd/tree/$branch"
echo "Checkout con historial: $destination"
bash "$source_root/tuespacio/scripts/crear-pr.sh"
