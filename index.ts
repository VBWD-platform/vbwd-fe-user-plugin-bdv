import type { IPlugin, IPlatformSDK } from 'vbwd-view-component';
import { userNavRegistry } from '@/plugins/userNavRegistry';
import en from './locales/en.json';

/**
 * BizDevVibes (bdv) — the dice-market board game.
 *
 * A roll of {a, b} yields exactly three legal moves: a, b or a+b. The sum is
 * always FREE (fate); choosing a single die is a purchase priced by the server
 * from the game state, and the fee goes to the opponents rather than the bank.
 *
 * The user surface is one burger-menu item and a 70/30 match page. Every choice
 * is made by CLICKING — the chat pane and the board dispatch the same store
 * action, so the two surfaces can never drift.
 */
export const bdvPlugin: IPlugin = {
  name: 'bdv',
  version: '26.7.0',
  description:
    'BizDevVibes — dice-market board game. The sum is free; buying a single die is priced from the game state and the fee goes to your opponents.',
  _active: false,

  install(sdk: IPlatformSDK) {
    sdk.addTranslations('en', en);

    sdk.addRoute({
      path: '/dashboard/bdv',
      name: 'bdv-lobby',
      component: () => import('./src/views/BdvLobby.vue'),
      meta: { requiresAuth: true },
    });
    sdk.addRoute({
      path: '/dashboard/bdv/:matchId',
      name: 'bdv-match',
      component: () => import('./src/views/BdvMatch.vue'),
      meta: { requiresAuth: true },
    });
  },

  activate() {
    // The burger-menu item. Registered here (not in install) so disabling the
    // plugin removes it immediately.
    userNavRegistry.register({
      pluginName: 'bdv',
      to: '/dashboard/bdv',
      icon: 'grid',
      labelKey: 'bdv.nav.play',
      testId: 'nav-bdv',
    });
    this._active = true;
  },

  deactivate() {
    userNavRegistry.unregister('bdv');
    this._active = false;
  },
};

export default bdvPlugin;
