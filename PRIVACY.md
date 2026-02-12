# Privacy Policy — Ass X

Last updated: 2025-02-07

## Overview

Ass X is a Chrome extension that applies visual effects (JPEG compression artifacts and text redaction) to media displayed on X/Twitter. It operates entirely within your browser.

## Data Collection

**Ass X does not collect, transmit, or store any personal data.**

- No analytics or tracking of any kind
- No data is sent to external servers
- No cookies are set by this extension
- No user accounts or sign-ups

## Data Handling

- **Images and videos** from X/Twitter are processed entirely in your browser using the Canvas API. No media data leaves your device.
- **Settings** (quality, passes, FPS, redaction ratio, enabled state) are stored locally in your browser via `chrome.storage.local`. These settings never leave your device.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your settings locally |
| `host_permissions` (`pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`) | Fetch X/Twitter media within the content script to apply compression effects |

## Third-Party Services

Ass X does not communicate with any third-party services.

## Changes

If this policy is updated, changes will be noted in the repository commit history.

## Contact

For questions or concerns, please open an issue on the [GitHub repository](https://github.com/).
