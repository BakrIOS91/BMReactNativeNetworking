/** Lightweight stand-in for react-native so the overlay can be rendered with react-test-renderer in Node. */
import React from 'react';

const host = (name: string) => {
  const C = ({ children, ...props }: any) => React.createElement(name, props, children);
  C.displayName = name;
  return C;
};

export const View = host('View');
export const Text = host('Text');
export const ScrollView = host('ScrollView');
export const TextInput = host('TextInput');
export const Platform = { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default };
export const Pressable = host('Pressable');

export const Modal = ({ visible, children, ...props }: any) =>
  visible ? React.createElement('Modal', props, children) : null;

export const FlatList = ({ data, renderItem, keyExtractor, ListEmptyComponent }: any) =>
  React.createElement(
    'FlatList',
    null,
    data.length === 0
      ? ListEmptyComponent
      : data.map((item: any) => React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item }))),
  );

export const StyleSheet = { create: <T,>(s: T) => s, hairlineWidth: 1 };
