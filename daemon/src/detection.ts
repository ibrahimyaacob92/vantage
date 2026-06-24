export interface DevInfo { running: boolean; port: number | null; pid: number | null; managed: boolean; }
export interface BrowserInfo { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number } | null; }

const NO_DEV: DevInfo = { running: false, port: null, pid: null, managed: false };
const NO_BROWSER: BrowserInfo = { tabOpen: false, ref: null };

export class DetectionStore {
  private dev = new Map<string, DevInfo>();
  private browser = new Map<string, BrowserInfo>();

  setDev(id: string, info: DevInfo) { this.dev.set(id, info); }
  getDev(id: string): DevInfo { return this.dev.get(id) ?? { ...NO_DEV }; }
  setBrowser(id: string, info: BrowserInfo) { this.browser.set(id, info); }
  getBrowser(id: string): BrowserInfo { return this.browser.get(id) ?? { ...NO_BROWSER }; }

  managedDevIds(): string[] {
    const out: string[] = [];
    for (const [id, info] of this.dev) if (info.managed) out.push(id);
    return out;
  }

  clearDevExcept(ids: string[]) {
    const keep = new Set(ids);
    for (const id of [...this.dev.keys()]) if (!keep.has(id)) this.dev.delete(id);
  }
  clearBrowserExcept(ids: string[]) {
    const keep = new Set(ids);
    for (const id of [...this.browser.keys()]) if (!keep.has(id)) this.browser.delete(id);
  }
}
