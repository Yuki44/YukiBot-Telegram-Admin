import { describe, it, expect } from "vitest";
import { detectMessageType } from "../../src/bot/helpers/detectMessageType";
import { MessageType, VALID_CONTENT_TYPES } from "../../src/types";
import type { Context } from "grammy";

type Msg = NonNullable<Context["message"]>;
const msg = (fields: Record<string, unknown>): Msg => fields as unknown as Msg;

describe("detectMessageType", () => {
  it("detects the new selectable types", () => {
    expect(detectMessageType(msg({ animation: {}, document: {} }))).toBe(MessageType.Animation);
    expect(detectMessageType(msg({ poll: {} }))).toBe(MessageType.Poll);
    expect(detectMessageType(msg({ video_note: {} }))).toBe(MessageType.VideoNote);
    expect(detectMessageType(msg({ contact: {} }))).toBe(MessageType.Contact);
    expect(detectMessageType(msg({ location: {} }))).toBe(MessageType.Location);
    expect(detectMessageType(msg({ venue: {}, location: {} }))).toBe(MessageType.Location);
  });

  it("keeps the original types working", () => {
    expect(detectMessageType(msg({ photo: [] }))).toBe(MessageType.Photo);
    expect(detectMessageType(msg({ video: {} }))).toBe(MessageType.Video);
    expect(detectMessageType(msg({ document: {} }))).toBe(MessageType.Document);
    expect(detectMessageType(msg({ text: "hola" }))).toBe(MessageType.Text);
  });

  it("falls back to other for unselectable content", () => {
    expect(detectMessageType(msg({ dice: {} }))).toBe(MessageType.Other);
  });

  it("never exposes other as a selectable rule type", () => {
    expect(VALID_CONTENT_TYPES).not.toContain(MessageType.Other);
    expect(VALID_CONTENT_TYPES).toHaveLength(12);
  });
});
