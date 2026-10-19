import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { NetworkInspector, NetworkInspectorOverlay, utf8Encode } from '../src';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const inspector = NetworkInspector.instance;
const texts = (root: ReactTestInstance) =>
  root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
const press = (root: ReactTestInstance, label: string) => {
  const target = root.findAll((n) => (n.type as unknown) === 'Pressable').find((p) => texts(p).includes(label));
  if (!target) throw new Error(`no pressable "${label}"`);
  act(() => target.props.onPress());
};

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => { act(() => mounted.splice(0).forEach((r) => r.unmount())); });

function mount(props: Partial<React.ComponentProps<typeof NetworkInspectorOverlay>> = {}) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<NetworkInspectorOverlay {...props}><Child /></NetworkInspectorOverlay>); });
  mounted.push(r);
  return r;
}
const Child = () => React.createElement('Text', null, 'app');

function seed() {
  inspector.clear();
  inspector.close();
  const ok = inspector.logRequest({ method: 'GET', url: 'https://x.com/ok', headers: { a: 'b' }, body: utf8Encode('{"q":1}') });
  inspector.logResponse({ entry: ok, statusCode: 200, headers: { h: 'v' }, body: utf8Encode('{"r":2}'), duration: 12 });
  const bad = inspector.logRequest({ method: 'POST', url: 'https://x.com/bad', body: utf8Encode('not json') });
  inspector.logResponse({ entry: bad, statusCode: 500, body: new Uint8Array() });
  const err = inspector.logRequest({ method: 'GET', url: 'https://x.com/err' });
  inspector.logError({ entry: err, error: new Error('offline') });
  inspector.logRequest({ method: 'PUT', url: 'https://x.com/pending' });
}

beforeEach(seed);

test('renders only the children when disabled or closed', () => {
  expect(texts(mount({ enabled: false }).root)).toEqual(['app']);
  const r = mount({ shakeSource: () => () => {} });
  expect(texts(r.root)).toEqual(['app']);
});

test('shake opens the inspector and the subscription is cleaned up', () => {
  let shake: () => void = () => {};
  const off = jest.fn();
  const r = mount({ shakeSource: (cb) => { shake = cb; return off; } });
  act(() => shake());
  expect(inspector.getSnapshot().visible).toBe(true);
  act(() => { mounted.splice(mounted.indexOf(r), 1); r.unmount(); });
  expect(off).toHaveBeenCalled();
});

test('shake is not wired when disabled or shakeToOpen is false', () => {
  const source = jest.fn(() => () => {});
  mount({ enabled: false, shakeSource: source });
  mount({ shakeToOpen: false, shakeSource: source });
  expect(source).not.toHaveBeenCalled();
});

test('falls back to the accelerometer source when none is given', () => {
  expect(() => mount()).not.toThrow();
});

test('lists calls, filters, opens details and navigates back', () => {
  const r = mount({ shakeSource: () => () => {} });
  act(() => inspector.open());
  let all = texts(r.root);
  expect(all).toContain('Network (4)');
  expect(all).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', '200', '500', 'ERR', '…', '12 ms']));

  const input = r.root.findByType('TextInput' as any);
  act(() => input.props.onChangeText('bad'));
  expect(texts(r.root).filter((t) => t.startsWith('https://'))).toEqual(['https://x.com/bad']);
  act(() => input.props.onChangeText('zzz'));
  expect(texts(r.root)).toContain('No requests captured yet.');
  act(() => input.props.onChangeText('   '));
  expect(texts(r.root).filter((t) => t.startsWith('https://'))).toHaveLength(4);

  const item = r.root.findAll((n) => (n.type as unknown) === 'Pressable').find((p) => texts(p).includes('https://x.com/ok'))!;
  act(() => item.props.onPress());
  all = texts(r.root);
  expect(all).toContain('Request');
  expect(all.join('\n')).toContain('GET https://x.com/ok\nStatus: 200\nDuration: 12 ms');
  expect(all.join('\n')).toContain('a: b');
  expect(all.join('\n')).toContain('"q": 1');
  expect(all.join('\n')).toContain('"r": 2');
  press(r.root, '‹ Back');
  expect(texts(r.root)).toContain('Network (4)');
});

test('detail view handles errors, plain bodies, empty bodies and pending calls', () => {
  const r = mount({ shakeSource: () => () => {} });
  act(() => inspector.open());
  const open = (url: string) => {
    const item = r.root.findAll((n) => (n.type as unknown) === 'Pressable').find((p) => texts(p).includes(url))!;
    act(() => item.props.onPress());
    const out = texts(r.root).join('\n');
    press(r.root, '‹ Back');
    return out;
  };
  expect(open('https://x.com/bad')).toContain('not json');
  expect(open('https://x.com/err')).toContain('Status: error\nError: Error: offline');
  expect(open('https://x.com/pending')).toContain('Status: pending');
  expect(open('https://x.com/bad')).toContain('—');
});

test('toolbar: theme toggle, clear and close', () => {
  const r = mount({ shakeSource: () => () => {} });
  act(() => inspector.open());
  press(r.root, '☀︎');
  expect(inspector.getSnapshot().brightness).toBe('light');
  press(r.root, '☾');
  expect(inspector.getSnapshot().brightness).toBe('dark');
  press(r.root, 'Clear');
  expect(inspector.logs).toHaveLength(0);
  press(r.root, 'Close');
  expect(inspector.getSnapshot().visible).toBe(false);
});

test('modal back handler closes the inspector; no Clear button inside a detail view', () => {
  const r = mount({ shakeSource: () => () => {} });
  act(() => inspector.open());
  const item = r.root.findAll((n) => (n.type as unknown) === 'Pressable').find((p) => texts(p).includes('https://x.com/ok'))!;
  act(() => item.props.onPress());
  expect(texts(r.root)).not.toContain('Clear');
  act(() => r.root.findByType('Modal' as any).props.onRequestClose());
  expect(inspector.getSnapshot().visible).toBe(false);
});

test('light theme renders too', () => {
  const r = mount({ shakeSource: () => () => {} });
  act(() => { inspector.toggleBrightness(); inspector.open(); });
  expect(texts(r.root)).toContain('Network (4)');
  act(() => inspector.toggleBrightness());
});
