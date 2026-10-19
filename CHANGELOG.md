# Changelog

## 0.1.0

Initial React Native port of BMFlutterNetworking 2.2.3.

- Type-safe endpoints: `ModelTargetType<T>` / `SuccessTargetType`, results as `Result<T, APIError>` or exceptions.
- Automatic, shared token refresh on 401 with a single replay.
- Hybrid AES-CBC + RSA payload encryption (per environment and per endpoint).
- Send / receive timeouts with per-endpoint overrides, `CancelToken`, offline fail-fast and connection-loss detection.
- Multi-stream WebSocket client with backoff reconnect, token refresh on reconnect and `BMWebSocketRegistry`.
- Cookies, multipart / file uploads, downloads (resumable via `Range`).
- Optional SSL pinning through `react-native-ssl-public-key-pinning`.
- Console logger and an in-app network inspector (`NetworkInspectorOverlay`, shake to open).

### Fixes relative to the Flutter implementation

- A `Set-Cookie` header whose `Expires` attribute is the last attribute is now split correctly from the next cookie.
- WebSocket: closing the client while the access token is being fetched no longer opens a socket afterwards.
- Download requests fail on non-2xx before writing a file.

### Testing

- 188 Jest tests with a 100% statement / branch / function / line threshold enforced by `jest.config.js`.
- Example Expo app in `example/`.
