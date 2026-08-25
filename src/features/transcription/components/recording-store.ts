"use client";

// -------------------------------------------------------------------
// Recordings held on the device until they are safely uploaded.
//
// WHY THIS EXISTS. A meeting cannot be recorded twice. Until this, a
// recording lived only in a JavaScript array: an upload that failed, a
// crashed tab, a closed laptop or a stray refresh and an hour of somebody's
// meeting was gone with nothing to show for it. That is the one failure in
// this feature with no recovery, so it gets a real answer rather than a
// warning dialog.
//
// Chunks are written to IndexedDB AS THEY ARRIVE, roughly every ten
// seconds, so what survives a crash is everything up to the last chunk
// rather than nothing. The store is only ever emptied when the upload has
// been confirmed by the server.
//
// WHY INDEXEDDB. It is the only browser store that takes Blobs. localStorage
// is strings, capped around 5 MB, and an hour of Opus is tens of megabytes -
// base64-encoding a recording into it would fail on the size and cost a
// third more space for the privilege.
//
// WHY CHUNKS ARE THEIR OWN RECORDS. Appending to an array in a single record
// means reading and rewriting the whole growing recording every ten seconds:
// an hour of audio would be rewritten 360 times, and the last rewrites would
// each move tens of megabytes. One record per chunk is a constant-size write
// whatever the length of the meeting.
//
// This is per-browser and per-device. It is a safety net under an upload,
// not storage - the moment the upload succeeds the local copy goes.
// -------------------------------------------------------------------

const DB_NAME = "transcription-recordings";
const DB_VERSION = 1;

const RECORDINGS = "recordings";
const CHUNKS = "chunks";

export type PendingRecording = {
  id: string;
  /** What the person called it, or the default date-stamped name. */
  title: string;
  /** The extension the recorder chose, so the file is saved as what it is. */
  extension: string;
  mimeType: string;
  durationSeconds: number;
  /** Epoch milliseconds. Used to show how old a recovered recording is. */
  createdAt: number;
  /** False while recording is still in progress - see the note on recovery. */
  complete: boolean;
  /** Running total, so the UI can show a size without loading the blobs. */
  byteSize: number;
};

// -------------------------------------------------------------------
// IndexedDB is a callback API from before promises. This is the whole of
// the wrapper - one function to open, one to await a request.
// -------------------------------------------------------------------
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;

  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RECORDINGS)) {
        db.createObjectStore(RECORDINGS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(CHUNKS)) {
        // Keyed by recording and sequence, so chunks come back in the order
        // they were captured. Order is not cosmetic here: the first chunk
        // carries the container header, and a file assembled out of order
        // will not play or transcribe.
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ["recordingId", "seq"] });
        chunks.createIndex("recordingId", "recordingId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return database;
}

// -------------------------------------------------------------------
// Whether this browser can hold a recording at all.
//
// Private browsing in some browsers refuses IndexedDB outright. Recording
// still works there - the blob is held in memory as before - so this is a
// reason to warn, not to block.
// -------------------------------------------------------------------
export function isRecordingStoreAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

export async function beginRecording(recording: Omit<PendingRecording, "complete" | "byteSize">): Promise<void> {
  const db = await openDatabase();

  const transaction = db.transaction(RECORDINGS, "readwrite");

  await promisify(
    transaction.objectStore(RECORDINGS).put({ ...recording, complete: false, byteSize: 0 } satisfies PendingRecording),
  );
}

// -------------------------------------------------------------------
// Store one chunk as it arrives, and keep the running size up to date.
//
// Both writes share a transaction so a chunk cannot be recorded without the
// size that describes it.
// -------------------------------------------------------------------
export async function appendChunk(recordingId: string, seq: number, blob: Blob): Promise<void> {
  const db = await openDatabase();

  const transaction = db.transaction([CHUNKS, RECORDINGS], "readwrite");

  await promisify(transaction.objectStore(CHUNKS).put({ recordingId, seq, blob }));

  const store = transaction.objectStore(RECORDINGS);
  const existing = (await promisify(store.get(recordingId))) as PendingRecording | undefined;

  if (existing) {
    await promisify(store.put({ ...existing, byteSize: existing.byteSize + blob.size }));
  }
}

// -------------------------------------------------------------------
// Mark a recording finished, so recovery can tell a complete one from a
// tab that died mid-meeting.
//
// BOTH are offered back to the person, which is the point of recording the
// difference rather than discarding the incomplete one: a meeting cut short
// by a crash is still most of a meeting, and MediaRecorder writes each chunk
// as a self-contained cluster, so the partial file generally plays and
// transcribes. It is simply described honestly when it is offered.
// -------------------------------------------------------------------
export async function completeRecording(recordingId: string, durationSeconds: number): Promise<void> {
  const db = await openDatabase();

  const transaction = db.transaction(RECORDINGS, "readwrite");
  const store = transaction.objectStore(RECORDINGS);

  const existing = (await promisify(store.get(recordingId))) as PendingRecording | undefined;

  if (existing) {
    await promisify(store.put({ ...existing, complete: true, durationSeconds }));
  }
}

// -------------------------------------------------------------------
// Everything still held on this device, newest first.
// -------------------------------------------------------------------
export async function listPendingRecordings(): Promise<PendingRecording[]> {
  const db = await openDatabase();

  const transaction = db.transaction(RECORDINGS, "readonly");

  const all = (await promisify(transaction.objectStore(RECORDINGS).getAll())) as PendingRecording[];

  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// -------------------------------------------------------------------
// Reassemble one recording into the file it was going to be.
//
// Sorted by sequence explicitly rather than trusting the order the records
// come back in - see the note on the key above.
// -------------------------------------------------------------------
export async function assembleRecording(recording: PendingRecording): Promise<Blob | null> {
  const db = await openDatabase();

  const transaction = db.transaction(CHUNKS, "readonly");

  const records = (await promisify(
    transaction.objectStore(CHUNKS).index("recordingId").getAll(recording.id),
  )) as { recordingId: string; seq: number; blob: Blob }[];

  if (records.length === 0) return null;

  const ordered = records.sort((a, b) => a.seq - b.seq).map((record) => record.blob);

  return new Blob(ordered, { type: recording.mimeType });
}

// -------------------------------------------------------------------
// Drop a recording and its chunks.
//
// Called ONLY once the server has confirmed the upload, or when somebody
// deliberately discards one. Never on an upload failure - that is exactly
// the case this store exists for.
// -------------------------------------------------------------------
export async function discardRecording(recordingId: string): Promise<void> {
  const db = await openDatabase();

  const transaction = db.transaction([CHUNKS, RECORDINGS], "readwrite");

  const keys = (await promisify(
    transaction.objectStore(CHUNKS).index("recordingId").getAllKeys(recordingId),
  )) as IDBValidKey[];

  const chunks = transaction.objectStore(CHUNKS);

  for (const key of keys) {
    await promisify(chunks.delete(key));
  }

  await promisify(transaction.objectStore(RECORDINGS).delete(recordingId));
}
