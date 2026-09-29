// Every feature module, in nav order. Each is register(app): it may add a
// page with app.views.register({...}), listen with app.hooks.on(...) and keep
// its data in app.store (see app.js → createApp). Add one import per feature.

import { registerBusinessSettings } from './views/settings.js';
import { registerKanban } from './views/kanban.js';
import { registerClientProfile } from './views/client.js';
import { registerAiPanel } from './views/ai-panel.js';
import { registerStatusAlerts } from './notify.js';
import { registerChat } from './views/chat.js';

export const FEATURES = [registerBusinessSettings, registerKanban, registerClientProfile, registerAiPanel, registerStatusAlerts, registerChat];
