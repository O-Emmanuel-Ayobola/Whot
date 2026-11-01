import { getStore } from "@netlify/blobs";
import type { RoomDirectoryDocument, RoomDocument, RoomStore, Versioned } from "./room";
import { roomKey } from "./room";

export function createNetlifyRoomStore(): RoomStore {
  const store = getStore("whot-rooms");

  const directoryKey = "directory:rooms";

  return {
    async get(key: string): Promise<Versioned<RoomDocument> | null> {
      const result = await store.getWithMetadata(key, { consistency: "strong", type: "json" });
      if (!result) return null;
      return { data: result.data as RoomDocument, etag: result.etag ?? "" };
    },
    async create(key: string, value: RoomDocument) {
      const result = await store.setJSON(key, value, { onlyIfNew: true });
      return { modified: result.modified, etag: result.etag ?? "" };
    },
    async compareAndSet(key: string, value: RoomDocument, etag: string) {
      const result = await store.setJSON(key, value, { onlyIfMatch: etag });
      return { modified: result.modified, etag: result.etag ?? "" };
    },
    async list(prefix: string) {
      const result = await store.list({ prefix });
      return result.blobs.map((blob) => blob.key);
    },
    async delete(key: string) {
      await store.delete(key);
    },
    async getDirectory(): Promise<Versioned<RoomDirectoryDocument> | null> {
      const result = await store.getWithMetadata(directoryKey, { consistency: "strong", type: "json" });
      if (!result) return null;
      return { data: result.data as RoomDirectoryDocument, etag: result.etag ?? "" };
    },
    async createDirectory(value: RoomDirectoryDocument) {
      const result = await store.setJSON(directoryKey, value, { onlyIfNew: true });
      return { modified: result.modified, etag: result.etag ?? "" };
    },
    async compareAndSetDirectory(value: RoomDirectoryDocument, etag: string) {
      const result = await store.setJSON(directoryKey, value, { onlyIfMatch: etag });
      return { modified: result.modified, etag: result.etag ?? "" };
    },
  };
}

export { roomKey };
