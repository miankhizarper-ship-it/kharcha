import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {Screen} from '../Screen';

/** React 19: ReactElement's props default to unknown — tests read props. */
type El = React.ReactElement<any>;

jest.mock('@/theme', () => ({
  useTheme: () => ({
    colors: {background: '#F6F7F9'},
    spacing: {md: 16, xl: 32},
  }),
}));

/**
 * Regression guard for the v1.0 physical-device defect: vertical scrolling
 * was blocked on every `<Screen scroll>` screen because the shared content
 * container used `flex: 1`. `flex: 1` expands to flexBasis '0%' +
 * flexShrink 1, so Yoga resolved the container's measured height to the
 * ScrollView viewport exactly — contentSize never exceeded the viewport and
 * tall content could not scroll (while still painting below the fold).
 * The contract below pins the content container to `flexGrow: 1` and keeps
 * the non-scroll branch a bounded `flex: 1` box (FlatList screens such as
 * Transactions depend on that bounded parent).
 *
 * Screen is a pure props→styles mapper, so it is invoked directly as a
 * function: this asserts the exact objects handed to React Native without
 * needing a renderer dependency.
 */

const child = React.createElement(View, {testID: 'child'});

function renderScreen(
  props: Omit<Parameters<typeof Screen>[0], 'children'>,
): El {
  return Screen({...props, children: child});
}

describe('Screen', () => {
  describe('scroll branch (shared ScrollView)', () => {
    it('content container grows with content and is NOT pinned to the viewport', () => {
      const tree = renderScreen({scroll: true});
      const scrollView = tree.props.children as El;

      expect(scrollView.type).toBe(ScrollView);
      const flat = StyleSheet.flatten(
        scrollView.props.contentContainerStyle,
      ) as Record<string, unknown>;

      // The fix: fills short content, follows tall content.
      expect(flat.flexGrow).toBe(1);
      // The defect: `flex: 1` (flexBasis '0%' + flexShrink 1) froze the
      // measured height at the viewport and blocked scrolling. It must never
      // reappear on the content container.
      expect('flex' in flat).toBe(false);
      expect(flat.flexShrink).toBeUndefined();
      expect(flat.flexBasis).toBeUndefined();
    });

    it('ScrollView viewport and SafeAreaView root stay bounded flex boxes', () => {
      const tree = renderScreen({scroll: true});
      const scrollView = tree.props.children as El;

      expect(StyleSheet.flatten(scrollView.props.style)).toMatchObject({
        flex: 1,
      });
      expect(StyleSheet.flatten(tree.props.style)).toMatchObject({
        flex: 1,
        backgroundColor: '#F6F7F9',
      });
    });

    it('keeps padded defaults and caller style precedence', () => {
      const tree = renderScreen({
        scroll: true,
        contentContainerStyle: {paddingBottom: 99},
        style: {paddingTop: 7},
      });
      const scrollView = tree.props.children as El;
      const flat = StyleSheet.flatten(
        scrollView.props.contentContainerStyle,
      ) as Record<string, number>;

      expect(flat.paddingHorizontal).toBe(16);
      // Caller styles win over the padded defaults (last-write ordering).
      expect(flat.paddingBottom).toBe(99);
      expect(flat.paddingTop).toBe(7);
    });

    it('drops horizontal padding when padded={false}', () => {
      const tree = renderScreen({scroll: true, padded: false});
      const scrollView = tree.props.children as El;
      const flat = StyleSheet.flatten(
        scrollView.props.contentContainerStyle,
      ) as Record<string, unknown>;

      expect(flat.paddingHorizontal).toBeUndefined();
      expect(flat.flexGrow).toBe(1);
    });

    it('forwards scroll behavior props, refresh control and children untouched', () => {
      const refreshControl = React.createElement(View, {
        testID: 'refresh',
      }) as unknown as El;
      const tree = renderScreen({scroll: true, refreshControl});
      const scrollView = tree.props.children as El;

      expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
      expect(scrollView.props.alwaysBounceVertical).toBe(false);
      expect(scrollView.props.refreshControl).toBe(refreshControl);
      expect(scrollView.props.children).toBe(child);
    });
  });

  describe('non-scroll branch (bounded container)', () => {
    it('content View stays a bounded flex: 1 box for FlatList screens', () => {
      const tree = renderScreen({});
      const view = tree.props.children as El;

      expect(view.type).toBe(View);
      const flat = StyleSheet.flatten(view.props.style) as Record<
        string,
        unknown
      >;

      // TransactionsScreen mounts a FlatList that fills this box; it must
      // remain height-bounded (flex: 1), not content-sized.
      expect(flat.flex).toBe(1);
      expect(flat.paddingHorizontal).toBe(16);
      expect(flat.paddingBottom).toBe(32);
    });

    it('forwards caller contentContainerStyle and children', () => {
      const tree = renderScreen({contentContainerStyle: {gap: 8}});
      const view = tree.props.children as El;

      const flat = StyleSheet.flatten(view.props.style) as Record<
        string,
        unknown
      >;
      expect(flat.gap).toBe(8);
      expect(view.props.children).toBe(child);
    });
  });
});
