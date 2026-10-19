# BM Networking example

An Expo app (iOS and Android) for trying `bm-react-native-networking` against public APIs. No keys or accounts are needed.

| Group | What it shows | API |
|---|---|---|
| REST | list, filter, get, create, delete (`ModelTargetType`, `SuccessTargetType`, array responses) | DummyJSON |
| Errors | HTTP 404 / 500 mapped through `APIErrorResponseRegistry` | DummyJSON, httpbin |
| Auth | empty token → 401 → `TokenRefreshRegistry` → replay → 200 | httpbin `/bearer` |
| Resilience | per-endpoint timeout, `CancelToken` | httpbin `/delay` |
| Security | hybrid AES + RSA payload encryption (switch on the screen), per-endpoint opt-out | httpbin `/post` |
| Files & cookies | `Set-Cookie` parsing, multipart upload, download to disk | httpbin |
| WebSocket | connect, send, state, close-all | `wss://ws.postman-echo.com/raw` |

Every call is also captured by the in-app inspector: shake the device (or tap **Open Inspector**) to see headers, bodies and timings. With encryption on, the request body in the inspector is the encrypted envelope.

## Run

```sh
cd example
npm install
npx expo start          # press i for iOS simulator, a for Android emulator, or scan with Expo Go
# or a native build:
npx expo run:ios
npx expo run:android
```

The app imports the package straight from the repository root (`metro.config.js` aliases `bm-react-native-networking` to `..`), so changes in `../src` hot reload.

## Notes

- SSL pinning needs `react-native-ssl-public-key-pinning`, which is not part of Expo Go; it is left out of this demo.
- The encryption key in `src/api.ts` is a throwaway demo public key; httpbin just echoes the encrypted envelope.
- httpbin and the Postman echo server are free community services and are occasionally slow or unavailable. A failing scenario in that case is not a package bug.
