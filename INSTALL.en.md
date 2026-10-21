# Installing Shalav

Shalav is an extension for **Claude Desktop** (macOS or Windows). It uses your own Claude subscription: there is no API key and no extra cost.

1. Install [Claude Desktop](https://claude.ai/download) and sign in.
2. Download `shalav.mcpb` from the latest release page.
3. Double-click it (or drag it into Claude Desktop → Settings → Extensions). Press **Install**.
4. Choose the **data folder** (default `Documents/Shalav`) and the language, then enable the extension.
   - To use two computers, put the data folder inside Google Drive / OneDrive / iCloud Drive for desktop and choose the same folder on both.
5. In any chat type **Shalav**, or pick **Shalav → My courses** from the prompt menu (the **+** button). The Home card opens in the chat.

## Updates
Download the new `shalav.mcpb` and install it over the old one. Your data folder is not touched.

## Claude Code (optional)
```bash
git clone <repo> && cd <repo> && pnpm install && pnpm build:cards && pnpm build:server
claude mcp add shalav -- node "$PWD/dist/server.mjs"
```
Set `SHALAV_DATA_FOLDER` to choose the data folder.

## Troubleshooting
- **The card does not appear:** update Claude Desktop, and make sure the extension is enabled (Settings → Extensions).
- **Claude does not continue after a card button:** write "continue" in the chat.
- **Sync conflicts:** a file like `name (1).jsonl` or "(conflicted copy)" is ignored by Shalav and listed in the Shalav settings card; delete it after checking nothing is missing.
