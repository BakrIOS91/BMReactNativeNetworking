import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { utf8Decode } from '../../../helpers/bytes';
import { NetworkInspector, type InspectorBrightness } from './network-inspector';
import { isErrorEntry, isPending, type NetworkLogEntry } from './network-log-entry';
import { accelerometerShakeSource, type ShakeSource } from './shake-detector';

const palette = (b: InspectorBrightness) =>
  b === 'dark'
    ? { bg: '#121212', card: '#1e1e1e', text: '#f2f2f2', sub: '#9a9a9a', border: '#333', ok: '#4caf50', err: '#ef5350', wait: '#ffb300' }
    : { bg: '#f5f5f7', card: '#ffffff', text: '#111111', sub: '#666666', border: '#ddd', ok: '#2e7d32', err: '#c62828', wait: '#ef6c00' };

export interface NetworkInspectorOverlayProps {
  children?: React.ReactNode;
  /** Master switch; when false only [children] render. Default: true. */
  enabled?: boolean;
  /** Open the inspector on shake. Default: true. */
  shakeToOpen?: boolean;
  /** Custom shake source. Defaults to `expo-sensors` when installed. */
  shakeSource?: ShakeSource;
}

/**
 * Wrap the app root to get the in-app network inspector. It opens on shake or
 * programmatically with `NetworkInspector.instance.open()`.
 *
 * ```tsx
 * <NetworkInspectorOverlay enabled={__DEV__}>
 *   <App />
 * </NetworkInspectorOverlay>
 * ```
 */
export function NetworkInspectorOverlay({
  children,
  enabled = true,
  shakeToOpen = true,
  shakeSource,
}: NetworkInspectorOverlayProps) {
  const inspector = NetworkInspector.instance;
  const state = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot);

  useEffect(() => {
    if (!enabled || !shakeToOpen) return;
    return (shakeSource ?? accelerometerShakeSource())(() => inspector.open());
  }, [enabled, shakeToOpen, shakeSource, inspector]);

  if (!enabled) return <>{children}</>;

  return (
    <>
      {children}
      <Modal visible={state.visible} animationType="slide" onRequestClose={() => inspector.close()}>
        <InspectorScreen />
      </Modal>
    </>
  );
}

function InspectorScreen() {
  const inspector = NetworkInspector.instance;
  const { logs, brightness } = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const c = palette(brightness);
  const selected = logs.find((l) => l.id === selectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? logs.filter((l) => `${l.method} ${l.url} ${l.statusCode ?? ''}`.toLowerCase().includes(q)) : logs;
  }, [logs, query]);

  return (
    <View style={[styles.fill, styles.inset, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { borderColor: c.border }]}>
        {selected ? (
          <Action label="‹ Back" color={c.text} onPress={() => setSelectedId(undefined)} />
        ) : (
          <Action label="Close" color={c.text} onPress={() => inspector.close()} />
        )}
        <Text style={[styles.title, { color: c.text }]}>{selected ? 'Request' : `Network (${logs.length})`}</Text>
        <View style={styles.row}>
          <Action label={brightness === 'dark' ? '☀︎' : '☾'} color={c.text} onPress={() => inspector.toggleBrightness()} />
          {!selected && <Action label="Clear" color={c.err} onPress={() => inspector.clear()} />}
        </View>
      </View>

      {selected ? (
        <Detail entry={selected} colors={c} />
      ) : (
        <>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by method, URL or status"
            placeholderTextColor={c.sub}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.search, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
          />
          <FlatList
            data={filtered}
            keyExtractor={(l) => l.id}
            ListEmptyComponent={<Text style={[styles.empty, { color: c.sub }]}>No requests captured yet.</Text>}
            renderItem={({ item }) => <Row entry={item} colors={c} onPress={() => setSelectedId(item.id)} />}
          />
        </>
      )}
    </View>
  );
}

type Colors = ReturnType<typeof palette>;

function statusColor(e: NetworkLogEntry, c: Colors): string {
  return isPending(e) ? c.wait : isErrorEntry(e) ? c.err : c.ok;
}

function Row({ entry, colors: c, onPress }: { entry: NetworkLogEntry; colors: Colors; onPress: () => void }) {
  const color = statusColor(entry, c);
  return (
    <Pressable onPress={onPress} style={[styles.item, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.row}>
        <Text style={[styles.badge, { color: c.text, borderColor: c.border }]}>{entry.method}</Text>
        <Text style={[styles.badge, { color, borderColor: color }]}>
          {isPending(entry) ? '…' : entry.statusCode ?? 'ERR'}
        </Text>
        {entry.duration !== undefined && <Text style={{ color: c.sub }}>{entry.duration} ms</Text>}
      </View>
      <Text numberOfLines={2} style={{ color: c.text, marginTop: 6 }}>
        {entry.url}
      </Text>
    </Pressable>
  );
}

function Detail({ entry, colors: c }: { entry: NetworkLogEntry; colors: Colors }) {
  return (
    <ScrollView contentContainerStyle={styles.detail}>
      <Section title="General" colors={c} body={`${entry.method} ${entry.url}\nStatus: ${entry.statusCode ?? (entry.error ? 'error' : 'pending')}${entry.duration !== undefined ? `\nDuration: ${entry.duration} ms` : ''}${entry.error ? `\nError: ${String(entry.error)}` : ''}`} />
      <Section title="Request headers" colors={c} body={formatHeaders(entry.requestHeaders)} />
      <Section title="Request body" colors={c} body={formatBody(entry.requestBody)} />
      <Section title="Response headers" colors={c} body={formatHeaders(entry.responseHeaders)} />
      <Section title="Response body" colors={c} body={formatBody(entry.responseBody)} />
    </ScrollView>
  );
}

function Section({ title, body, colors: c }: { title: string; body: string; colors: Colors }) {
  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.sectionTitle, { color: c.sub }]}>{title}</Text>
      <Text selectable style={[styles.mono, { color: c.text }]}>
        {body}
      </Text>
    </View>
  );
}

function Action({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.action}>
      <Text style={{ color, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function formatHeaders(headers?: Record<string, string>): string {
  const entries = Object.entries(headers ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('\n') : '—';
}

function formatBody(body?: Uint8Array): string {
  if (!body || body.length === 0) return '—';
  const text = utf8Decode(body);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // SafeAreaView is deprecated; a fixed inset keeps the package free of a safe-area dependency.
  inset: { paddingTop: Platform.select({ ios: 54, default: 28 }), paddingBottom: Platform.select({ ios: 24, default: 8 }) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: '600' },
  action: { paddingHorizontal: 6, paddingVertical: 4 },
  search: { margin: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  item: { marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  empty: { textAlign: 'center', marginTop: 40 },
  detail: { padding: 12, gap: 10 },
  section: { padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
});
