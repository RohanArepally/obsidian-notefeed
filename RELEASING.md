# Releasing Obsidian Note Feed

This plugin follows SemVer and only versions when shipping a release.

## Before your first submission

1. Create a public GitHub repository for this project.
2. Push this code to the default branch.
3. Confirm `manifest.json` has correct metadata:
   - `id`, `name`, `version`, `minAppVersion`
   - `author`, `authorUrl`
4. Confirm `versions.json` includes the current version mapping.
5. Ensure a license file exists (this repo uses MIT).

## Create a release

1. Build artifacts:
   - `npm run build`
2. Update versions:
   - bump `manifest.json` `version`
   - add/update the same version in `versions.json`
3. Commit changes:
   - `git add manifest.json versions.json main.js`
   - `git commit -m "release: vX.Y.Z"`
4. Tag and push:
   - `git tag X.Y.Z`
   - `git push origin main --tags`
5. Create a GitHub Release with tag `X.Y.Z`.
6. Upload these assets to the release:
   - `manifest.json`
   - `main.js`
   - `styles.css`

## Submit to Obsidian Community Plugins (first time)

1. Fork `obsidianmd/obsidian-releases`.
2. Add your plugin entry under `community-plugins.json` in that repo.
3. Set:
   - `id`: from your `manifest.json`
   - `name`: plugin name
   - `author`: plugin author
   - `description`: short plugin summary
   - `repo`: your GitHub repository URL
4. Open a PR to `obsidianmd/obsidian-releases`.
5. After approval, users can install from Community Plugins.
