import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bdvPlugin } from '../index';
import { userNavRegistry } from '@/plugins/userNavRegistry';

/**
 * The plugin's contract with the host app: it adds itself ONLY through the
 * seams core already exposes, and removes itself cleanly on deactivate.
 */
describe('bdvPlugin', () => {
  beforeEach(() => {
    userNavRegistry.unregister('bdv');
    bdvPlugin.deactivate?.();
  });

  it('is a named export carrying install()', () => {
    // fe-user's plugin loader falls back to the first named export with
    // .install — a default-only export would silently fail to load.
    expect(typeof bdvPlugin.install).toBe('function');
    expect(bdvPlugin.name).toBe('bdv');
  });

  it('registers both routes on install', () => {
    const sdk = { addTranslations: vi.fn(), addRoute: vi.fn() } as any;
    bdvPlugin.install!(sdk);
    const paths = sdk.addRoute.mock.calls.map((call: any[]) => call[0].path);
    expect(paths).toContain('/dashboard/bdv');
    expect(paths).toContain('/dashboard/bdv/:matchId');
  });

  it('guards both routes behind auth', () => {
    const sdk = { addTranslations: vi.fn(), addRoute: vi.fn() } as any;
    bdvPlugin.install!(sdk);
    sdk.addRoute.mock.calls.forEach((call: any[]) => {
      expect(call[0].meta?.requiresAuth).toBe(true);
    });
  });

  it('registers English translations', () => {
    const sdk = { addTranslations: vi.fn(), addRoute: vi.fn() } as any;
    bdvPlugin.install!(sdk);
    expect(sdk.addTranslations).toHaveBeenCalledWith('en', expect.any(Object));
  });

  it('adds exactly one burger-menu item on activate', () => {
    bdvPlugin.activate?.();
    const items = userNavRegistry.getSidebarItems().filter((i) => i.pluginName === 'bdv');
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe('/dashboard/bdv');
    expect(items[0].labelKey).toBe('bdv.nav.play');
    expect(items[0].testId).toBe('nav-bdv');
  });

  it('removes its nav item on deactivate', () => {
    bdvPlugin.activate?.();
    bdvPlugin.deactivate?.();
    const items = userNavRegistry.getSidebarItems().filter((i) => i.pluginName === 'bdv');
    expect(items).toHaveLength(0);
  });
});
