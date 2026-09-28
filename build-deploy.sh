#!/usr/bin/env bash
# Builds nestify-desk.zip: the whole app with vendor/ included, ready to upload
# to shared hosting (Hostinger, cPanel…) where composer is not available.
set -euo pipefail
cd "$(dirname "$0")"

OUT=deploy/nestify-desk
rm -rf deploy nestify-desk.zip
mkdir -p "$OUT"

git ls-files -z | xargs -0 -I{} cp --parents {} "$OUT"
cd "$OUT"
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-progress
find vendor -name .git -type d -prune -exec rm -rf {} +
rm -rf tests phpunit.xml build-deploy.sh .github
cd ..
zip -qr ../nestify-desk.zip nestify-desk
cd ..
echo "Built nestify-desk.zip"
