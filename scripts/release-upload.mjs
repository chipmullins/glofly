// npm run release:upload — builds and uploads the version that's already committed, without
// bumping or committing anything. For when npm run release committed the version but the
// build or upload didn't finish (or to re-upload).

import { build, checkAws, desktopVersion, fail, out, step, upload } from './release-lib.mjs'

if (out('git status --porcelain')) {
  fail("You have changes that aren't committed. Commit (or undo) them first.")
}
checkAws()
const version = desktopVersion()
step(`Building and uploading Glofly ${version} (no version change)`)
if (!build()) fail('The build failed 3 times. See the error above.')
await upload(version)
