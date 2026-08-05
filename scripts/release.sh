#!/usr/bin/env bash
set -euo pipefail

# The whole release ritual: code, then `npm run release -- <bump>`. If [Unreleased] is empty but commits landed
# since the last tag, the changelog skill is run headlessly to fill it, and the notes print as the release
# proceeds. Pre-release versions (any semver with a hyphen) are marked as pre-releases on GitHub.

REPO_URL="https://github.com/fileshed/fileshed"

if [ $# -eq 0 ]; then
    echo "Usage: npm run release -- <major|minor|patch|premajor|preminor|prepatch|prerelease> [--preid=alpha|beta|rc]"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Error: working tree is dirty. Commit or stash changes first."
    exit 1
fi

if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
    echo "Error: no [Unreleased] section in CHANGELOG.md."
    exit 1
fi

PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

unreleased_body() {
    awk '/^## \[Unreleased\]/{flag=1; next} /^## \[/{flag=0} /^\[/{flag=0} flag' CHANGELOG.md | grep -v '^[[:space:]]*$' || true
}

if [ -n "$PREV_TAG" ]; then
    COMMITS_SINCE=$(git rev-list "${PREV_TAG}..HEAD" --count)
else
    COMMITS_SINCE=$(git rev-list HEAD --count)
fi

GRADUATION=0
case "$1" in
    major|minor|patch)
        if [[ "$PREV_TAG" == *-* ]]; then GRADUATION=1; fi
        ;;
esac

# Commits newer than the changelog's own last commit are, by definition, not yet reflected in it. Every release
# commit touches CHANGELOG.md, so this baseline can never lag behind the last release.
LAST_CHANGELOG_COMMIT=$(git log -1 --format=%H -- CHANGELOG.md 2>/dev/null || echo "")
if [ -n "$LAST_CHANGELOG_COMMIT" ]; then
    UNLOGGED=$(git rev-list "${LAST_CHANGELOG_COMMIT}..HEAD" --count)
else
    UNLOGGED=$COMMITS_SINCE
fi

if [ -z "$(unreleased_body)" ] || [ "$UNLOGGED" -gt 0 ]; then
    if [ "$COMMITS_SINCE" -eq 0 ] && [ "$GRADUATION" -eq 1 ]; then
        echo "Graduating ${PREV_TAG} to stable with no new commits; skipping changelog."
    elif [ "$COMMITS_SINCE" -eq 0 ] && [ -z "$(unreleased_body)" ]; then
        echo "Error: no commits since ${PREV_TAG} and nothing in [Unreleased] - nothing to release."
        exit 1
    else
        if ! command -v claude >/dev/null; then
            echo "Error: the changelog needs updating and the claude CLI is not available. Run /changelog manually."
            exit 1
        fi
        echo "Reconciling [Unreleased] (${UNLOGGED} commits newer than the changelog's last update)..."
        claude -p --permission-mode acceptEdits "/changelog"
        if [ -z "$(unreleased_body)" ]; then
            echo "Error: changelog run produced no [Unreleased] entries. Inspect CHANGELOG.md."
            exit 1
        fi
    fi
fi

if [ -n "$(unreleased_body)" ]; then
    echo ""
    echo "================ [Unreleased] ================"
    unreleased_body
    echo "=============================================="
    echo ""
fi

# A release tag should point at the most-verified commit this repo can produce.
echo "Running checks..."
npm run lint
npm run lint:types
npm run test
npm run test:e2e
npm run build

npm version "$@" --no-git-tag-version --workspaces-update=false
VERSION=$(node -p "require('./package.json').version")

# npm version -w reconciles the whole workspace tree on every call, which explodes on the first 0.x bump: the
# sibling caret ranges stop matching mid-loop and npm goes to the registry for a package that only exists here.
# Versions and cross-references are plain file edits instead, reconciled by one lock-only install at the end.
node -e '
    const fs = require("fs");
    const version = process.argv[1];
    const manifests = {
        "packages/core/package.json": false,
        "src/client/package.json": true,
        "src/server/package.json": true,
    };
    for (const [path, dependsOnCore] of Object.entries(manifests))
    {
        const raw = fs.readFileSync(path, "utf8");
        const indent = raw.match(/\n(\s+)"/)[1];
        const pkg = JSON.parse(raw);
        pkg.version = version;
        if (dependsOnCore) { pkg.dependencies["@fileshed/core"] = "^" + version; }
        fs.writeFileSync(path, JSON.stringify(pkg, null, indent) + "\n");
    }
' "$VERSION"
npm install --package-lock-only --ignore-scripts >/dev/null

TODAY=$(date +%Y-%m-%d)

sed -i '' "s/^## \[Unreleased\]/## [Unreleased]\n\n## [$VERSION] - $TODAY/" CHANGELOG.md

if [ -n "$PREV_TAG" ]; then
    NEW_VERSION_LINK="[$VERSION]: ${REPO_URL}/compare/${PREV_TAG}...v${VERSION}"
else
    NEW_VERSION_LINK="[$VERSION]: ${REPO_URL}/releases/tag/v${VERSION}"
fi

sed -i '' "s|^\[Unreleased\]:.*|[Unreleased]: ${REPO_URL}/compare/v${VERSION}...main\n${NEW_VERSION_LINK}|" CHANGELOG.md

git add package.json package-lock.json packages/core/package.json src/client/package.json src/server/package.json CHANGELOG.md
git commit -m "v${VERSION}"
git tag "v${VERSION}"
git push origin main --tags

NOTES=$(awk "/^## \[$VERSION\]/{flag=1; next} /^## \[/{flag=0} /^\[/{flag=0} flag" CHANGELOG.md)
if [ -z "$(echo "$NOTES" | grep -v '^[[:space:]]*$' || true)" ]; then
    NOTES="Stable release graduating the v${VERSION} pre-release series."
fi

PRERELEASE_FLAG=""
if [[ "$VERSION" == *-* ]]; then PRERELEASE_FLAG="--prerelease"; fi

gh release create "v${VERSION}" --title "v${VERSION}" --notes "${NOTES}" ${PRERELEASE_FLAG}

echo "Released v${VERSION}: ${REPO_URL}/releases/tag/v${VERSION}"
