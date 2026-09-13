import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {Button, Text} from '@/components/ui';
import {useTheme} from '@/theme';
import type {RemoteRelease, UpdatePhase} from './types';
import {getAppDisplayName} from './config';

/**
 * The Kharcha update dialog — one themed card, four stages:
 *
 *   available    "New Update Available" + What's new + [Later] [Update]
 *   downloading  "Downloading update... NN%" + progress bar
 *   launching    "Starting installer..." spinner
 *   failed       "Update failed" + [Retry] [Cancel]
 *
 * Optional updates can be dismissed (Later / backdrop / system back).
 * MANDATORY updates hide every dismissal affordance until the download
 * fails — after a failure the user always gets a Cancel escape (a broken
 * download must never trap the user in a dialog), and the mandatory dialog
 * simply returns on the next launch.
 */

export interface AppUpdateDialogProps {
  phase: UpdatePhase;
  onUpdate: (release: RemoteRelease) => void;
  onRetry: (release: RemoteRelease) => void;
  onDismiss: () => void;
}

const PROGRESS_BAR_HEIGHT = 6;

export function AppUpdateDialog({
  phase,
  onUpdate,
  onRetry,
  onDismiss,
}: AppUpdateDialogProps) {
  const {colors, radius, spacing} = useTheme();

  if (phase.stage === 'idle') {
    return null;
  }
  const release = phase.release;
  const mandatory = release.mandatory;

  const canDismiss = !mandatory;
  const dismissOrNothing = canDismiss ? onDismiss : undefined;

  const isDownloading = phase.stage === 'downloading';
  const percent = isDownloading
    ? Math.round(phase.progress * 100)
    : 0;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissOrNothing}
    >
      <View style={[styles.scrim, {backgroundColor: colors.backdrop}]}>
        {canDismiss ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close update dialog"
            onPress={onDismiss}
          />
        ) : null}

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
            },
          ]}
          accessible
        >
          {phase.stage === 'available' ? (
            <>
              <Text variant="title">New Update Available</Text>
              <Text
                variant="body"
                color="textMuted"
                style={{marginTop: spacing.sm}}
              >
                {getAppDisplayName()} {release.version} is now available.
              </Text>

              {release.releaseNotes.length > 0 ? (
                <View style={{marginTop: spacing.md}}>
                  <Text variant="label">What&apos;s new</Text>
                  {release.releaseNotes.map((note, index) => (
                    <Text
                      key={`${index}-${note.slice(0, 16)}`}
                      variant="body"
                      color="textMuted"
                      style={{marginTop: spacing.xs}}
                    >
                      • {note}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={[styles.buttonRow, {marginTop: spacing.lg, gap: spacing.sm}]}>
                {canDismiss ? (
                  <View style={styles.buttonFlex}>
                    <Button title="Later" variant="secondary" onPress={onDismiss} />
                  </View>
                ) : null}
                <View style={styles.buttonFlex}>
                  <Button
                    title="Update"
                    variant="primary"
                    onPress={() => onUpdate(release)}
                  />
                </View>
              </View>
            </>
          ) : null}

          {isDownloading ? (
            <>
              <Text variant="title">Downloading update...</Text>
              <Text
                variant="body"
                color="textMuted"
                style={{marginTop: spacing.sm}}
              >
                {percent}%
              </Text>
              <View
                style={[
                  styles.track,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.full,
                    marginTop: spacing.md,
                  },
                ]}
                importantForAccessibility="no"
              >
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radius.full,
                      width: `${Math.max(percent, 2)}%`,
                    },
                  ]}
                />
              </View>
              <Text
                variant="caption"
                color="textMuted"
                style={{marginTop: spacing.md}}
              >
                Keep the app open while the update downloads.
              </Text>
            </>
          ) : null}

          {phase.stage === 'launching' ? (
            <>
              <Text variant="title">Starting installer...</Text>
              <View
                style={{
                  alignItems: 'flex-start',
                  marginTop: spacing.md,
                }}
              >
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
              <Text
                variant="caption"
                color="textMuted"
                style={{marginTop: spacing.md}}
              >
                Android may ask you to allow installs from this app once.
              </Text>
            </>
          ) : null}

          {phase.stage === 'failed' ? (
            <>
              <Text variant="title">Update failed</Text>
              <Text
                variant="body"
                color="textMuted"
                style={{marginTop: spacing.sm}}
              >
                Please try again later.
              </Text>
              <View style={[styles.buttonRow, {marginTop: spacing.lg, gap: spacing.sm}]}>
                <View style={styles.buttonFlex}>
                  <Button
                    title="Retry"
                    variant="primary"
                    onPress={() => onRetry(release)}
                  />
                </View>
                <View style={styles.buttonFlex}>
                  <Button title="Cancel" variant="secondary" onPress={onDismiss} />
                </View>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '86%',
    maxWidth: 340,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonFlex: {
    flex: 1,
  },
  track: {
    height: PROGRESS_BAR_HEIGHT,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
