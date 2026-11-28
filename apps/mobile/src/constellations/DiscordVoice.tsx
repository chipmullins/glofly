import { Image, Linking, Pressable, View } from "react-native";
import type { DiscordVoicePresence } from "@glofly/shared";
import { SERVER_URL } from "@/lib/config";
import { Text } from "@/ui/kit";

// Nov 28: under a voice nebula paired with a Discord voice channel: who's in that Discord channel,
// and "Open in Discord". No sound crosses; the people in this nebula show in Discord the same way.

const namesLine = (names: string[]): string =>
  names.length <= 2
    ? names.join(" and ")
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

export function DiscordVoice({
  discord,
  indent = 26,
}: {
  discord: DiscordVoicePresence;
  indent?: number;
}) {
  const people = discord.people;
  return (
    <View
      accessible
      accessibilityLabel={`${people.length ? `On Discord in ${discord.channelName}: ${namesLine(people.map((p) => p.name))}` : `Paired with Discord ${discord.channelName}`}`}
      style={{
        marginLeft: indent + 12,
        marginRight: 12,
        marginBottom: 6,
        padding: 10,
        borderRadius: 12,
        gap: 6,
        backgroundColor: "rgba(88,101,242,0.16)",
        borderWidth: 1,
        borderColor: "rgba(146,156,255,0.22)",
      }}
    >
      <Text
        size={12}
        weight="bold"
        numberOfLines={1}
        style={{ color: "#c3c8ff" }}
      >
        ⇄ {people.length ? "On Discord" : "Paired with Discord"} · #
        {discord.channelName}
      </Text>
      {people.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row" }}>
            {people.slice(0, 4).map((p, i) =>
              p.avatar ? (
                <Image
                  key={i}
                  source={{ uri: `${SERVER_URL}/bridge/avatars/${p.avatar}` }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    marginLeft: i ? -7 : 0,
                    borderWidth: 2,
                    borderColor: "#232046",
                  }}
                />
              ) : (
                <View
                  key={i}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    marginLeft: i ? -7 : 0,
                    backgroundColor: "#5865f2",
                    borderWidth: 2,
                    borderColor: "#232046",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text size={10} weight="bold" style={{ color: "#fff" }}>
                    {(p.name.trim()[0] ?? "?").toUpperCase()}
                  </Text>
                </View>
              ),
            )}
          </View>
          <Text
            size={13}
            numberOfLines={1}
            style={{ flex: 1, color: "#e3e5ff" }}
          >
            {namesLine(people.map((p) => p.name))}
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(discord.url)}
        hitSlop={10}
        style={{
          alignSelf: "flex-start",
          minHeight: 28,
          justifyContent: "center",
        }}
      >
        <Text size={13} weight="bold" style={{ color: "#b9c0ff" }}>
          Open in Discord
        </Text>
      </Pressable>
    </View>
  );
}
