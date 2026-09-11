import React, {useMemo} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {Card, Text} from '@/components/ui';
import {findHighestSpendingDay} from '@/features/reports/calculate';
import type {DailySpendingPoint} from '@/features/reports/types';
import {useTheme} from '@/theme';
import {formatDateRangeLabel} from '@/features/reports/period';
import {formatCurrency} from '@/utils/format';
import {formatShortDate} from '@/utils/date';

export interface DailyTrendChartProps {
  /** Complete chronological series — zero-spend days included. */
  points: DailySpendingPoint[];
  currency: string;
  /**
   * Days aggregated into ONE bar (Phase 9, long custom ranges). null/absent
   * = daily bars. Adjusts the caption + screen-reader copy so bucketed
   * series are never misread as single days.
   */
  bucketDays?: number | null;
}

const CHART_HEIGHT = 120;
/** Bar width once the series is too dense for a flex row (custom ranges). */
const SCROLLING_BAR_WIDTH = 18;
const SCROLLING_BAR_GAP = 4;
/** Above this many days the chart scrolls horizontally instead of squeezing. */
const FLEX_ROW_LIMIT = 14;
/** Zero-spend days still get a visible baseline stub. */
const ZERO_STUB_HEIGHT = 2;
/** Smallest visible bar for non-zero days (tiny amounts stay noticeable). */
const MIN_BAR_HEIGHT = 3;

/**
 * Daily spending trend as a lightweight bar chart built from themed Views —
 * no chart dependency, no SVG, no native module. Bars scale against the
 * peak day; zero-spend days render as baseline stubs so gaps stay readable.
 *
 * The chart is decorative-plus: every number it shows is also available as
 * text (the footer line + insights), so it is never the only way to read
 * the data.
 */
export function DailyTrendChart({
  points,
  currency,
  bucketDays = null,
}: DailyTrendChartProps) {
  const {colors, radius, spacing} = useTheme();

  const peak = useMemo(() => findHighestSpendingDay(points), [points]);
  const max = peak?.total ?? 0;

  const scrolling = points.length > FLEX_ROW_LIMIT;
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const daysWithSpending = points.filter(point => point.total > 0).length;

  const first = points[0];
  const last = points[points.length - 1];
  const barDescription =
    bucketDays && bucketDays > 1
      ? `Each bar covers ${bucketDays} days`
      : 'Each bar is one day';

  const accessibilityLabel =
    first && last
      ? `Daily spending from ${formatDateRangeLabel(first.date, last.date)}. ` +
        `${daysWithSpending} of ${points.length} ${
          bucketDays && bucketDays > 1 ? 'periods' : 'days'
        } had spending. ` +
        (peak
          ? `Highest ${formatShortDate(peak.date)} at ${formatCurrency(peak.total, currency)}.`
          : 'No spending recorded.')
      : 'No daily spending data.';

  const bars = points.map((point, index) => {
    const height =
      point.total <= 0 || max <= 0
        ? ZERO_STUB_HEIGHT
        : Math.max(
            MIN_BAR_HEIGHT,
            Math.round((point.total / max) * CHART_HEIGHT),
          );
    const showLabel =
      !scrolling || index % labelStep === 0 || index === points.length - 1;
    return (
      <View
        key={point.date}
        style={
          scrolling
            ? [
                styles.scrollColumn,
                {
                  width: SCROLLING_BAR_WIDTH,
                  marginRight: SCROLLING_BAR_GAP,
                },
              ]
            : styles.flexColumn
        }
      >
        <View style={styles.barArea}>
          <View
            style={[
              styles.bar,
              {
                height,
                backgroundColor:
                  point.total > 0 ? colors.primary : colors.border,
                borderRadius: radius.sm,
              },
            ]}
          />
        </View>
        {showLabel ? (
          <Text variant="caption" align="center" style={styles.dayLabel}>
            {new Date(point.date).getDate()}
          </Text>
        ) : (
          <View style={styles.dayLabelPlaceholder} />
        )}
      </View>
    );
  });

  return (
    <Card style={{marginTop: spacing.md}}>
      <Text variant="title">Daily Spending</Text>

      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        style={{marginTop: spacing.md}}
      >
        {scrolling ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.row}>{bars}</View>
          </ScrollView>
        ) : (
          <View style={[styles.row, styles.flexRow]}>{bars}</View>
        )}
      </View>

      <Text variant="caption" color="textMuted" style={{marginTop: spacing.sm}}>
        {peak && first && last
          ? `Peak ${formatShortDate(
              peak.date,
            )} — ${formatCurrency(peak.total, currency)} · ${barDescription.toLowerCase()}`
          : 'No spending recorded in this period.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'flex-end'},
  flexRow: {alignItems: 'stretch'},
  flexColumn: {flex: 1, marginHorizontal: 1},
  scrollColumn: {justifyContent: 'flex-end'},
  barArea: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
  },
  bar: {width: '100%'},
  dayLabel: {marginTop: 2},
  dayLabelPlaceholder: {height: 14},
});
