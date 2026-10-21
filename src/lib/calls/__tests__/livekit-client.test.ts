import { describe, expect, it } from "vitest";
import * as sdk from "livekit-client";
import * as lazySdk from "../livekit-client";

describe("lazy LiveKit SDK boundary", () => {
  it("exposes only the SDK APIs consumed by calls and diagnostics", () => {
    expect(Object.keys(lazySdk).sort()).toEqual(["Room", "RoomEvent", "Track", "VideoPresets"]);
  });

  it("re-exports original implementations without media or encryption stubs", () => {
    expect(lazySdk.Room).toBe(sdk.Room);
    expect(lazySdk.RoomEvent).toBe(sdk.RoomEvent);
    expect(lazySdk.Track).toBe(sdk.Track);
    expect(lazySdk.VideoPresets).toBe(sdk.VideoPresets);
  });

  it("preserves call quality presets and media track kinds", () => {
    expect(lazySdk.VideoPresets.h360.resolution).toEqual(sdk.VideoPresets.h360.resolution);
    expect(lazySdk.VideoPresets.h180.encoding).toEqual(sdk.VideoPresets.h180.encoding);
    expect(lazySdk.Track.Kind.Audio).toBe("audio");
    expect(lazySdk.Track.Kind.Video).toBe("video");
  });
});
