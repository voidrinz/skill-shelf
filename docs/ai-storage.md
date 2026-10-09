# AI Data Storage

Starting in v0.1.3, Skill Shelf stores API keys and AI conversations as
unencrypted JSON in the application's local data directory. This avoids
macOS Keychain authorization during startup, credential configuration, and
ordinary AI use. It does not require an Apple distribution certificate.

Files use owner-only read/write permissions (`0600`). These permissions are
not encryption: other software running as the same macOS user can read the
files. Keys are never included in renderer status responses. AI requests
send the key to the configured provider as needed for authentication.

## Files

- `ai-provider.json`: version 4, with the provider configuration and API key.
- `ai-conversations.json`: version 1, with a `conversations` array.
- `*.encrypted-backup`: original ciphertext retained after a successful
  migration. These files are never used for ordinary reads or writes.

Writes use a unique temporary file with `0600` permissions and an atomic
rename. Conversation mutations are serialized and become visible in memory
only after persistence succeeds.

Metadata sync exports only AI preferences: translation language, model lists,
default role models and context mode. It excludes API keys, provider connection
enabled states, model verification results and conversations. Import retains the
local credentials and saves an owner-only `ai-provider.json.sync-backup` before
changing preferences.

## Upgrading From Earlier Versions

Older provider envelopes (versions 1, 2, and 3) and encrypted conversation
envelopes are detected without calling Electron `safeStorage`. The app opens
normally. In Settings > AI > Providers, choose **Restore previous AI data**.
This explicit operation decrypts the old files through macOS Keychain and
may require system authorization. The interface explains that restored data
will be stored locally without encryption.

Each file is validated and its original ciphertext is backed up before it
is replaced. Existing backups must match the original file. If permission
is denied, decryption fails, a file changed since startup, or a write fails,
the source is retained and restoration can be retried. If one file restores
successfully before another fails, retry restores only the remaining file.

Unreadable files and pending legacy files block writes to those files. They
are never treated as an empty configuration that can be overwritten.
Other Skill Shelf features remain available while restoration is pending.
