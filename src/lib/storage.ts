'use client';

// File System Access API を使ったストレージ層。
// - 未接続時 / 未対応ブラウザ: localStorage のみ
// - フォルダ接続時: localStorage(キャッシュ) + ユーザー指定フォルダの JSON ファイルに書き込み、読み込みはフォルダ優先
// - フォルダハンドルは IndexedDB に永続化し、再訪問時はワンクリックで再接続

// --- File System Access API の型宣言 (TS標準に未収録のため) ---
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  }
}

export type StorageMode = 'local' | 'fs';

export interface StorageStatus {
  supported: boolean;        // このブラウザが FSAPI に対応しているか
  mode: StorageMode;         // 現在の保存先
  needsPermission: boolean;  // 保存済みフォルダがあるが許可の再取得が必要
  dirName: string | null;    // 接続中(または保存済み)のフォルダ名
}

// アプリで使用する全キー (フォルダ⇔localStorage 間の移行対象)
export const STORAGE_KEYS = [
  'rss-feeds',
  'rss-folders',
  'rss-theme',
  'rss-view-mode',
  'rss-bookmarks',
  'rss-bookmark-folders',
  'rss-read-links',
] as const;

const IDB_NAME = 'rss-matome-storage';
const IDB_STORE = 'handles';
const IDB_KEY = 'data-dir';

// --- IndexedDB: ディレクトリハンドルの永続化 ---

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSetHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    const req = handle ? store.put(handle, IDB_KEY) : store.delete(IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- 内部状態 ---

let dirHandle: FileSystemDirectoryHandle | null = null;
let savedHandle: FileSystemDirectoryHandle | null = null; // 許可待ちのハンドル
let listeners: Array<(s: StorageStatus) => void> = [];

// キーごとの書き込みキュー (last-write-wins で直列化)
const pendingWrites = new Map<string, string>();
const writeChains = new Map<string, Promise<void>>();

export function isFsApiSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function getStatus(): StorageStatus {
  return {
    supported: isFsApiSupported(),
    mode: dirHandle ? 'fs' : 'local',
    needsPermission: !dirHandle && savedHandle !== null,
    dirName: dirHandle?.name ?? savedHandle?.name ?? null,
  };
}

export function subscribeStatus(fn: (s: StorageStatus) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notify() {
  const s = getStatus();
  listeners.forEach(fn => fn(s));
}

// --- ファイル読み書き ---

async function readFileFromDir(key: string): Promise<string | null> {
  if (!dirHandle) return null;
  try {
    const fileHandle = await dirHandle.getFileHandle(`${key}.json`);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null; // ファイル未作成
  }
}

async function writeFileToDir(key: string, value: string): Promise<void> {
  if (!dirHandle) return;
  const fileHandle = await dirHandle.getFileHandle(`${key}.json`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(value);
  await writable.close();
}

function queueWrite(key: string, value: string) {
  pendingWrites.set(key, value);
  if (writeChains.has(key)) return; // 既に書き込み中。最新値は pendingWrites から拾われる
  const chain = (async () => {
    while (pendingWrites.has(key)) {
      const v = pendingWrites.get(key)!;
      pendingWrites.delete(key);
      try {
        await writeFileToDir(key, v);
      } catch (e) {
        console.error(`Failed to write ${key} to folder:`, e);
      }
    }
    writeChains.delete(key);
  })();
  writeChains.set(key, chain);
}

// --- 公開 API ---

// 起動時に呼ぶ。保存済みハンドルがあれば許可状態を確認して自動接続を試みる。
export async function initStorage(): Promise<StorageStatus> {
  if (!isFsApiSupported()) return getStatus();
  try {
    const handle = await idbGetHandle();
    if (handle) {
      const perm = await handle.queryPermission?.({ mode: 'readwrite' });
      if (perm === 'granted') {
        dirHandle = handle;
      } else {
        savedHandle = handle; // ユーザー操作で requestPermission する必要あり
      }
    }
  } catch (e) {
    console.error('initStorage failed:', e);
  }
  notify();
  return getStatus();
}

// 保存済みフォルダへの再接続 (ユーザー操作内で呼ぶこと)
export async function reconnect(): Promise<boolean> {
  if (!savedHandle) return false;
  try {
    const perm = await savedHandle.requestPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') {
      dirHandle = savedHandle;
      savedHandle = null;
      notify();
      return true;
    }
  } catch (e) {
    console.error('reconnect failed:', e);
  }
  return false;
}

// フォルダ選択 (ユーザー操作内で呼ぶこと)。
// 選択したフォルダにデータがあればそれを優先、なければ現在の localStorage の内容を書き出す。
export async function chooseDirectory(): Promise<StorageStatus | null> {
  if (!isFsApiSupported()) return null;
  try {
    const handle = await window.showDirectoryPicker!({ id: 'rss-matome-data', mode: 'readwrite' });
    dirHandle = handle;
    savedHandle = null;
    await idbSetHandle(handle);

    // 既存データの移行: フォルダ側にファイルがあるキーはフォルダを正とし localStorage に反映、
    // ないキーは localStorage の値をフォルダへ書き出す
    for (const key of STORAGE_KEYS) {
      const fromDir = await readFileFromDir(key);
      if (fromDir !== null) {
        localStorage.setItem(key, fromDir);
      } else {
        const fromLocal = localStorage.getItem(key);
        if (fromLocal !== null) await writeFileToDir(key, fromLocal);
      }
    }
    notify();
    return getStatus();
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null; // ユーザーがキャンセル
    console.error('chooseDirectory failed:', e);
    return null;
  }
}

// フォルダ接続を解除して localStorage のみに戻す (フォルダ内のファイルは残す)
export async function disconnect(): Promise<void> {
  dirHandle = null;
  savedHandle = null;
  try {
    await idbSetHandle(null);
  } catch (e) {
    console.error('disconnect failed:', e);
  }
  notify();
}

// 読み込み: フォルダ接続時はフォルダ優先、なければ localStorage
export async function getItem(key: string): Promise<string | null> {
  if (dirHandle) {
    const v = await readFileFromDir(key);
    if (v !== null) return v;
  }
  return localStorage.getItem(key);
}

// 書き込み: localStorage に即時保存 + 接続時はフォルダへ非同期書き込み
export function setItem(key: string, value: string): void {
  localStorage.setItem(key, value);
  if (dirHandle) queueWrite(key, value);
}
