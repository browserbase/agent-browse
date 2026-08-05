# Context Sync Implementation Notes

## Archive contract

Browserbase Context create/update returns:

- `id`
- a signed `uploadUrl`
- an RSA `publicKey`
- `cipherAlgorithm` (currently AES-256-CBC)
- `initializationVectorSize`

The script creates a ZIP whose root is the Chrome user-data directory. The chosen local profile is renamed to `Default/` in the archive so Browserbase launches it deterministically.

The encrypted upload is laid out as:

1. RSA-encrypted random 32-byte AES key
2. random initialization vector
3. AES-CBC-encrypted ZIP bytes

It is uploaded with HTTP PUT and `Content-Type: application/zip`.

## Why cookies take a second path

Chromium stores cookie values using an operating-system credential service. Copying a macOS or Windows `Cookies` SQLite database into Browserbase's Linux browser preserves rows but not decryptable values. The script therefore:

1. reads cookies from the running local browser over CDP;
2. excludes cookie databases from the ZIP;
3. uploads the remaining durable profile;
4. starts a Browserbase session with `persist: true`;
5. injects the cookie values through CDP;
6. closes the session so Browserbase persists them with its own encryption environment.

## Consistency

Chrome uses SQLite and LevelDB for profile state. Copying files while Chrome is writing can produce a mixed snapshot. `--close-browser` exports cookies first, requests `Browser.close`, waits for the debugging endpoint to disappear, and only then archives the profile.

`--allow-live-copy` is an explicit escape hatch. Treat resulting storage as best-effort.

## Profile discovery

The script infers the user-data directory from `DevToolsActivePort` when possible. With an explicit `CDP_URL`, it cannot reliably infer a filesystem path, so require `--user-data-dir`.

The `--profile` value is a directory name such as `Default`, `Profile 1`, or `Profile 2`, not the display name shown in Chrome's profile picker.
