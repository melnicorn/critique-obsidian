#!/usr/bin/env bash
# Compose release notes: a fixed header plus a Gemini summary of the commits since the previous tag.
#
# Inputs (environment):
#   VERSION        release version / tag, e.g. 0.1.3           (required)
#   PREVIOUS_TAG   previous release tag, empty for the first    (optional)
#   HEAD_REF       git ref to summarize up to; default: VERSION if that tag exists, else HEAD
#   MIN_APP        minimum Obsidian version for the header      (required)
#   REPO_NAME      repository name for the header               (required)
#   GEMINI_API_KEY API key; without it no summary is generated
#   MODEL_ID       Gemini model; default gemini-3.1-flash-lite
#   STRICT         1 = exit 1 when Gemini was asked and failed (default 0: continue without a summary)
#   OUT            output file; default final_notes.md
#
# Writes OUT. Prints `ai=true|false` to $GITHUB_OUTPUT when that variable is set, so a caller can fall
# back to GitHub's generated notes when no summary was produced.
set -euo pipefail

: "${VERSION:?VERSION is required}"
: "${MIN_APP:?MIN_APP is required}"
: "${REPO_NAME:?REPO_NAME is required}"
MODEL_ID="${MODEL_ID:-gemini-3.1-flash-lite}"
OUT="${OUT:-final_notes.md}"
STRICT="${STRICT:-0}"
PREVIOUS_TAG="${PREVIOUS_TAG:-}"
if [ -z "${HEAD_REF:-}" ]; then
  if git rev-parse -q --verify "refs/tags/${VERSION}" >/dev/null; then HEAD_REF="refs/tags/${VERSION}"; else HEAD_REF="HEAD"; fi
fi

ai=false
output() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "ai=${ai}" >> "$GITHUB_OUTPUT" || true; }

{
  echo "## ${REPO_NAME} — v${VERSION}"
  echo
  echo "**Minimum Obsidian version:** ${MIN_APP}"
  echo
  echo "Install by unpacking \`critique-${VERSION}.tar.gz\` into \`<vault>/.obsidian/plugins/\`, or by copying \`main.js\`, \`manifest.json\` and \`styles.css\` into \`<vault>/.obsidian/plugins/critique/\`. \`SKILL.md\` is the guide for AI agents."
  echo
  echo "---"
  echo
} > "$OUT"

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY is not set, skipping AI generation."
  output
  exit 0
fi

if [ -z "$PREVIOUS_TAG" ]; then
  echo "No previous tag: summarizing every commit up to ${HEAD_REF}."
  COMMITS=$(git log "$HEAD_REF" --no-merges --pretty=format:'%s%n%b')
else
  echo "Summarizing commits ${PREVIOUS_TAG}..${HEAD_REF}."
  COMMITS=$(git log "${PREVIOUS_TAG}..${HEAD_REF}" --no-merges --pretty=format:'%s%n%b')
fi

if [ -z "$COMMITS" ]; then
  echo "No commits found to summarize."
  output
  exit 0
fi

echo "Using Gemini model: ${MODEL_ID}"

PROMPT="You are a release assistant that summarizes Git commit histories into clear, human-readable release notes for an Obsidian plugin.

Guidelines:
- Write the first line as a succinct one-sentence title (for example, ‘Adds a review panel and fixes Reading mode selection’), then include a blank line followed by formatted release notes.
- Group related changes together under headers (✨ Features, 🐛 Fixes, 🧹 Maintenance).
- Ignore trivial commits like version bumps or formatting.
- Be concise and professional (5–10 short bullet points max).
- Do not include commit hashes, author names, or dates.
- Do not include any other detail than the summary (e.g., no 'here's the summary'). The only output should be the markdown that will be used as the release body.

Now summarize the following commit history:
---
${COMMITS}
---"

RESPONSE=$(jq -n --arg text "$PROMPT" '{
  contents: [{role: "user", parts: [{text: $text}]}],
  generationConfig: {temperature: 0.7}
}' | curl -sS -X POST \
  -H "Content-Type: application/json" \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${GEMINI_API_KEY}" \
  -d @-)

fail() {
  echo "::${2:-warning}::Gemini release notes failed: $1"
  echo "$RESPONSE"
  output
  if [ "$STRICT" = "1" ]; then exit 1; fi
  exit 0
}

if ! echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  fail "invalid JSON response" "$([ "$STRICT" = "1" ] && echo error || echo warning)"
fi

ERR=$(echo "$RESPONSE" | jq -r '.error.message // empty')
if [ -n "$ERR" ]; then
  fail "$(echo "$RESPONSE" | jq -r '"\(.error.code // "?") \(.error.status // "") — \(.error.message)"')" "$([ "$STRICT" = "1" ] && echo error || echo warning)"
fi

SUMMARY=$(echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text // empty')
if [ -z "$SUMMARY" ]; then
  fail "no summary text in the response" "$([ "$STRICT" = "1" ] && echo error || echo warning)"
fi

printf '%s\n' "$SUMMARY" >> "$OUT"
ai=true
echo "Generated AI release notes successfully."
output
