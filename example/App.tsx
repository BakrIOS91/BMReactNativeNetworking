import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, useColorScheme, View,
} from 'react-native';
import {
  APIError, BMWebSocketClient, BMWebSocketRegistry, NetworkConfig, NetworkInspector, NetworkInspectorOverlay,
  type SocketConnectionState,
} from 'bm-react-native-networking';
import { ECHO_SOCKET_URL } from './src/api';
import { scenarios } from './src/scenarios';
import { configureNetworking } from './src/setup';

configureNetworking();

interface LogLine { id: number; title: string; text: string; ms: number; ok: boolean }

export default function App() {
  const dark = useColorScheme() === 'dark';
  const c = dark ? { bg: '#111', card: '#1c1c1e', text: '#f2f2f2', sub: '#8e8e93', accent: '#0a84ff', ok: '#30d158', bad: '#ff453a' }
                 : { bg: '#f2f2f7', card: '#fff', text: '#111', sub: '#6c6c70', accent: '#007aff', ok: '#248a3d', bad: '#d70015' };

  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [encrypt, setEncrypt] = useState(false);
  const [image, setImage] = useState<string | undefined>();
  const nextId = useRef(0);

  const run = useCallback(async (id: string) => {
    const scenario = scenarios.find((s) => s.id === id)!;
    setRunning(id);
    const started = Date.now();
    let text: string; let ok = true;
    try {
      text = await scenario.run({ setImage });
      ok = !text.startsWith('❌');
    } catch (e) {
      ok = false;
      text = e instanceof APIError ? `❌ ${e.type}: ${e.message}` : `❌ ${String(e)}`;
    }
    setLog((l) => [{ id: nextId.current++, title: scenario.title, text, ok, ms: Date.now() - started }, ...l].slice(0, 30));
    setRunning(null);
  }, []);

  const groups = [...new Set(scenarios.map((s) => s.group))];

  return (
    <NetworkInspectorOverlay enabled>
      <View style={[styles.fill, { backgroundColor: c.bg }]}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          <Text style={[styles.h1, { color: c.text }]}>BM Networking</Text>
          <Text style={{ color: c.sub, marginBottom: 12 }}>
            Runs against public APIs (DummyJSON, httpbin, Postman echo). Shake the device or tap “Inspector” to see every call.
          </Text>

          <View style={[styles.card, { backgroundColor: c.card }]}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: c.text }]}>Encrypt request bodies</Text>
                <Text style={{ color: c.sub }}>AES-CBC + RSA hybrid envelope</Text>
              </View>
              <Switch value={encrypt} onValueChange={(v) => { setEncrypt(v); NetworkConfig.isPayloadEncryptionEnabled = v; }} />
            </View>
            <Pressable style={[styles.btn, { borderColor: c.accent }]} onPress={() => NetworkInspector.instance.open()}>
              <Text style={{ color: c.accent, fontWeight: '600' }}>Open Inspector</Text>
            </Pressable>
          </View>

          {groups.map((group) => (
            <View key={group} style={[styles.card, { backgroundColor: c.card }]}>
              <Text style={[styles.group, { color: c.sub }]}>{group.toUpperCase()}</Text>
              {scenarios.filter((s) => s.group === group).map((s) => (
                <Pressable key={s.id} disabled={running !== null} onPress={() => run(s.id)} style={[styles.row, { opacity: running && running !== s.id ? 0.4 : 1 }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.title, { color: c.text }]}>{s.title}</Text>
                    <Text style={{ color: c.sub, fontSize: 12 }}>{s.hint}</Text>
                  </View>
                  {running === s.id ? <ActivityIndicator /> : <Text style={{ color: c.accent, fontSize: 18 }}>▶</Text>}
                </Pressable>
              ))}
            </View>
          ))}

          <SocketCard colors={c} />

          {image && <Image source={{ uri: image }} style={styles.image} resizeMode="contain" />}

          <Text style={[styles.group, { color: c.sub, marginTop: 8 }]}>RESULTS</Text>
          {log.length === 0 && <Text style={{ color: c.sub }}>Tap a scenario above.</Text>}
          {log.map((l) => (
            <View key={l.id} style={[styles.card, { backgroundColor: c.card, borderLeftColor: l.ok ? c.ok : c.bad, borderLeftWidth: 4 }]}>
              <Text style={[styles.title, { color: c.text }]}>{l.title} <Text style={{ color: c.sub, fontWeight: '400' }}>· {l.ms} ms</Text></Text>
              <Text selectable style={[styles.mono, { color: c.text }]}>{l.text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </NetworkInspectorOverlay>
  );
}

function SocketCard({ colors: c }: { colors: Record<string, string> }) {
  const [state, setState] = useState<SocketConnectionState>('closed');
  const [lines, setLines] = useState<string[]>([]);
  const client = useRef<BMWebSocketClient | null>(null);

  useEffect(() => () => BMWebSocketRegistry.closeAll(), []);

  const connect = () => {
    const ws = new BMWebSocketClient({ url: ECHO_SOCKET_URL });
    BMWebSocketRegistry.register('echo', ws);
    ws.states.subscribe(setState);
    ws.messages.subscribe((m) => setLines((l) => [`← ${String(m)}`, ...l].slice(0, 6)));
    client.current = ws;
    void ws.connect();
  };

  const send = () => {
    const text = `ping ${new Date().toLocaleTimeString()}`;
    client.current?.send(text);
    setLines((l) => [`→ ${text}`, ...l].slice(0, 6));
  };

  return (
    <View style={[styles.card, { backgroundColor: c.card }]}>
      <Text style={[styles.group, { color: c.sub }]}>WEBSOCKET · ECHO</Text>
      <Text style={[styles.title, { color: c.text }]}>State: {state}</Text>
      <View style={styles.rowBetween}>
        <Pressable style={[styles.btn, { borderColor: c.accent }]} onPress={connect}><Text style={{ color: c.accent }}>Connect</Text></Pressable>
        <Pressable style={[styles.btn, { borderColor: c.accent }]} onPress={send}><Text style={{ color: c.accent }}>Send</Text></Pressable>
        <Pressable style={[styles.btn, { borderColor: c.bad }]} onPress={() => BMWebSocketRegistry.closeAll()}><Text style={{ color: c.bad }}>Close all</Text></Pressable>
      </View>
      {lines.map((line, i) => <Text key={i} style={[styles.mono, { color: c.text }]}>{line}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: 16, paddingTop: Platform.select({ ios: 8, default: 40 }), paddingBottom: 48 },
  h1: { fontSize: 28, fontWeight: '700' },
  card: { borderRadius: 12, padding: 14, marginBottom: 12 },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 6 },
  btn: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', marginTop: 4 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12, marginTop: 4 },
  image: { width: '100%', height: 96, marginBottom: 12 },
});
