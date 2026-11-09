import { useEffect, type ReactNode } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { onHop } from "@/lib/hop";
import { useTheme } from "./theme";

// 0.9.3 Hop (lib/hop.ts): wraps a face so it hops when that chat gets a message.
// full: up, land with a little squash, a smaller hop, settle (~0.9 s): pinned rows and the dock.
// soft: one small hop: every other row. Reduce Motion: a ring glows once instead.

const out = Easing.out(Easing.quad);
const inn = Easing.in(Easing.quad);

export function HopFace({
  chatId,
  kind,
  height,
  radius,
  children,
}: {
  chatId: string;
  kind: "full" | "soft";
  height: number;
  radius: number;
  children: ReactNode;
}) {
  const { c } = useTheme();
  const still = useReducedMotion();
  const y = useSharedValue(0);
  const squash = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(
    () =>
      onHop(chatId, () => {
        if (still) {
          glow.value = withSequence(
            withTiming(1, { duration: 250 }),
            withTiming(0, { duration: 650 }),
          );
          return;
        }
        const up = Math.round(height * (kind === "full" ? 0.36 : 0.12));
        if (kind === "full") {
          y.value = withSequence(
            withTiming(-up, { duration: 230, easing: out }),
            withTiming(0, { duration: 200, easing: inn }),
            withTiming(-Math.round(up / 2.7), { duration: 130, easing: out }),
            withTiming(0, { duration: 140, easing: inn }),
          );
          squash.value = withSequence(
            withTiming(0, { duration: 430 }),
            withTiming(1, { duration: 60 }),
            withTiming(0, { duration: 120 }),
            withTiming(0, { duration: 140 }),
            withTiming(0.4, { duration: 50 }),
            withTiming(0, { duration: 100 }),
          );
        } else {
          y.value = withSequence(
            withTiming(-up, { duration: 190, easing: out }),
            withTiming(0, { duration: 170, easing: inn }),
          );
          squash.value = withSequence(
            withTiming(0, { duration: 360 }),
            withTiming(0.4, { duration: 50 }),
            withTiming(0, { duration: 100 }),
          );
        }
      }),
    [chatId, kind, height, still, y, squash, glow],
  );
  const moving = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value + squash.value * height * 0.04 },
      { scaleX: 1 + squash.value * 0.08 },
      { scaleY: 1 - squash.value * 0.08 },
    ],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Animated.View style={moving}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: -3,
            left: -3,
            right: -3,
            bottom: -3,
            borderRadius: radius + 3,
            borderWidth: 2.5,
            borderColor: c.accent,
          },
          ring,
        ]}
      />
    </Animated.View>
  );
}
