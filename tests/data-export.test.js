import assert from "node:assert/strict";
import test from "node:test";
import { collectUserExport, createZip } from "../worker/data-export-api.js";

const TABLES = ["day_tasks", "important_dates", "footprints", "footprint_photos", "personal_notes"];

function mockDb(records) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let bound = [];
      return {
        bind(...values) { bound = values; return this; },
        async all() {
          calls.push({ sql, bound });
          if (sql.includes("sqlite_master")) return { results: TABLES.map((name) => ({ name })) };
          const table = TABLES.find((name) => sql.includes(`FROM ${name}`));
          if (!table) return { results: [] };
          return { results: (records[table] || []).filter((row) => row.user_id === bound[0]) };
        },
      };
    },
  };
}

function fixtures() {
  return {
    day_tasks: [
      { id: "task-a", user_id: "alice", title: "Alice task", task_date: "2026-10-27", is_completed: 0, created_at: "2026-10-27", updated_at: "2026-10-27" },
      { id: "task-b", user_id: "bob", title: "Bob task", task_date: "2026-10-28", is_completed: 1, created_at: "2026-10-27", updated_at: "2026-10-27" },
    ],
    important_dates: [],
    footprints: [
      { id: "place-a", user_id: "alice", name: "Paris", status: "visited", longitude: 2.35, latitude: 48.85, created_at: "2026-10-27", updated_at: "2026-10-27" },
      { id: "place-b", user_id: "bob", name: "Tokyo", status: "wish", longitude: 139.7, latitude: 35.6, created_at: "2026-10-27", updated_at: "2026-10-27" },
    ],
    footprint_photos: [
      { id: "photo-a", footprint_id: "place-a", user_id: "alice", content_type: "image/png", byte_size: 4, image_data: new Uint8Array([1, 2, 3, 4]), position: 0, is_cover: 1, caption: "cover", created_at: "2026-10-27", updated_at: "2026-10-27" },
      { id: "photo-a2", footprint_id: "place-a", user_id: "alice", content_type: "image/webp", byte_size: 2, image_data: new Uint8Array([8, 9]), position: 1, is_cover: 0, caption: "memory", created_at: "2026-10-27", updated_at: "2026-10-27" },
      { id: "photo-b", footprint_id: "place-b", user_id: "bob", content_type: "image/jpeg", byte_size: 3, image_data: new Uint8Array([5, 6, 7]), position: 0, is_cover: 1, created_at: "2026-10-27", updated_at: "2026-10-27" },
    ],
    personal_notes: [
      { id: "note-a", user_id: "alice", title: "private a", content: "A", created_at: "2026-10-27" },
      { id: "note-b", user_id: "bob", title: "private b", content: "B", created_at: "2026-10-27" },
    ],
  };
}

test("data export strictly isolates two accounts", async () => {
  const db = mockDb(fixtures());
  const alice = await collectUserExport(db, { id: "alice", email: "alice@example.test", displayName: "Alice" }, { includePhotoBytes: true });
  const bob = await collectUserExport(db, { id: "bob", email: "bob@example.test", displayName: "Bob" }, { includePhotoBytes: true });

  assert.deepEqual(alice.data.data.myDays.map((item) => item.id), ["task-a"]);
  assert.deepEqual(alice.data.data.footprints.map((item) => item.id), ["place-a"]);
  assert.deepEqual(alice.photos.map((item) => item.id), ["photo-a", "photo-a2"]);
  assert.deepEqual(alice.data.data.footprints[0].photos.map((item) => item.id), ["photo-a", "photo-a2"]);
  assert.equal(alice.data.data.footprints[0].photo.id, "photo-a");
  assert.equal(JSON.stringify(alice.data).includes("Bob task"), false);
  assert.equal(JSON.stringify(alice.data).includes("private b"), false);

  assert.deepEqual(bob.data.data.myDays.map((item) => item.id), ["task-b"]);
  assert.deepEqual(bob.data.data.footprints.map((item) => item.id), ["place-b"]);
  assert.deepEqual(bob.photos.map((item) => item.id), ["photo-b"]);
  assert.equal(JSON.stringify(bob.data).includes("Alice task"), false);
  assert.equal(JSON.stringify(bob.data).includes("private a"), false);

  const privateQueries = db.calls.filter((call) => !call.sql.includes("sqlite_master"));
  assert.ok(privateQueries.length > 0);
  assert.ok(privateQueries.every((call) => call.sql.includes("WHERE user_id = ?") && call.bound.length === 1));
});

test("JSON export omits photo bytes and authentication secrets", async () => {
  const db = mockDb(fixtures());
  const { data, photos } = await collectUserExport(db, { id: "alice", email: "alice@example.test", displayName: "Alice" });
  const text = JSON.stringify(data);
  assert.equal(photos.length, 0);
  assert.equal(text.includes("image_data"), false);
  assert.equal(text.includes("password_hash"), false);
  assert.equal(text.includes("token_hash"), false);
  assert.equal(text.includes("csrf"), false);
  assert.equal(data.version, 1);
  assert.equal(data.format, "xiaocolour-backup");
});

test("ZIP writer creates a standards-shaped archive with UTF-8 filenames", () => {
  const zip = createZip([
    { name: "XiaoColour-Backup/manifest.json", bytes: new TextEncoder().encode("{\"version\":1}") },
    { name: "XiaoColour-Backup/photos/footprints/巴黎.png", bytes: new Uint8Array([137, 80, 78, 71]) },
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 14, true), 2);
  assert.ok(new TextDecoder().decode(zip).includes("manifest.json"));
  assert.ok(new TextDecoder().decode(zip).includes("巴黎.png"));
});
