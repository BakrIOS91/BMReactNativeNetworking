# BMReactNativeNetworking

A structured, production-ready React Native networking layer, ported from [BMFlutterNetworking](https://github.com/BakrIOS91/BMFlutterNetworking). Describe each endpoint as one small class and get type-safe requests, automatic token refresh, secure payloads and live data streams, without writing interceptors or plumbing in every app.

Pure TypeScript, no custom native code: works in bare React Native and Expo.

## Features

- **Type-safe endpoints:** one class per request (`ModelTargetType<T>` / `SuccessTargetType`); results as `Result<T, APIError>` or exceptions, your choice.
- **Automatic token refresh:** a 401 on an authorized request refreshes the token once (shared by concurrent requests) and replays the call.
- **Payload encryption:** hybrid AES-CBC + RSA body encryption, switchable per environment and per endpoint.
- **Timeouts and cancellation:** send and receive timeouts (global with per-endpoint overrides) and a `CancelToken`.
- **Safe on bad networks:** offline requests are never queued; a request that loses its connection fails fast, and state-changing calls are never retried automatically.
- **WebSocket streams:** authenticated, multi-stream sockets with backoff reconnect, token refresh on reconnect, connection state and a close-all for logout.
- **Error mapping:** decode server error payloads into your own models.
- **Cookies, uploads and downloads:** multipart and file uploads, resumable downloads.
- **SSL pinning** (optional peer), **logging** and an **in-app network inspector** (shake to open).

## Installation

```sh
npm install bm-react-native-networking
```

Optional peer dependencies, install what you use:

| Package | Used for | Without it |
|---|---|---|
| `@react-native-community/netinfo` | offline fail-fast, connection-loss detection, WebSocket reconnect on regained network | device is assumed online |
| `expo-file-system` | saving downloads | pass your own `FileSystemAdapter` |
| `expo-sensors` | shake to open the inspector | open it with `NetworkInspector.instance.open()` or pass a `shakeSource` |
| `react-native-ssl-public-key-pinning` | SSL pinning | requests with pinning fail unless `allowFallback` is set |
| `react-native-get-random-values` | secure random for payload encryption | pass `randomBytes` to the encryptor |

If you use payload encryption, import the random polyfill once, **first** in your entry file:

```ts
import 'react-native-get-random-values';
```

## Architecture

```
index.ts
  └─ registers TokenRefreshRegistry & APIErrorResponseRegistry
       │
       ▼
Target (base URL + environment config)
       │
       ▼
ModelTargetType / SuccessTargetType  (one class per endpoint)
       │
       ▼
Client  (thin wrapper that calls performResult / performAsync)
       │
       ▼
Repository / hook / store
```

## Step 1 — Define Your Targets

A `Target` holds your base URL. Create one subclass per API origin.

```ts
import { AppEnvironment, Target } from 'bm-react-native-networking';

// Once at startup, from your .env (e.g. react-native-config / babel-plugin-dotenv):
Target.configureEnvironment(process.env.APP_ENV); // 'prod' | 'staging' | 'dev' ...

export class AppApiTarget extends Target {
  get kAppScheme() { return 'https'; }
  get kAppHost() {
    switch (this.appEnvironment) {
      case AppEnvironment.production: return 'api.example.com';
      case AppEnvironment.staging: return 'staging.api.example.com';
      default: return 'dev.api.example.com';
    }
  }
  get kMainAPIPath() { return 'api'; } // https://api.example.com/api/
  get kAppApiPath() { return 'v1'; }   // https://api.example.com/api/v1/
}
```

| Property | Example | Result |
|---|---|---|
| `kAppScheme` | `https` | `https://` |
| `kAppHost` | `api.example.com` | `https://api.example.com` |
| `kAppPort` | `8443` | `https://api.example.com:8443` |
| `kMainAPIPath` | `api` | `.../api/` |
| `kAppApiPath` | `v1` | `.../api/v1/` |

`new AppApiTarget().kBaseURL` returns the final URL. The environment comes from
`Target.configureEnvironment(...)`; pass one explicitly only to override it
(`new AppApiTarget(AppEnvironment.staging)`). Unset, it defaults to `development`.

## Step 2 — Create Request Classes

```ts
import { HTTPMethod, ModelTargetType, RequestTask, SuccessTargetType } from 'bm-react-native-networking';

interface User { id: number; name: string }

export class GetUserRequest extends ModelTargetType<User> {
  constructor(private userId: number) {
    super((json) => ({ id: json.id, name: json.name })); // or override fromJson()
  }
  get baseURL() { return new AppApiTarget().kBaseURL; }
  get requestPath() { return `users/${this.userId}`; }
  get requestMethod() { return HTTPMethod.get; }
  get isAuthorized() { return true; }
  get authHeaders() { return { Authorization: `Bearer ${session.accessToken}` }; }
}

export class CreateUserRequest extends SuccessTargetType {
  constructor(private name: string) { super(); }
  get baseURL() { return new AppApiTarget().kBaseURL; }
  get requestPath() { return 'users'; }
  get requestMethod() { return HTTPMethod.post; }
  get requestTask() { return RequestTask.encodedBody({ name: this.name }); }
}
```

`authHeaders` is re-evaluated whenever the request is rebuilt, so the replay after a token refresh carries the new token. If the response is a JSON array, override `fromDynamicJson(json)` instead of `fromJson`.

### Request tasks

| Factory | Sends |
|---|---|
| `RequestTask.plain()` | nothing |
| `RequestTask.parameters({...})` | query string (arrays repeat the key, `null` gives a bare key) |
| `RequestTask.encodedBody(obj)` | JSON body (encrypted when enabled) |
| `RequestTask.parametersAndBody(params, body)` | both |
| `RequestTask.uploadFile(path)` | raw file bytes as the body |
| `RequestTask.uploadMultipart({...})` | `multipart/form-data` from `MultipartFormDataText` / `MultipartFormDataData` |
| `RequestTask.download(url)` / `downloadResumable({ offset })` | GET for `performDownload()`; resumable adds `Range: bytes=offset-` |

## Step 3 — Call It

```ts
// Exceptions
try {
  const user = await new GetUserRequest(1).performAsync();
} catch (e) {
  if (e instanceof APIError && e.type === APIErrorType.noNetwork) { /* ... */ }
}

// Result
const result = await new GetUserRequest(1).performResult();
result.when({
  success: (user) => setUser(user),
  failure: (error) => setError(error.toString()),
});

// With cookies / headers
const { data, cookies, headers } = await new LoginRequest().performAsyncWithCookies();
```

Every failure is an `APIError` with a `type` (`APIErrorType`), an optional `statusCode` (`HTTPStatusCode` category), `httpStatus` (raw number) and `errorModel`.

## Step 4 — Handle Errors (`APIErrorResponseRegistry`)

```ts
import { APIErrorResponseRegistry } from 'bm-react-native-networking';

APIErrorResponseRegistry.register({
  decode: (json: any) => ({ code: json.code, message: json.message }),
});

// later
const error = await request.performAsync().catch((e) => e as APIError);
const model = error.errorModelAs<{ code: string; message: string }>();
```

## Step 5 — Token Refresh (`TokenRefreshRegistry`)

```ts
import { TokenRefreshRegistry } from 'bm-react-native-networking';

TokenRefreshRegistry.register({
  async refreshToken() {
    const ok = await session.refresh(); // store the new token where authHeaders reads it
    return ok;
  },
});
```

A 401 on an `isAuthorized` request calls the handler once (concurrent 401s share one refresh) and replays the request once. A cancelled or dropped request is never replayed. If the refresh fails the 401 propagates.

## Step 6 — Configure at Startup

```ts
import { Logger, NetworkConfig, HybridPayloadEncryptor } from 'bm-react-native-networking';

NetworkConfig.configure({
  payloadEncryptor: new HybridPayloadEncryptor({ publicKeyPem: ENCRYPT_PUBLIC_KEY }),
  isPayloadEncryptionEnabled: !__DEV__,
  receiveTimeout: 45_000,
});
Logger.isEnabled = __DEV__; // default
```

## Payload Encryption

`HybridPayloadEncryptor` generates a fresh AES key and IV per request, encrypts the JSON body with AES-CBC (PKCS7), and wraps the key with the server's RSA public key. The body becomes:

```json
{ "data": "<base64 cipher>", "iv": "<base64 iv>", "key": "<base64 rsa(aesKey)>" }
```

Options: `rsaPadding` (`pkcs1v15` default, `oaepSha1`, `oaepSha256`), `aesKeyFormat` (`hexString` default, `rawBytes`), `aesKeyBits` (128/192/256), `dataField`/`ivField`/`keyField`, `randomBytes`. Opt a single endpoint out with `get encryptsPayload() { return false; }`. Set `NetworkConfig.encryptQueryParameters = true` to also encrypt GET query strings (only if the backend decrypts them). Implement `PayloadEncryptor` to plug in a different scheme.

## Timeouts

`NetworkConfig.sendTimeout` (until response headers) and `receiveTimeout` (reading the body) default to 30 s; `null` disables. Override per endpoint with `get sendTimeout()` / `get receiveTimeout()`. React Native exposes no separate connect timeout, so `sendTimeout` also bounds connection setup. A timeout aborts the request and fails with `APIErrorType.timeout`.

## Cancellation and Dropped Connections

```ts
const token = new CancelToken();
const result = await request.performResult({ cancelToken: token });
// useEffect cleanup: token.cancel();
```

A cancelled request fails with `APIErrorType.cancelled`. If connectivity is lost while a request is in flight (requires NetInfo), reads fail with `noNetwork`; state-changing calls fail with `connectionLostDuringRequest` because the server may already have processed them, and are never retried automatically.

To use a connectivity library other than NetInfo: `NetworkMonitor.setProvider({ isOnline, subscribe })`.

## Uploads and Downloads

```ts
RequestTask.uploadMultipart({
  title: new MultipartFormDataText('Holiday'),
  photo: new MultipartFormDataData(bytes, 'photo.jpg', 'image/jpeg'),
});

const file = await new ReportDownload().performDownload(); // { downloadedUrl, remoteUrl, statusCode, headers }
```

Files are read with `fetch('file://...')` and saved with `expo-file-system`. For bare React Native, supply an adapter:

```ts
NetworkConfig.configure({
  fileSystem: {
    readBytes: async (path) => /* Uint8Array */,
    writeTemp: async (name, bytes) => /* file URI */,
  },
});
```

## SSL Pinning

```ts
get sslPinningConfiguration() {
  return {
    pinnedHosts: ['api.example.com'],
    pinnedPublicKeyHashes: ['<primary SPKI sha256 base64>', '<backup>'],
    includeSubdomains: false,
    allowFallback: false,
  };
}
```

`fetch` cannot be pinned from JavaScript, so pinning uses `react-native-ssl-public-key-pinning` (SPKI SHA-256 hashes; Expo needs a development build). Pins are installed natively once per configuration and apply to all app traffic for those hosts. If the module is missing the request fails with `APIErrorType.sslPinningUnavailable` unless `allowFallback` is true. Certificate-file pinning (`pinnedCertificatePaths` in the Flutter package) is not supported.

## WebSocket Streams

```ts
import { BMWebSocketClient, BMWebSocketRegistry } from 'bm-react-native-networking';

const prices = new BMWebSocketClient({
  url: 'wss://api.example.com/api/v2/ranger/private/',
  streams: ['global.currencies_prices', 'global.currencies_data'],
  accessToken: async () => session.accessToken,
  shouldReconnect: () => session.isLoggedIn,
});
BMWebSocketRegistry.register('prices', prices);

const off = prices.jsonMessages.subscribe((msg) => { /* ... */ });
prices.states.subscribe((s) => { /* 'connecting' | 'open' | 'reconnecting' | 'closed' */ });
await prices.connect();

BMWebSocketRegistry.closeAll(); // on logout
```

Streams share one connection (`?stream=a&stream=b`). Close codes 1000/1001 never reconnect; anything else reconnects with `ReconnectPolicies.exponential()` (override with `fixed(ms)` or your own), refreshing the token before each retry and reconnecting immediately when the network returns.

## Logging and Network Inspector

`Logger.isEnabled` defaults to `__DEV__` and prints formatted requests and responses. While enabled, every call is also captured by the inspector:

```tsx
import { NetworkInspectorOverlay } from 'bm-react-native-networking';

export default function Root() {
  return (
    <NetworkInspectorOverlay enabled={__DEV__}>
      <App />
    </NetworkInspectorOverlay>
  );
}
```

Shake the device (needs `expo-sensors`, or pass `shakeSource`) or call `NetworkInspector.instance.open()`. The inspector lists the last 200 calls with search, headers, bodies, timing and a light/dark toggle.

## Differences from the Flutter package

- `Target.kBaseURL` is a string (there is no `Uri` object).
- Results are `Success` / `Failure` classes with `when`, `map`, `mapError`; `isSuccess`/`isFailure` narrow the type.
- Optional peer packages are loaded with literal `require` calls inside `try` blocks, which is what Metro needs to bundle without them installed.
- Streams are `subscribe(listener)` emitters instead of Dart `Stream`s.
- Downloads fail on non-2xx before writing the file; `DownloadedFile` has `statusCode` and `headers` instead of a streamed response.
- No dedicated connect timeout and no certificate-file pinning (React Native limitation).
- The `SupportedLocale` enum was not ported.

## Example app

[`example/`](example) is an Expo app (iOS and Android) that exercises the package against public APIs: DummyJSON, httpbin and the Postman echo WebSocket. It covers REST, error mapping, token refresh, timeouts, cancellation, payload encryption, cookies, multipart upload, downloads, a WebSocket and the inspector. See [example/README.md](example/README.md).

## Development

```sh
npm install
npm run typecheck
npm test               # 188 tests
npm run test:coverage  # fails below 100% statements / branches / functions / lines
npm run build
```
