#!/usr/bin/env bash
# Se consulta la identidad remota; una etiqueta local de cuenta no identifica al token.
institutional_identity() {
  local identity login account_id
  identity="$(gh api user --jq '[.login, .id] | @tsv')" || {
    echo 'No se pudo verificar la identidad en GitHub. Revisa la conexión y la sesión local; no se subió nada.' >&2
    return 1
  }
  IFS=$'\t' read -r login account_id <<< "$identity"
  if [[ "$login" != 'santyshark1' ]]; then
    gh auth switch --hostname github.com --user santyshark1 >&2 || return 1
    identity="$(gh api user --jq '[.login, .id] | @tsv')" || return 1
    IFS=$'\t' read -r login account_id <<< "$identity"
  fi
  [[ "$login" == 'santyshark1' && "$account_id" =~ ^[0-9]+$ ]] || {
    echo 'GitHub no confirmó la cuenta institucional santyshark1. No se subió nada.' >&2
    return 1
  }
  printf '%s\t%s\n' "$login" "$account_id"
}
