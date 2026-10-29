#!/usr/bin/env bash
# Critique installer: puts the plugin into an Obsidian vault and the agent skill where your
# AI coding agents look for skills.
#
#   curl -sS https://raw.githubusercontent.com/melnicorn/critique-obsidian/main/install.sh | bash
#
# The script asks what it needs. Pass flags to answer ahead of time (handy for scripting):
#
#   curl -sS .../install.sh | bash -s -- --vault ~/Notes --skill --global --agents claude,codex
#
# Options
#   --vault PATH        Vault to install the plugin into (a folder holding .obsidian).
#   --version X.Y.Z     Release to install (default: latest).
#   --no-plugin         Skip the plugin; only install the skill.
#   --skill             Install the agent skill (asked when omitted and running interactively).
#   --no-skill          Skip the skill.
#   --global            Put the skill in the home-folder skills directory of each agent.
#   --local [DIR]       Put the skill in a project folder (default: the current directory).
#   --agents LIST       Comma-separated: claude, copilot, codex, gemini, cursor, or all.
#   -y, --yes           Accept defaults for anything not given on the command line.
#   -h, --help          Show this help.

set -euo pipefail

REPO="melnicorn/critique-obsidian"
PLUGIN_ID="critique"
RELEASE_FILES="main.js manifest.json styles.css SKILL.md"
AGENT_KEYS="claude copilot codex gemini cursor"

VERSION="latest"
VAULT=""
INSTALL_PLUGIN=1
INSTALL_SKILL=""       # "" (ask), 1 or 0
SKILL_SCOPE=""         # "" (ask), local or global
PROJECT_DIR=""
AGENTS=""
ASSUME_YES=0

# ── Output helpers ───────────────────────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Critique installer: puts the plugin into an Obsidian vault and the agent skill where your
AI coding agents look for skills.

  curl -sS https://raw.githubusercontent.com/melnicorn/critique-obsidian/main/install.sh | bash

The script asks what it needs. Pass flags to answer ahead of time (handy for scripting):

  curl -sS .../install.sh | bash -s -- --vault ~/Notes --skill --global --agents claude,codex

Options
  --vault PATH        Vault to install the plugin into (a folder holding .obsidian).
  --version X.Y.Z     Release to install (default: latest).
  --no-plugin         Skip the plugin; only install the skill.
  --skill             Install the agent skill (asked when omitted and running interactively).
  --no-skill          Skip the skill.
  --global            Put the skill in the home-folder skills directory of each agent.
  --local [DIR]       Put the skill in a project folder (default: the current directory).
  --agents LIST       Comma-separated: claude, copilot, codex, gemini, cursor, or all.
  -y, --yes           Accept defaults for anything not given on the command line.
  -h, --help          Show this help.
USAGE
}

# When run as `curl ... | bash`, stdin is the script itself, so prompts read from the terminal.
INTERACTIVE=0
if ( : < /dev/tty ) 2>/dev/null && ( : > /dev/tty ) 2>/dev/null; then INTERACTIVE=1; fi

# ask VAR "Prompt" "default"  → sets VAR; uses the default when non-interactive or --yes.
ask() {
  local __var="$1" __prompt="$2" __default="${3:-}" __answer=""
  if [ "$INTERACTIVE" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
    if [ -n "$__default" ]; then
      printf '%s %s(%s)%s ' "$__prompt" "$DIM" "$__default" "$RESET" > /dev/tty
    else
      printf '%s ' "$__prompt" > /dev/tty
    fi
    IFS= read -r __answer < /dev/tty || __answer=""
  fi
  [ -n "$__answer" ] || __answer="$__default"
  printf -v "$__var" '%s' "$__answer"
}

# ask_yn "Prompt" y|n → 0 for yes, 1 for no.
ask_yn() {
  local prompt="$1" default="$2" hint answer
  if [ "$default" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  ask answer "$prompt $hint" "$default"
  case "$answer" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Argument parsing ─────────────────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --vault)      [ $# -ge 2 ] || die "--vault needs a path"; VAULT="$2"; shift 2 ;;
    --vault=*)    VAULT="${1#--vault=}"; shift ;;
    --version)    [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
    --version=*)  VERSION="${1#--version=}"; shift ;;
    --no-plugin)  INSTALL_PLUGIN=0; shift ;;
    --skill)      INSTALL_SKILL=1; shift ;;
    --no-skill)   INSTALL_SKILL=0; shift ;;
    --global)     INSTALL_SKILL=1; SKILL_SCOPE="global"; shift ;;
    --local)      INSTALL_SKILL=1; SKILL_SCOPE="local"
                  if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then PROJECT_DIR="$2"; shift; fi
                  shift ;;
    --local=*)    INSTALL_SKILL=1; SKILL_SCOPE="local"; PROJECT_DIR="${1#--local=}"; shift ;;
    --project)    [ $# -ge 2 ] || die "--project needs a path"; INSTALL_SKILL=1; SKILL_SCOPE="local"; PROJECT_DIR="$2"; shift 2 ;;
    --agents)     [ $# -ge 2 ] || die "--agents needs a list"; INSTALL_SKILL=1; AGENTS="$2"; shift 2 ;;
    --agents=*)   INSTALL_SKILL=1; AGENTS="${1#--agents=}"; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "Unknown option: $1 (try --help)" ;;
  esac
done

VERSION="${VERSION#v}"

# ── Path helpers ─────────────────────────────────────────────────────────────────────────────

# Tidy a pasted or dragged path: strip quotes, unescape spaces, expand ~, drop a trailing slash.
clean_path() {
  local p="$1"
  p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"
  case "$p" in \"*\") p="${p#\"}"; p="${p%\"}" ;; \'*\') p="${p#\'}"; p="${p%\'}" ;; esac
  p="${p//\\ / }"
  case "$p" in "~") p="$HOME" ;; "~/"*) p="$HOME/${p#\~/}" ;; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  printf '%s' "$p"
}

abs_path() { (cd "$1" 2>/dev/null && pwd -P); }

# A vault is a folder holding .obsidian. Accept the .obsidian folder itself too.
vault_root() {
  local p; p="$(clean_path "$1")"
  [ -n "$p" ] || return 1
  case "$p" in */.obsidian) p="${p%/.obsidian}" ;; esac
  [ -d "$p/.obsidian" ] || return 1
  abs_path "$p"
}

# Walk up from the current directory looking for a vault.
detect_vault() {
  local d; d="$(pwd -P)"
  while :; do
    if [ -d "$d/.obsidian" ]; then printf '%s' "$d"; return 0; fi
    [ "$d" = "/" ] && return 1
    d="$(dirname "$d")"
  done
}

manifest_version() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1; }

# ── Download ─────────────────────────────────────────────────────────────────────────────────

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "Need curl or wget to download the release."
  fi
}

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t critique)"
trap 'rm -rf "$TMP"' EXIT

if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/$REPO/releases/latest/download"
else
  BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
fi

say ""
say "${BOLD}Critique${RESET} ${DIM}· CriticMarkup review for Obsidian${RESET}"
say ""
printf 'Downloading release %s… ' "$VERSION"
for f in $RELEASE_FILES; do
  fetch "$BASE_URL/$f" "$TMP/$f" || { printf '\n'; die "Could not download $f from $BASE_URL (is $VERSION a published release?)"; }
done
RELEASE_VERSION="$(manifest_version "$TMP/manifest.json")"
[ -n "$RELEASE_VERSION" ] || die "Downloaded manifest.json has no version; aborting."
printf '%s\n' "got ${BOLD}$RELEASE_VERSION${RESET}"
say ""

# ── Plugin ───────────────────────────────────────────────────────────────────────────────────

PLUGIN_DEST=""

if [ "$INSTALL_PLUGIN" -eq 1 ]; then
  say "${BOLD}Installing the Critique plugin into Obsidian${RESET}"

  if [ -n "$VAULT" ]; then
    given="$VAULT"
    VAULT="$(vault_root "$given" || true)"
    [ -n "$VAULT" ] || die "No .obsidian folder found in '$(clean_path "$given")'. Point --vault at the vault's top folder."
  else
    detected="$(detect_vault || true)"
    if [ -n "$detected" ]; then
      if [ "$INTERACTIVE" -eq 0 ] || [ "$ASSUME_YES" -eq 1 ] || \
         ask_yn "  Vault ${BOLD}$(basename "$detected")${RESET} detected at $detected. Install here?" y; then
        VAULT="$detected"
      fi
    fi
    if [ -z "$VAULT" ]; then
      if [ "$INTERACTIVE" -eq 0 ] || [ "$ASSUME_YES" -eq 1 ]; then
        die "No vault found from $(pwd -P). Pass --vault PATH (or --no-plugin to install only the skill)."
      fi
      while [ -z "$VAULT" ]; do
        ask answer "  Which vault do you want to install into? Paste its folder path (blank to skip):" ""
        if [ -z "$answer" ]; then
          warn "Skipping the plugin."
          INSTALL_PLUGIN=0
          break
        fi
        if VAULT="$(vault_root "$answer")"; then :; else
          VAULT=""
          warn "No .obsidian folder in '$(clean_path "$answer")'. Try the vault's top folder."
        fi
      done
    fi
  fi
fi

if [ "$INSTALL_PLUGIN" -eq 1 ]; then
  PLUGIN_DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"
  previous=""
  [ -f "$PLUGIN_DEST/manifest.json" ] && previous="$(manifest_version "$PLUGIN_DEST/manifest.json")"
  mkdir -p "$PLUGIN_DEST"
  for f in $RELEASE_FILES; do cp "$TMP/$f" "$PLUGIN_DEST/$f"; done

  if [ -n "$previous" ] && [ "$previous" != "$RELEASE_VERSION" ]; then
    ok "Updated Critique $previous → $RELEASE_VERSION in $PLUGIN_DEST"
  elif [ -n "$previous" ]; then
    ok "Reinstalled Critique $RELEASE_VERSION in $PLUGIN_DEST"
  else
    ok "Installed Critique $RELEASE_VERSION in $PLUGIN_DEST"
  fi
  [ -f "$PLUGIN_DEST/data.json" ] && say "  ${DIM}Your settings (data.json) were kept.${RESET}"

  if grep -q "\"$PLUGIN_ID\"" "$VAULT/.obsidian/community-plugins.json" 2>/dev/null; then
    say "  Critique is already enabled in this vault. Reload Obsidian, or turn the plugin off and on"
    say "  in Settings → Community plugins, to load the new version."
  else
    say "  To finish, in Obsidian open ${BOLD}Settings → Community plugins${RESET}, turn off Restricted mode"
    say "  if it is on, and enable ${BOLD}Critique${RESET}. Then set your Author name in Settings → Critique."
  fi
  say ""
fi

# ── Agent skill ──────────────────────────────────────────────────────────────────────────────

agent_name() {
  case "$1" in
    claude)  printf 'Claude Code' ;;
    copilot) printf 'GitHub Copilot' ;;
    codex)   printf 'OpenAI Codex (ChatGPT)' ;;
    gemini)  printf 'Gemini CLI' ;;
    cursor)  printf 'Cursor' ;;
  esac
}

# Skills folder for an agent, relative to a project ("local") or the home folder ("global").
agent_dir() {
  case "$1:$2" in
    claude:local)   printf '.claude/skills' ;;   claude:global)  printf '%s/.claude/skills' "$HOME" ;;
    copilot:local)  printf '.github/skills' ;;   copilot:global) printf '%s/.copilot/skills' "$HOME" ;;
    codex:local)    printf '.agents/skills' ;;   codex:global)   printf '%s/.agents/skills' "$HOME" ;;
    gemini:local)   printf '.gemini/skills' ;;   gemini:global)  printf '%s/.gemini/skills' "$HOME" ;;
    cursor:local)   printf '.cursor/skills' ;;   cursor:global)  printf '%s/.cursor/skills' "$HOME" ;;
  esac
}

if [ -z "$INSTALL_SKILL" ]; then
  if [ "$INTERACTIVE" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
    say "The Critique agent skill teaches an AI coding agent how to leave and answer review marks."
    if ask_yn "Install the Critique agent skill?" n; then INSTALL_SKILL=1; else INSTALL_SKILL=0; fi
  else
    INSTALL_SKILL=0
  fi
fi

if [ "$INSTALL_SKILL" -eq 1 ]; then
  say ""
  say "${BOLD}Installing the Critique agent skill${RESET}"

  # The skill folder is named after the skill, as the Agent Skills format expects.
  SKILL_NAME="$(sed -n 's/^name:[[:space:]]*//p' "$TMP/SKILL.md" | head -n 1 | tr -d '"' | tr -d "'")"
  [ -n "$SKILL_NAME" ] || SKILL_NAME="critique"

  if [ -z "$SKILL_SCOPE" ]; then
    ask answer "  Install into a local project folder or globally for every project? [local/global]" "local"
    case "$answer" in
      [Gg]*) SKILL_SCOPE="global" ;;
      *)     SKILL_SCOPE="local" ;;
    esac
  fi

  if [ "$SKILL_SCOPE" = "local" ]; then
    if [ -z "$PROJECT_DIR" ]; then
      default_project="${VAULT:-$(pwd -P)}"
      ask answer "  Project folder:" "$default_project"
      PROJECT_DIR="$(clean_path "$answer")"
    else
      PROJECT_DIR="$(clean_path "$PROJECT_DIR")"
    fi
    [ -d "$PROJECT_DIR" ] || die "Project folder '$PROJECT_DIR' does not exist."
    PROJECT_DIR="$(abs_path "$PROJECT_DIR")"
  fi

  if [ -z "$AGENTS" ]; then
    say "  Which agents should get the skill?"
    i=0
    for key in $AGENT_KEYS; do
      i=$((i + 1))
      printf '    %d) %-24s %s\n' "$i" "$(agent_name "$key")" "${DIM}$(agent_dir "$key" "$SKILL_SCOPE")/$SKILL_NAME${RESET}"
    done
    ask answer "  Numbers separated by commas, or all:" "all"
    AGENTS="$answer"
  fi

  # Normalise the selection to a list of keys: accepts numbers, keys, or "all".
  SELECTED=""
  for token in $(printf '%s' "$AGENTS" | tr ',;' '  '); do
    case "$token" in
      all|ALL|a|A) SELECTED="$AGENT_KEYS"; break ;;
      [1-9])
        i=0
        for key in $AGENT_KEYS; do i=$((i + 1)); [ "$i" -eq "$token" ] && SELECTED="$SELECTED $key"; done ;;
      claude|copilot|codex|gemini|cursor) SELECTED="$SELECTED $token" ;;
      chatgpt|openai) SELECTED="$SELECTED codex" ;;
      *) warn "Unknown agent '$token' (choose from: $AGENT_KEYS, all)" ;;
    esac
  done
  [ -n "${SELECTED// /}" ] || die "No agents selected."

  installed_any=0
  for key in $AGENT_KEYS; do
    case " $SELECTED " in *" $key "*) ;; *) continue ;; esac
    base="$(agent_dir "$key" "$SKILL_SCOPE")"
    if [ "$SKILL_SCOPE" = "local" ]; then dest="$PROJECT_DIR/$base/$SKILL_NAME"; else dest="$base/$SKILL_NAME"; fi
    mkdir -p "$dest"
    cp "$TMP/SKILL.md" "$dest/SKILL.md"
    ok "$(agent_name "$key"): $dest/SKILL.md"
    installed_any=1
  done
  [ "$installed_any" -eq 1 ] && say "  ${DIM}Agents pick up new skills when they start, so restart any that are running.${RESET}"
  say ""
fi

# ── Summary ──────────────────────────────────────────────────────────────────────────────────

if [ "$INSTALL_PLUGIN" -eq 0 ] && [ "$INSTALL_SKILL" -eq 0 ]; then
  warn "Nothing installed."
else
  say "${GREEN}${BOLD}Done.${RESET} Docs and issues: https://github.com/$REPO"
fi
