/**
 * Narrow lazy-loading boundary for the call SDK. Keep these as static named
 * re-exports: importing the complete SDK namespace dynamically retains unused
 * public APIs in the browser bundle. Room still includes all of its internal
 * media, reconnection, encryption and compatibility implementation unchanged.
 */
export { Room, RoomEvent, Track, VideoPresets } from "livekit-client";
