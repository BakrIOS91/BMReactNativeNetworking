import {
  APIError,
  APIErrorType,
  CancelToken,
  NetworkConfig,
  type Result,
} from 'bm-react-native-networking';
import {
  Bearer, CreatePost, DeletePost, Delay, DownloadImage, GetPost, ListPosts, PostJson, SetCookie, Status,
  UploadMultipart, session, type ApiProblem,
} from './api';

export interface Scenario {
  id: string;
  group: string;
  title: string;
  hint: string;
  /** Returns a short human-readable outcome. May throw an APIError. */
  run(ctx: { setImage(uri: string): void }): Promise<string>;
}

const short = (value: unknown, max = 220) => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'done');
  return text.length > max ? text.slice(0, max) + '…' : text;
};

const describe = (result: Result<unknown, APIError>) =>
  result.when({
    success: (v) => '✅ ' + short(v),
    failure: (e) => '❌ ' + e.type + (e.errorModel ? ' · ' + (e.errorModel as ApiProblem).message : ''),
  });

export const scenarios: Scenario[] = [
  {
    id: 'list', group: 'REST · DummyJSON', title: 'List posts', hint: 'GET /posts?limit=10, response unwrapped with fromDynamicJson',
    run: async () => `✅ ${(await new ListPosts().performAsync()).length} posts`,
  },
  {
    id: 'filter', group: 'REST · DummyJSON', title: 'Posts of user 5', hint: 'path + repeated query parameters',
    run: async () => `✅ ${(await new ListPosts(5).performAsync()).length} posts for user 5`,
  },
  {
    id: 'get', group: 'REST · DummyJSON', title: 'Get post 1', hint: 'ModelTargetType<Post>',
    run: async () => '✅ ' + short(await new GetPost(1).performAsync()),
  },
  {
    id: 'create', group: 'REST · DummyJSON', title: 'Create post', hint: 'POST with a JSON body (plain: DummyJSON cannot decrypt)',
    run: async () => describe(await new CreatePost('Hello from React Native').performResult()),
  },
  {
    id: 'delete', group: 'REST · DummyJSON', title: 'Delete post 1', hint: 'SuccessTargetType, no body decoded',
    run: async () => describe(await new DeletePost(1).performResult()),
  },
  {
    id: '404', group: 'Errors', title: 'Missing post (404)', hint: 'error payload decoded by APIErrorResponseRegistry',
    run: async () => describe(await new GetPost(99999).performResult()),
  },
  {
    id: '500', group: 'Errors', title: 'Server error (500)', hint: 'httpbin /status/500',
    run: async () => describe(await new Status(500).performResult()),
  },
  {
    id: 'refresh', group: 'Auth', title: 'Bearer with token refresh', hint: 'starts with an empty token → 401 → refresh → replay',
    run: async () => {
      session.accessToken = '';
      const body = await new Bearer().performAsync();
      return `✅ authenticated=${body.authenticated} token=${body.token}`;
    },
  },
  {
    id: 'timeout', group: 'Resilience', title: 'Timeout after 2 s', hint: 'per-endpoint sendTimeout vs a 6 s delay',
    run: async () => describe(await new Delay(6, 2000).performResult()),
  },
  {
    id: 'cancel', group: 'Resilience', title: 'Cancel after 1 s', hint: 'CancelToken against a 6 s delay',
    run: async () => {
      const token = new CancelToken();
      setTimeout(() => token.cancel(), 1000);
      const result = await new Delay(6).performResult({ cancelToken: token });
      return result.isFailure && result.error.type === APIErrorType.cancelled ? '✅ cancelled as expected' : describe(result);
    },
  },
  {
    id: 'plain', group: 'Security', title: 'POST (current encryption setting)', hint: 'httpbin echoes what it received',
    run: async () => {
      const echo = await new PostJson(true).performAsync();
      return NetworkConfig.shouldEncrypt ? '🔒 server saw ' + short(echo.json) : '📄 server saw ' + short(echo.json);
    },
  },
  {
    id: 'opt-out', group: 'Security', title: 'POST with encryptsPayload = false', hint: 'always plain, even with the switch on',
    run: async () => '📄 server saw ' + short((await new PostJson(false).performAsync()).json),
  },
  {
    id: 'cookies', group: 'Files & cookies', title: 'Read Set-Cookie', hint: 'performAsyncWithCookies',
    run: async () => {
      const res = await new SetCookie().performAsyncWithCookies();
      return `✅ ${res.statusCode} cookies=${short(res.cookies)}`;
    },
  },
  {
    id: 'upload', group: 'Files & cookies', title: 'Multipart upload', hint: 'text field + file part',
    run: async () => {
      const body = await new UploadMultipart().performAsync();
      return '✅ server received ' + short({ form: body.form, files: body.files });
    },
  },
  {
    id: 'download', group: 'Files & cookies', title: 'Download an image', hint: 'saved with expo-file-system',
    run: async (ctx) => {
      const file = await new DownloadImage().performDownload();
      ctx.setImage(file.downloadedUrl!);
      return '✅ saved to ' + file.downloadedUrl;
    },
  },
];
