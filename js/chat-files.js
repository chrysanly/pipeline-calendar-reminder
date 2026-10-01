// Chat attachments in Firestore (no Firebase Storage on the free Spark plan):
// chat/{room}/files/{fileId} holds who sent what, and chunks/{n} hold the
// bytes as base64 pieces. Images are shrunk first. loadChatFile turns the
// pieces back into a blob: URL, once per file. Pure rules: js/chat.js.

import {
  CHAT_ROOM, attachmentKind, attachmentRecord, validateAttachment, splitChunks, shrinkSize
} from './chat.js';
import { newRecordId } from './store.js';

const filesRef = (db, room = CHAT_ROOM) => db.collection('chat').doc(room).collection('files');

// fileId → Promise<blob: URL>, so a file is downloaded once per visit.
const loadedFiles = new Map();

/** A big photo, shrunk to 1600 px on its longest side (GIFs and small ones stay as they are). */
export async function shrinkImage(file) {
  if (attachmentKind(file.type) !== 'image' || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // a format this browser can't draw (HEIC…): send it as it is
  }
  const size = shrinkSize(bitmap.width, bitmap.height);
  if (!size) return file;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, size.width, size.height);
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : '.png');
  return new File([blob], name, { type: blob.type });
}

export const toBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
  reader.readAsDataURL(blob);
});

/**
 * Store `file` for a message. onProgress(done, total) after each piece.
 * @returns {Promise<object>} the message's attachment (attachmentRecord)
 * @throws when the file is empty or too big
 */
export async function uploadChatFile(db, user, file, { onProgress = () => {} } = {}) {
  const ready = await shrinkImage(file);
  const problem = validateAttachment(ready);
  if (problem) throw new Error(problem);
  const pieces = splitChunks(await toBase64(ready));
  const fileId = newRecordId();
  const ref = filesRef(db).doc(fileId);
  const meta = attachmentRecord(fileId, ready, pieces.length);
  await ref.set({ uid: user.uid, name: meta.name, type: meta.type, size: meta.size, chunks: meta.chunks, at: new Date().toISOString() });
  onProgress(0, pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    await ref.collection('chunks').doc(String(i).padStart(4, '0')).set({ uid: user.uid, data: pieces[i] });
    onProgress(i + 1, pieces.length);
  }
  // The sender sees it at once, without reading it back.
  loadedFiles.set(fileId, Promise.resolve(URL.createObjectURL(ready)));
  return meta;
}

/** The file of an attachment as a blob: URL (downloaded once). */
export function loadChatFile(db, attachment) {
  if (!loadedFiles.has(attachment.id)) {
    const loading = filesRef(db).doc(attachment.id).collection('chunks').get().then(snap => {
      const pieces = snap.docs.slice().sort((a, b) => a.id.localeCompare(b.id)).map(doc => doc.data().data || '');
      if (pieces.length < attachment.chunks) throw new Error('This file is still being sent, or part of it is missing.');
      const binary = atob(pieces.join(''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: attachment.type || 'application/octet-stream' }));
    });
    // A failed download can be tried again.
    loading.catch(() => loadedFiles.delete(attachment.id));
    loadedFiles.set(attachment.id, loading);
  }
  return loadedFiles.get(attachment.id);
}
