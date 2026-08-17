import { ChannelBroadcast } from "../models/ChannelBroadcast";
import { IChannelBroadcast, IBroadcastPost } from "../../types";
import { CANONICAL_KEYS, DEFAULT_BUTTON_TEXT, defaultPosts } from "../../bot/scheduler/broadcastDefaults";

type PostPatch = Partial<Pick<IBroadcastPost, "caption" | "url" | "enabled">>;
type ImageInput = IBroadcastPost["image"];

const CANONICAL = CANONICAL_KEYS as readonly string[];

/**
 * Force the doc to hold exactly the two canonical posts. Posts already keyed
 * canonically keep their values; any legacy (pre-key) posts have their url/caption/
 * image carried over onto the canonical posts in order, so uploaded images survive.
 */
function reconcilePosts(doc: IChannelBroadcast): void {
  const byKey = new Map(doc.posts.filter((p) => CANONICAL.includes(p.key)).map((p) => [p.key, p]));
  const legacy = doc.posts.filter((p) => !CANONICAL.includes(p.key));
  let li = 0;
  doc.posts = defaultPosts().map((def) => {
    const existing = byKey.get(def.key);
    if (existing) {
      existing.label = def.label;
      existing.hours = def.hours; // schedule is fixed in code
      return existing;
    }
    const carry = legacy[li++];
    if (carry) {
      if (carry.caption) def.caption = carry.caption;
      if (carry.url) def.url = carry.url;
      if (carry.image) def.image = carry.image;
    }
    return def;
  }) as IChannelBroadcast["posts"];
}

export const channelBroadcastRepository = {
  async listAll(): Promise<IChannelBroadcast[]> {
    return await ChannelBroadcast.find({}).sort({ channelName: 1 });
  },

  async findByChannelId(channelId: number): Promise<IChannelBroadcast | null> {
    return await ChannelBroadcast.findOne({ channelId });
  },

  /** Create (seeding the two posts) or reconcile the doc; optionally refresh the name. */
  async ensureInitialized(channelId: number, meta: { name?: string } = {}): Promise<IChannelBroadcast> {
    let doc = await ChannelBroadcast.findOne({ channelId });
    if (!doc) {
      doc = new ChannelBroadcast({ channelId, channelName: meta.name ?? "", posts: defaultPosts() });
    } else {
      reconcilePosts(doc);
      if (meta.name) doc.channelName = meta.name;
    }
    if (!doc.button) doc.button = { enabled: true, text: DEFAULT_BUTTON_TEXT };
    return await doc.save();
  },

  async setButton(
    channelId: number,
    button: { enabled: boolean; text: string }
  ): Promise<IChannelBroadcast | null> {
    return await ChannelBroadcast.findOneAndUpdate(
      { channelId },
      { $set: { button } },
      { returnDocument: "after" }
    );
  },

  async updatePost(channelId: number, index: number, patch: PostPatch): Promise<IChannelBroadcast | null> {
    const doc = await ChannelBroadcast.findOne({ channelId });
    if (!doc || !doc.posts[index]) return doc;
    Object.assign(doc.posts[index], patch);
    return await doc.save();
  },

  async setImage(channelId: number, index: number, image: ImageInput): Promise<IChannelBroadcast | null> {
    const doc = await ChannelBroadcast.findOne({ channelId });
    if (!doc || !doc.posts[index]) return doc;
    doc.posts[index].image = image;
    return await doc.save();
  },

  async markPostSent(channelId: number, key: string, slot: string, messageId?: number): Promise<void> {
    const doc = await ChannelBroadcast.findOne({ channelId });
    const post = doc?.posts.find((p) => p.key === key);
    if (!doc || !post) return;
    post.lastSentSlot = slot;
    post.retryAttempts = 0;
    if (typeof messageId === "number") post.lastMessageId = messageId;
    await doc.save();
  },

  async setPostMessageId(channelId: number, key: string, messageId: number): Promise<void> {
    const doc = await ChannelBroadcast.findOne({ channelId });
    const post = doc?.posts.find((p) => p.key === key);
    if (!doc || !post) return;
    post.lastMessageId = messageId;
    await doc.save();
  },

  async setPostRetry(channelId: number, key: string, attempts: number): Promise<void> {
    const doc = await ChannelBroadcast.findOne({ channelId });
    const post = doc?.posts.find((p) => p.key === key);
    if (!doc || !post) return;
    post.retryAttempts = attempts;
    await doc.save();
  },

  async setChannelMeta(
    channelId: number,
    meta: { channelName?: string; photoFileId?: string | null }
  ): Promise<void> {
    const $set: Record<string, unknown> = { photoCheckedAt: new Date() };
    if (typeof meta.channelName === "string") $set.channelName = meta.channelName;
    if (meta.photoFileId !== undefined) $set.photoFileId = meta.photoFileId;
    await ChannelBroadcast.updateOne({ channelId }, { $set });
  },
};

export { CANONICAL_KEYS };
