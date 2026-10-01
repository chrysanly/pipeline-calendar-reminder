// Who is in the chat: chat/{room}/presence/{uid} = {uid, name, email,
// lastSeen, typingAt}. While the tab is visible it writes lastSeen every 90 s
// (and when the tab comes back); typing writes typingAt at most every 3 s.
// Hidden tabs don't write, nor does anyone while the daily limit is reached
// (js/chat-quota.js counts each read and write). After a quota error everything stops (halt), so
// Firestore doesn't keep retrying against the used-up daily limit.
// Others count as online or typing from those times (js/chat.js presenceList).

import { CHAT_ROOM, chatUserName, isQuotaError, snapshotReads } from './chat.js';
import { addReads, addWrites, loadUsage, isExhausted } from './chat-quota.js';

export const PRESENCE_BEAT_MS = 90 * 1000;
export const TYPING_THROTTLE_MS = 3000;

const presenceRef = (db, room = CHAT_ROOM) => db.collection('chat').doc(room).collection('presence');

/**
 * Start for a signed-in user: heartbeat plus a live list of everyone.
 * onChange(docs) gets the presence docs; onError(err) when the rules refuse
 * or the quota is used up. `doc` and `win` default to the page (tests pass fakes).
 * @returns {{typing: Function, halt: Function, stop: Function}}
 */
export function startPresence(db, user, { onChange, onError = () => {}, doc = globalThis.document, win = globalThis.window }) {
  const document = doc;
  const window = win;
  const tabVisible = () => document.visibilityState !== 'hidden';
  const mine = presenceRef(db).doc(user.uid);
  const base = { uid: user.uid, name: chatUserName(user), email: String(user.email || '').toLowerCase() };
  let typingAt = '';
  let lastTyping = 0;
  let halted = false;
  let unsubscribe = () => {};

  const fail = err => {
    if (isQuotaError(err)) halt();
    onError(err);
  };
  const write = extra => {
    if (halted || !tabVisible() || isExhausted(loadUsage())) return;
    addWrites(1);
    mine.set({ ...base, lastSeen: new Date().toISOString(), typingAt, ...extra }).catch(fail);
  };

  write();
  const beat = setInterval(() => write(), PRESENCE_BEAT_MS);
  const onVisible = () => write();
  // Leaving: look offline at once (best effort; otherwise the time runs out).
  const onLeave = () => {
    if (halted || isExhausted(loadUsage())) return;
    addWrites(1);
    mine.set({ ...base, lastSeen: new Date(Date.now() - 10 * 60 * 1000).toISOString(), typingAt: '' }).catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onLeave);
  unsubscribe = presenceRef(db).onSnapshot(snap => {
    addReads(snapshotReads(snap));
    onChange(snap.docs.map(doc => doc.data()));
  }, fail);
  // Re-draw "online / last seen" as time passes, even when nobody writes.
  const tick = setInterval(() => onChange(null), 15 * 1000);

  /** Stop every timer and listener without writing again. */
  function halt() {
    if (halted) return;
    halted = true;
    clearInterval(beat);
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onLeave);
    unsubscribe();
  }

  return {
    /** Call on every keystroke; writes at most every 3 s. `false` when the message is sent. */
    typing(active = true) {
      const now = Date.now();
      if (active && now - lastTyping < TYPING_THROTTLE_MS) return;
      lastTyping = active ? now : 0;
      typingAt = active ? new Date(now).toISOString() : '';
      write();
    },
    halt,
    stop() {
      onLeave();
      halt();
    }
  };
}
