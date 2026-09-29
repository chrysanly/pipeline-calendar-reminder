// Who is in the chat: chat/{room}/presence/{uid} = {uid, name, email,
// lastSeen, typingAt}. While the app is open it writes lastSeen every 45 s
// (and when the tab comes back); typing writes typingAt at most every 3 s.
// Others count as online or typing from those times (js/chat.js presenceList).

import { CHAT_ROOM, chatUserName } from './chat.js';

export const PRESENCE_BEAT_MS = 45 * 1000;
export const TYPING_THROTTLE_MS = 3000;

const presenceRef = (db, room = CHAT_ROOM) => db.collection('chat').doc(room).collection('presence');

/**
 * Start for a signed-in user: heartbeat plus a live list of everyone.
 * onChange(docs) gets the presence docs; onError(err) when the rules refuse.
 * @returns {{typing: Function, stop: Function}}
 */
export function startPresence(db, user, { onChange, onError = () => {} }) {
  const mine = presenceRef(db).doc(user.uid);
  const base = { uid: user.uid, name: chatUserName(user), email: String(user.email || '').toLowerCase() };
  let typingAt = '';
  let lastTyping = 0;
  const write = extra => mine.set({ ...base, lastSeen: new Date().toISOString(), typingAt, ...extra }).catch(onError);

  write();
  const beat = setInterval(() => write(), PRESENCE_BEAT_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') write(); };
  // Leaving: look offline at once (best effort; otherwise the time runs out).
  const onLeave = () => mine.set({ ...base, lastSeen: new Date(Date.now() - 10 * 60 * 1000).toISOString(), typingAt: '' }).catch(() => {});
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onLeave);
  const unsubscribe = presenceRef(db).onSnapshot(snap => onChange(snap.docs.map(doc => doc.data())), onError);
  // Re-draw "online / last seen" as time passes, even when nobody writes.
  const tick = setInterval(() => onChange(null), 15 * 1000);

  return {
    /** Call on every keystroke; writes at most every 3 s. `false` when the message is sent. */
    typing(active = true) {
      const now = Date.now();
      if (active && now - lastTyping < TYPING_THROTTLE_MS) return;
      lastTyping = active ? now : 0;
      typingAt = active ? new Date(now).toISOString() : '';
      write();
    },
    stop() {
      clearInterval(beat);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeave);
      unsubscribe();
      onLeave();
    }
  };
}
