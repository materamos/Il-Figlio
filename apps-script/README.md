# Il Figlio Sheets publisher

This directory contains the bound Google Apps Script used by the private
`Il Figlio — Carta` spreadsheet. The spreadsheet is the draft editor; the web
app serves only the last validated JSON snapshot.

## One-time setup

1. Sign in to `ilfigliodev@gmail.com` and create an empty Google Sheet named
   `Il Figlio — Carta`.
2. Enable the Apps Script API for that account.
3. From this directory, authenticate clasp with the named local profile:

   ```powershell
   npx clasp login --user ilfiglio
   ```

4. Bind a new Apps Script project to the spreadsheet:

   ```powershell
   npx clasp create-script --title "Il Figlio Menu Publisher" --parentId "<SPREADSHEET_ID>" --rootDir "src" --user ilfiglio
   ```

5. Keep the generated `.clasp.json`; its script ID is an identifier, not a
   credential. Never commit `.clasprc.json` or authentication tokens.
6. Push the source with `npx clasp push --user ilfiglio` and open it with
   `npx clasp open-script --user ilfiglio`.
7. Run `setupProject` once from the Apps Script editor and accept its requested
   permissions. It creates the three tabs, seeds the current 24 products and
   installs the edit and five-minute verification triggers.
8. Reload the Sheet, then use `Il Figlio > Configurar Vercel`. Paste the
   production Deploy Hook and public site URL. The hook is stored only in
   Script Properties.
9. Create a web-app deployment from the pushed manifest. It must execute as the
   deploying user and allow anonymous access. Record its `/exec` URL as
   `MENU_SNAPSHOT_URL` in Vercel.

## Publishing contract

- `Carta` holds draft products and prices.
- `Estado` holds the global `Abierto`, `Cerrado` or `Agotado` state and an
  optional 160-character message.
- Setting `Publicacion!B2` to true publishes from desktop or mobile.
- A second publication cannot replace the fixed snapshot URL while another
  revision is pending. Rechecking `B2` retries that same revision; newer sheet
  edits remain a draft until `/publication.json` confirms the pending revision
  and SHA-256 hash.
- The web app implements only `GET`. The Drive file remains private and the
  endpoint exposes only menu data that is destined for the public site.

The wire schema is versioned as `schema_version: 1`. Its `source_hash` is the
SHA-256 of the UTF-8 `JSON.stringify` output for the canonical object containing
`schema_version`, `revision`, `currency`, `business` and `categories`, in that
order. `published_at` and `source_hash` are not included in the hash input.

## Updating the script

Push source changes, then update the existing deployment instead of creating a
new public URL:

```powershell
npx clasp push --user ilfiglio
npx clasp list-deployments --user ilfiglio
npx clasp update-deployment "<DEPLOYMENT_ID>" --description "Update Sheets publisher" --user ilfiglio
```

Do not run `create-deployment` again after activation: it creates another URL.
After every update, verify the existing `/exec` URL without an authenticated
browser session.
