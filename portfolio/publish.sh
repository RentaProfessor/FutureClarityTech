#!/usr/bin/env bash
# Publishes each portfolio project in this folder as its own public repository on the GitHub
# account the GitHub CLI is logged in to, each starting from one clean commit. Also creates the
# profile README repository (<username>/<username>).
#
#   gh auth login                 # log in as your PERSONAL account first
#   ./publish.sh --dry-run        # show what would happen
#   ./publish.sh                  # publish everything
#   ./publish.sh webrtc-poker     # publish one project
#
# It never deletes or overwrites anything: a repository that already exists is skipped.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=0
ONLY=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) ONLY+=("$arg") ;;
  esac
done

# folder (= repository name) | description | topics | homepage
PROJECTS=(
  "redline-shopify-store|Shopify store for a concept streetwear brand: SKU standard, tag-driven collections, and a catalog audit tool|shopify,ecommerce,merchandising,graphql,python|https://eepcnb-0u.myshopify.com"
  "local-business-lead-finder|Finds local businesses whose websites are dead, parked or broken: Cloudflare Pages Functions, Postgres, a dependency-free PDF writer|cloudflare-pages,supabase,postgresql,javascript,pdf|"
  "legacy-tape-firmware|ESP32-S3 firmware for a cassette-style story recorder: LVGL touch UI, BLE Wi-Fi provisioning, chunked HTTPS audio upload|esp32,freertos,lvgl,embedded,arduino|"
  "plantwatch|Soil-moisture monitoring and forecast-aware watering advice from Ecowitt sensors: Supabase edge functions, a PWA and a SwiftUI app|supabase,deno,iot,swiftui,pwa|"
  "webrtc-poker|Peer-to-peer Texas Hold'em in the browser over WebRTC, with a tested host-authoritative game engine|typescript,webrtc,peerjs,vite,vitest|"
  "assigndash|Turns course syllabi into an assignment dashboard using OpenAI structured outputs: Express and Supabase|nodejs,express,openai,supabase,javascript|"
)

run() {
  if [[ $DRY_RUN == 1 ]]; then
    printf '  [dry run]'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
if [[ $DRY_RUN == 1 ]] && ! gh auth status >/dev/null 2>&1; then
  OWNER="your-username"
else
  command -v gh >/dev/null || { echo "Install the GitHub CLI: https://cli.github.com" >&2; exit 1; }
  OWNER="$(gh api user --jq .login)"
fi
if [[ -z "$(git config user.email || true)" ]]; then
  echo "Set your commit identity first, e.g.:" >&2
  echo '  git config --global user.name "Your Name"' >&2
  echo '  git config --global user.email "you@example.com"   # an email verified on your GitHub account' >&2
  exit 1
fi
AUTHOR="$(git config user.name) <$(git config user.email)>"
echo "Publishing to github.com/$OWNER as $AUTHOR"
echo "(Commits only count on your contribution graph if that email is verified on $OWNER.)"
echo

repo_exists() {
  [[ $DRY_RUN == 1 && $OWNER == "your-username" ]] && return 1
  gh repo view "$OWNER/$1" >/dev/null 2>&1
}

# Copies a folder into a fresh repository with a single commit and pushes it as a new repo.
publish_folder() {
  local folder="$1" name="$2" description="$3" topics="$4" homepage="$5"
  if repo_exists "$name"; then
    echo "skip  $name (github.com/$OWNER/$name already exists)"
    return
  fi
  local tmp
  tmp="$(mktemp -d)"
  cp -R "$KIT_DIR/$folder/." "$tmp/"
  rm -rf -- "${tmp:?}/.git" # always start from fresh history
  # Profile and project READMEs link to sibling repositories by owner
  local file
  for file in $(grep -rlI --exclude-dir=.git 'YOUR_GITHUB_USERNAME' "$tmp" || true); do
    sed -i.bak "s/YOUR_GITHUB_USERNAME/$OWNER/g" "$file" && rm -f "$file.bak"
  done
  git -C "$tmp" init -q -b main
  git -C "$tmp" add -A
  git -C "$tmp" commit -q -m "Initial commit"
  echo "push  $name ($(git -C "$tmp" ls-files | wc -l | tr -d ' ') files)"
  local args=(repo create "$OWNER/$name" --public --source "$tmp" --push --description "$description")
  [[ -n $homepage ]] && args+=(--homepage "$homepage")
  run gh "${args[@]}"
  if [[ -n $topics ]]; then
    local topic_args=()
    IFS=',' read -ra list <<< "$topics"
    for t in "${list[@]}"; do topic_args+=(--add-topic "$t"); done
    run gh repo edit "$OWNER/$name" "${topic_args[@]}"
  fi
  rm -rf -- "${tmp:?}"
}

wanted() {
  [[ ${#ONLY[@]} -eq 0 ]] && return 0
  local x
  for x in "${ONLY[@]}"; do [[ $x == "$1" ]] && return 0; done
  return 1
}

for entry in "${PROJECTS[@]}"; do
  IFS='|' read -r name description topics homepage <<< "$entry"
  wanted "$name" || continue
  if [[ ! -d "$KIT_DIR/$name" ]]; then
    echo "skip  $name (no $name/ folder in this kit)"
    continue
  fi
  publish_folder "$name" "$name" "$description" "$topics" "$homepage"
done

if wanted profile; then
  publish_folder "profile" "$OWNER" "" "" ""
fi

echo
echo "Done. Next: pin the six repositories on your profile (Customize your pins)."
