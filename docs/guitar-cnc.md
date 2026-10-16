# Grit Guitar CNC

The guided operator interface is available at `/#/guitar`. It is the default route after sign-in; the original cncjs workspace remains available at `/#/workspace` for maintenance and diagnostics.

## Configure the job library

The bundled `guitar-library/` directory is a safe, non-executable example. On the Raspberry Pi, point cncjs at the shop library in `~/.cncrc`:

```json
{
  "allowRemoteAccess": true,
  "guitarLibrary": {
    "directory": "/home/pi/guitar-jobs",
    "manifest": "guitar-library.json"
  }
}
```

Create a cncjs user before enabling remote access. The guitar endpoints use the same access token as the existing cncjs APIs.

Every operation is locked unless its manifest contains `"executable": true`. The server resolves and validates the path, rejects files outside the library, limits files to 50 MB, and calculates a SHA-256 checksum whenever the catalog or selected operation is requested.

## Install on a phone

An installable PWA must be delivered over HTTPS. Give the Pi a stable local hostname and put a TLS reverse proxy in front of cncjs. For example, a locally trusted Caddy installation can proxy the app without exposing cncjs to the public internet:

```caddyfile
grit-cnc.local {
    tls internal
    reverse_proxy 127.0.0.1:8000
}
```

Install Caddy's local root certificate on each shop phone, visit `https://grit-cnc.local`, sign in, and choose **Add to Home Screen**. Keep the Pi and phones on a trusted, isolated shop network.

The service worker caches only UI resources. Requests under `/api/` and `/socket.io/` are never cached; machine controls lock when the live connection is lost.

## Commissioning

1. Keep every new operation non-executable while checking its selection path, setup text, tool, checksum, and parsed preview.
2. Test against the included GRBL simulator.
3. Test the intended controller with the spindle disabled.
4. Perform an air cut, then a cut in sacrificial stock.
5. Enable the operation only after the exact file and setup are approved.

The application is not a safety-rated controller. A physical emergency stop, working limit switches, correct clamping, and operator supervision remain required.
