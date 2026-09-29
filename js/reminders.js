// Reminder scheduling. `dueReminders` is pure and unit-tested;
// `startReminderLoop` wires it to notifications.

/** Combine an event's date + time into a local Date. Missing time = 09:00. */
export function eventDateTime(evt) {
  const [y, m, d] = (evt.date || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (evt.time || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

/**
 * Events whose reminder moment has arrived and that have not been notified yet
 * (or cleared from the calendar).
 * Events more than a day past their start are skipped (stale after reload).
 */
export function dueReminders(events, now = new Date()) {
  const nowMs = now.getTime();
  const staleMs = 24 * 60 * 60 * 1000;
  return events.filter(evt => {
    // Cleared from the calendar: no popup either.
    if (evt.notified || evt.calendarHidden) return false;
    const when = eventDateTime(evt);
    if (!when) return false;
    const remindAt = when.getTime() - (Number(evt.reminderMinutesBefore) || 0) * 60000;
    return remindAt <= nowMs && nowMs - when.getTime() <= staleMs;
  });
}

export function reminderMessage(evt) {
  const parts = [];
  if (evt.time) parts.push(evt.time);
  if (evt.clientName) parts.push(evt.clientName);
  const head = parts.join(' · ');
  return head ? `${head} — ${evt.notes || 'Reminder'}` : (evt.notes || 'Reminder');
}

/** Headline for the desktop popup and the in-app banner. */
export function popupTitle(evt) {
  return `Hey you have a ${evt.title}`;
}

export async function requestPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (err) {
    return 'denied';
  }
}

function notify(evt, onBanner, onOpen) {
  const title = popupTitle(evt);
  const body = reminderMessage(evt);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      // requireInteraction keeps it on screen until dismissed; the tag stops
      // two open tabs from stacking duplicates of the same reminder.
      const popup = new Notification(title, { body, requireInteraction: true, tag: evt.id });
      popup.onclick = () => {
        window.focus();
        onOpen(evt.id);
        if (popup.close) popup.close();
      };
    } catch (err) {
      // the in-app banner below still shows
    }
  }
  onBanner(evt, title, body);
}

/**
 * Poll for due reminders every `intervalMs`.
 * @returns {{stop: () => void, check: () => void}}
 */
export function startReminderLoop({ getEvents, markNotified, onBanner, onOpen = () => {}, intervalMs = 5000 }) {
  const check = () => {
    const due = dueReminders(getEvents(), new Date());
    for (const evt of due) {
      notify(evt, onBanner, onOpen);
      markNotified(evt.id);
    }
  };
  check();
  const handle = setInterval(check, intervalMs);
  return { stop: () => clearInterval(handle), check };
}
