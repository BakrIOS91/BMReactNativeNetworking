import { BMSocket, BMWebSocketClient, BMWebSocketRegistry, NetworkMonitor, ReconnectPolicies, TokenRefreshRegistry, SocketConnectionState } from '../src/core';
import { resetAll } from './helpers';

class FakeSocket implements BMSocket {
  onopen: any = null; onmessage: any = null; onerror: any = null; onclose: any = null;
  sent: string[] = []; closedWith?: number;
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.closedWith = code; }
}

function setup(extra: Partial<ConstructorParameters<typeof BMWebSocketClient>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const handshakes: Record<string, string>[] = [];
  const client = new BMWebSocketClient({
    url: 'wss://x.com/ws',
    streams: ['a.b', 'c'],
    accessToken: async () => 'tok',
    headers: { 'User-Agent': 'T' },
    reconnectPolicy: ReconnectPolicies.fixed(10),
    connector: (_u, h) => { const s = new FakeSocket(); sockets.push(s); handshakes.push(h); return s; },
    ...extra,
  });
  const states: SocketConnectionState[] = [];
  client.states.subscribe((s) => states.push(s));
  return { client, sockets, handshakes, states };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(resetAll);

test('connects with auth headers and stream query, then relays messages', async () => {
  const { client, sockets, handshakes, states } = setup();
  const p = client.connect();
  await tick(1);
  sockets[0].onopen();
  await p;
  expect(client.url).toBe('wss://x.com/ws?stream=a.b&stream=c');
  expect(handshakes[0]).toEqual({ 'User-Agent': 'T', Authorization: 'Bearer tok' });
  const raw: unknown[] = []; const json: unknown[] = [];
  client.messages.subscribe((m) => raw.push(m)); client.jsonMessages.subscribe((m) => json.push(m));
  sockets[0].onmessage({ data: '{"k":1}' }); sockets[0].onmessage({ data: 'plain' });
  expect(raw).toEqual(['{"k":1}', 'plain']);
  expect(json).toEqual([{ k: 1 }]);
  client.send({ hello: 1 });
  expect(sockets[0].sent).toEqual(['{"hello":1}']);
  expect(states).toEqual(['connecting', 'open']);
  client.close();
  expect(sockets[0].closedWith).toBe(1000);
});

test('reconnects after an abnormal close, refreshing the token first', async () => {
  const refresh = jest.fn(async () => true);
  TokenRefreshRegistry.register({ refreshToken: refresh });
  const { client, sockets, states } = setup();
  const p = client.connect(); await tick(1); sockets[0].onopen(); await p;
  sockets[0].onclose({ code: 1006 });
  await tick(60);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(sockets).toHaveLength(2);
  sockets[1].onopen();
  expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  client.close();
});

test('a normal close does not reconnect', async () => {
  const { client, sockets, states } = setup();
  const p = client.connect(); await tick(1); sockets[0].onopen(); await p;
  sockets[0].onclose({ code: 1000 });
  await tick(40);
  expect(sockets).toHaveLength(1);
  expect(states.at(-1)).toBe('closed');
});

test('shouldReconnect=false stops retrying', async () => {
  const { client, sockets, states } = setup({ shouldReconnect: () => false });
  const p = client.connect(); await tick(1); sockets[0].onopen(); await p;
  sockets[0].onclose({ code: 1006 });
  await tick(40);
  expect(sockets).toHaveLength(1);
  expect(states.at(-1)).toBe('closed');
});

test('regained connectivity reconnects immediately', async () => {
  let notify: (o: boolean) => void = () => {};
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
  const { client, sockets } = setup({ reconnectPolicy: ReconnectPolicies.fixed(60_000), refreshTokenOnReconnect: false });
  const p = client.connect(); await tick(1); sockets[0].onopen(); await p;
  sockets[0].onclose({ code: 1006 });
  expect(client.state).toBe('reconnecting');
  notify(true); await tick(5);
  expect(sockets).toHaveLength(2);
  client.close();
});

test('registry closes everything', async () => {
  const a = setup(); const b = setup();
  BMWebSocketRegistry.register('a', a.client); BMWebSocketRegistry.register('b', b.client);
  const pa = a.client.connect(); const pb = b.client.connect(); await tick(1);
  a.sockets[0].onopen(); b.sockets[0].onopen(); await Promise.all([pa, pb]);
  BMWebSocketRegistry.closeAll();
  expect([a.client.state, b.client.state]).toEqual(['closed', 'closed']);
  expect(BMWebSocketRegistry.get('a')).toBeUndefined();
});
