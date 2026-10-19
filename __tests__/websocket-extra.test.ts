import {
  BMSocket, BMWebSocketClient, BMWebSocketRegistry, NetworkMonitor, ReconnectPolicies, SocketConnectionState, TokenRefreshRegistry,
} from '../src/core';
import { resetAll } from './helpers';

class FakeSocket implements BMSocket {
  onopen: any = null; onmessage: any = null; onerror: any = null; onclose: any = null;
  sent: string[] = []; closeCalls: Array<number | undefined> = []; throwOnClose = false;
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.closeCalls.push(code); if (this.throwOnClose) throw new Error('already closed'); }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function make(opts: Partial<ConstructorParameters<typeof BMWebSocketClient>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const client = new BMWebSocketClient({
    url: 'wss://x.com/ws',
    reconnectPolicy: ReconnectPolicies.fixed(5),
    reconnectOnConnectivityRegained: false,
    connector: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    ...opts,
  });
  const states: SocketConnectionState[] = [];
  client.states.subscribe((s) => states.push(s));
  return { client, sockets, states };
}

async function open(m: ReturnType<typeof make>) {
  const p = m.client.connect();
  await tick(1);
  m.sockets[0].onopen();
  await p;
}

beforeEach(resetAll);

test('the default connector builds a React Native WebSocket with handshake headers', async () => {
  const created: any[] = [];
  (globalThis as any).WebSocket = class { constructor(...args: any[]) { created.push(args); } };
  const client = new BMWebSocketClient({ url: 'wss://x.com/ws?a=1', streams: ['s'], headers: { H: '1' }, reconnectOnConnectivityRegained: false });
  void client.connect();
  await tick(1);
  expect(created[0]).toEqual(['wss://x.com/ws?a=1&stream=s', null, { headers: { H: '1' } }]);
  client.close();
  delete (globalThis as any).WebSocket;
});

test('url without streams is unchanged; empty tokens add no Authorization header', async () => {
  const seen: Record<string, string>[] = [];
  const m = make({ accessToken: async () => '', connector: (_u, h) => { seen.push(h); const s = new FakeSocket(); m.sockets.push(s); return s; } });
  expect(m.client.url).toBe('wss://x.com/ws');
  await open(m);
  expect(seen[0]).toEqual({});
  m.client.close();
});

test('connect is idempotent, send is ignored unless open, strings are sent as-is', async () => {
  const m = make();
  m.client.send('early');
  const p1 = m.client.connect();
  const p2 = m.client.connect();
  await tick(1);
  m.client.send('connecting');
  m.sockets[0].onopen();
  await Promise.all([p1, p2]);
  expect(m.sockets).toHaveLength(1);
  m.client.send('raw');
  expect(m.sockets[0].sent).toEqual(['raw']);
  m.client.close();
  m.client.send('after close');
  expect(m.sockets[0].sent).toEqual(['raw']);
});

test('binary frames reach messages but are skipped by jsonMessages', async () => {
  const m = make();
  await open(m);
  const raw: unknown[] = []; const json: unknown[] = [];
  m.client.messages.subscribe((x) => raw.push(x));
  m.client.jsonMessages.subscribe((x) => json.push(x));
  m.sockets[0].onmessage({ data: new Uint8Array([1]) });
  expect(raw).toHaveLength(1);
  expect(json).toEqual([]);
  m.client.close();
});

test('closing while the token is being refreshed never opens a socket', async () => {
  let release: (ok: boolean) => void = () => {};
  TokenRefreshRegistry.register({ refreshToken: () => new Promise<boolean>((r) => { release = r; }) });
  const m = make();
  await open(m);
  m.sockets[0].onclose({ code: 1006 });
  await tick(15);
  m.client.close();
  release(true);
  await tick(5);
  expect(m.sockets).toHaveLength(1);
});

test('regained connectivity during an in-flight reconnect does not open a second socket', async () => {
  let notify: (o: boolean) => void = () => {};
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
  let release: (t: string) => void = () => {};
  let first = true;
  const m = make({
    reconnectOnConnectivityRegained: true, refreshTokenOnReconnect: false,
    accessToken: () => (first ? Promise.resolve('t') : new Promise<string>((r) => { release = r; })),
  });
  await open(m);
  first = false;
  m.sockets[0].onclose({ code: 1006 });
  await tick(15);
  notify(true);
  release('t');
  await tick(5);
  expect(m.sockets).toHaveLength(2);
  m.client.close();
});

test('closing while the token is being fetched never opens a socket', async () => {
  let release: (t: string) => void = () => {};
  const m = make({ accessToken: () => new Promise<string>((r) => { release = r; }) });
  const p = m.client.connect();
  m.client.close();
  release('t');
  await p;
  expect(m.sockets).toHaveLength(0);
  expect(m.client.state).toBe('closed');
});

test('a failing token source or connector schedules a reconnect', async () => {
  let fail = true;
  const m = make({ accessToken: async () => { if (fail) throw new Error('keychain'); return 't'; } });
  await m.client.connect();
  expect(m.client.state).toBe('reconnecting');
  fail = false;
  await tick(30);
  m.sockets[0].onopen();
  expect(m.client.state).toBe('open');
  m.client.close();
});

test('socket errors reconnect once even though close follows the error', async () => {
  const m = make();
  await open(m);
  m.sockets[0].onerror();
  m.sockets[0].onclose({ code: 1006 });
  await tick(30);
  expect(m.sockets).toHaveLength(2);
  m.client.close();
});

test('errors and closes before the socket opened settle connect and retry', async () => {
  const m = make();
  const p = m.client.connect();
  await tick(1);
  m.sockets[0].onclose(undefined);
  await p;
  await tick(30);
  expect(m.sockets).toHaveLength(2);
  m.sockets[1].onerror();
  await tick(30);
  expect(m.sockets).toHaveLength(3);
  m.client.close();
});

test('onopen after the client was closed is ignored; messages from replaced sockets are dropped', async () => {
  const m = make();
  const p = m.client.connect();
  await tick(1);
  const s = m.sockets[0];
  const onopen = s.onopen;
  const onmessage = s.onmessage;
  m.client.close();
  onopen();
  await p;
  const received: unknown[] = [];
  m.client.messages.subscribe((x) => received.push(x));
  onmessage({ data: 'late' });
  expect(received).toEqual([]);
  expect(m.client.state).toBe('closed');
});

test('close tolerates a socket that throws on close, and a repeated close', async () => {
  const m = make();
  await open(m);
  m.sockets[0].throwOnClose = true;
  expect(() => m.client.close()).not.toThrow();
  expect(() => m.client.close()).not.toThrow();
  expect(m.sockets[0].closeCalls).toEqual([1000]);
});

test('connectivity: ignores online while open, offline events, and survives a broken monitor', async () => {
  let notify: (o: boolean) => void = () => {};
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
  const m = make({ reconnectOnConnectivityRegained: true, reconnectPolicy: ReconnectPolicies.fixed(60_000), refreshTokenOnReconnect: false });
  await open(m);
  notify(true); notify(false);
  expect(m.sockets).toHaveLength(1);
  m.sockets[0].onclose({ code: 1006 });
  notify(false);
  expect(m.sockets).toHaveLength(1);
  m.client.close();

  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: () => { throw new Error('x'); } });
  const spy = jest.spyOn(NetworkMonitor, 'subscribe').mockImplementation(() => { throw new Error('boom'); });
  const broken = make({ reconnectOnConnectivityRegained: true });
  await open(broken);
  expect(broken.client.state).toBe('open');
  broken.client.close();
  spy.mockRestore();
});

test('connecting twice after a close subscribes to connectivity only once', async () => {
  let subscriptions = 0;
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: () => { subscriptions++; return () => {}; } });
  const m = make({ reconnectOnConnectivityRegained: true });
  const p = m.client.connect();
  await tick(1);
  m.sockets[0].onopen();
  await p;
  m.client.close();
  expect(subscriptions).toBe(1);
});

test('dispose closes and drops listeners', async () => {
  const m = make();
  await open(m);
  const seen = jest.fn();
  m.client.messages.subscribe(seen);
  m.client.dispose();
  m.client.messages.emit('x');
  expect(seen).not.toHaveBeenCalled();
  expect(m.client.state).toBe('closed');
});

test('registry: replace, same client, close by name, unknown names', async () => {
  const a = make(); const b = make();
  await open(a);
  BMWebSocketRegistry.register('s', a.client);
  BMWebSocketRegistry.register('s', a.client);
  expect(a.client.state).toBe('open');
  BMWebSocketRegistry.register('s', b.client);
  expect(a.client.state).toBe('closed');
  expect(BMWebSocketRegistry.get('s')).toBe(b.client);
  BMWebSocketRegistry.close('s');
  BMWebSocketRegistry.close('missing');
  expect(BMWebSocketRegistry.get('s')).toBeUndefined();
});

test('a token failure after close does not schedule a reconnect', async () => {
  let fail: (e: Error) => void = () => {};
  const m = make({ accessToken: () => new Promise<string>((_r, rej) => { fail = rej; }) });
  const p = m.client.connect();
  m.client.close();
  fail(new Error('late'));
  await p;
  await tick(15);
  expect(m.client.state).toBe('closed');
  expect(m.sockets).toHaveLength(0);
});
