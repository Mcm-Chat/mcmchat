import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_RECOVERIES,
  hasLiveAudio,
  planMediaRecovery,
} from "../media-recovery";

const track = (readyState: string, muted = false) =>
  ({ readyState, muted }) as unknown as MediaStreamTrack;
const stream = (tracks: MediaStreamTrack[]) =>
  ({ getAudioTracks: () => tracks }) as unknown as MediaStream;

describe("media-recovery", () => {
  it("ronde pertama selalu mencoba mikrofon lagi", () => {
    expect(planMediaRecovery(1, "audio").action).toBe("retry-mic");
    expect(planMediaRecovery(1, "video").action).toBe("retry-mic");
  });

  it("panggilan video turun ke suara saja di ronde kedua", () => {
    expect(planMediaRecovery(2, "video").action).toBe("downgrade-audio");
    expect(planMediaRecovery(2, "audio").action).toBe("retry-mic");
  });

  it("menyerah setelah jatah pemulihan habis", () => {
    const plan = planMediaRecovery(MAX_MEDIA_RECOVERIES + 1, "audio");
    expect(plan.action).toBe("give-up");
    expect(plan.message).toMatch(/mikrofon/i);
  });

  it("hanya track hidup dan tidak muted yang dianggap siap", () => {
    expect(hasLiveAudio(null)).toBe(false);
    expect(hasLiveAudio(stream([track("ended")]))).toBe(false);
    expect(hasLiveAudio(stream([track("live", true)]))).toBe(false);
    expect(hasLiveAudio(stream([track("live")]))).toBe(true);
  });
});
