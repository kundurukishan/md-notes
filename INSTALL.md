# Installing MD Notes on a Mac

MD Notes runs on **macOS 12 Monterey or later**, on both Apple Silicon (M1 and later) and Intel Macs. The same installer works on both.

## 1. Get the installer

Download **`MD-Notes-<version>-mac.dmg`** in one of these ways:

- **From a release (easiest):** on the repository's GitHub page, open **Releases** and download the `.dmg` under **Assets**.
- **From the latest build:** go to the **Actions** tab and open **Build Mac installer**. Pick the most recent successful run (green check), scroll down to **Artifacts**, and download **MD-Notes-mac-installer**. It downloads as a `.zip`. Double-click it to get the `.dmg`.
- **Build it yourself:** see [Building the installer yourself](#building-the-installer-yourself) below.

## 2. Install

1. Double-click the `.dmg` to open it.
2. Drag the **MD Notes** icon onto the **Applications** folder in the same window.
3. Eject the disk image. In Finder's sidebar, click ⏏ next to **MD Notes**.

## 3. Open it for the first time

MD Notes isn't signed with an Apple Developer ID yet, so macOS asks you to confirm the first time you open it. You only have to do this once.

**macOS 15 Sequoia and later**

1. Open **Applications** and double-click **MD Notes**. macOS says it can't verify the app. Click **Done**. Don't click **Move to Trash**.
2. Open **System Settings → Privacy & Security** and scroll down to **Security**.
3. Next to *"MD Notes" was blocked to protect your Mac*, click **Open Anyway**. Enter your password if asked.
4. Click **Open Anyway** once more in the dialog that appears.

**macOS 14 Sonoma and earlier**

1. Open **Applications** and **Control-click** (or right-click) **MD Notes**, then choose **Open**.
2. Click **Open** in the dialog.

**If macOS says the app "is damaged and can't be opened"**, the download's quarantine flag is the cause, not the app. Open **Terminal** and run:

```bash
xattr -dr com.apple.quarantine "/Applications/MD Notes.app"
```

Then open MD Notes normally.

From then on, MD Notes opens like any other app. You can keep it in the Dock: right-click its Dock icon and choose **Options → Keep in Dock**.

## Where your data lives

- **Notes:** `.md` files in `~/Documents/MD Notes`, unless you picked another folder in **Settings → Notes folder**.
- **Task lists:** `.md` files in the `Tasks` folder inside your notes folder.
- **Tag colors:** `.mdnotes/tags.json` inside your notes folder.
- **App settings** (font, theme, folder location): `~/Library/Application Support/MD Notes/settings.json`.

To back up to Google Drive, choose a notes folder inside Google Drive. See [Backing up to Google Drive](README.md#backing-up-to-google-drive).

## Updating

Download the new `.dmg`, drag **MD Notes** to **Applications** again, and choose **Replace**. Your notes and settings aren't touched. You may need to confirm the first launch again, as in step 3.

## Uninstalling

Drag **MD Notes** from **Applications** to the Trash. To also remove its settings, delete `~/Library/Application Support/MD Notes`. Your notes folder is never deleted. Remove it yourself if you want to.

## Building the installer yourself

You need Node.js 20 or later. Get it from [nodejs.org](https://nodejs.org), or with Homebrew: `brew install node`.

```bash
git clone https://github.com/kundurukishan/md-notes.git
cd md-notes
npm ci
npm run dist
```

The installer is written to `release/MD-Notes-<version>-mac.dmg`. The app itself is at `release/mac-universal/MD Notes.app`.

## Publishing a release (for maintainers)

1. Update `"version"` in `package.json` and commit.
2. Tag the commit and push the tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

The **Build Mac installer** workflow builds the `.dmg`, checks that the packaged app launches, and publishes a GitHub Release with the `.dmg` attached. You can also run the workflow by hand from the **Actions** tab (**Run workflow**). That builds an installer without publishing a release.

To remove the "can't verify" prompt from step 3, the app has to be signed with an Apple Developer ID certificate and notarized by Apple. This requires the Apple Developer Program ($99/year).
