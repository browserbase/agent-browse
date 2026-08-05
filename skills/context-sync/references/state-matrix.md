# Context Sync State Matrix

## Expected to survive in a Browserbase Context

| State | Source in the Chrome profile | Notes |
|---|---|---|
| Cookies | Exported and injected through CDP | Avoids macOS/Windows OS-key encryption incompatibility. Session cookies may also be copied, but the site can still reject them. |
| localStorage | `Default/Local Storage` | Origin-scoped and durable. |
| IndexedDB | `Default/IndexedDB` | Origin-scoped and durable; compatibility still depends on Chrome version and the application. |
| Cache Storage | `Default/Service Worker/CacheStorage` | Included. This is distinct from disposable HTTP/browser caches, which are excluded. |
| Service workers | `Default/Service Worker` | Registrations and stored scripts are included. A worker may update or be invalidated after launch. |
| OPFS / File System | `Default/File System` | Included when present. |
| Bookmarks | `Default/Bookmarks` | Included. |
| Browsing history | `Default/History` | Included when Chrome has actually populated the History database. A normal automation navigation is not guaranteed to create a history row. |
| Preferences | `Default/Preferences` and related profile files | Included, but Chrome or Browserbase flags may override individual settings. |
| Extension state | `Default/Extensions`, `Extension State`, `Local Extension Settings`, and related paths | Included. Extensions can still be disabled by version, policy, platform, or launch configuration. |

## Deliberately excluded

| State | Reason |
|---|---|
| Raw cookie databases | Cookie values are OS-key encrypted on macOS/Windows; cookies are transferred through CDP instead. |
| Saved passwords / login databases | OS-key encrypted and unsafe to imply as portable. |
| HTTP cache, code cache, GPU/shader cache | Re-creatable and large; Browserbase's own Context archive path excludes these caches. |
| Singleton locks, sockets, `DevToolsActivePort` | Host-specific runtime files. |
| Open tabs and `Sessions` restore files | Contexts restore disk-backed profile state, not a live browser process. |

## Not guaranteed to resume

- `sessionStorage` in a fresh page or fresh browser session
- back-forward stacks or the exact current tab URLs
- live DOM state, JavaScript heap, WebSockets, downloads in progress, or active service-worker execution
- saved passwords, passkeys, client certificates, hardware-bound tokens, or OS-keychain state
- site authentication that is bound to IP address, device fingerprint, TLS state, or another anti-abuse signal

Use Firecracker or another VM/process snapshot mechanism for true hibernation. A Browserbase Context is a durable Chrome-profile archive.
