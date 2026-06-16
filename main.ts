import {
  ItemView,
  Keymap,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_ALGO_FEED = "note-feed-view";
const DEFAULT_FEED_SIZE = 0;
const FEED_BATCH_SIZE = 30;

interface OpenCountRecord {
  count: number;
  lastOpened: number;
  recentOpenTimestamps?: number[];
}

interface FeedPluginData {
  openCounts: Record<string, OpenCountRecord>;
}

interface PersistedState extends FeedPluginSettings, FeedPluginData {}

interface FeedPluginSettings {
  mostVisitedWindowDays: number;
  feedSize: number;
  weights: {
    random: number;
    created: number;
    openedEdited: number;
    mostOpened: number;
  };
}

interface FeedCandidate {
  file: TFile;
  title: string;
  created: number;
  modified: number;
  lastOpened: number;
  windowOpenCount: number;
}

interface FeedItem {
  candidate: FeedCandidate;
  reason: string;
  reasonDate: number;
}

const DEFAULT_SETTINGS: FeedPluginSettings = {
  mostVisitedWindowDays: 90,
  feedSize: DEFAULT_FEED_SIZE,
  weights: {
    random: 0.1,
    created: 0.3,
    openedEdited: 0.4,
    mostOpened: 0.2,
  },
};

const DEFAULT_DATA: FeedPluginData = {
  openCounts: {},
};

export default class NotesFeedPlugin extends Plugin {
  settings: FeedPluginSettings = DEFAULT_SETTINGS;
  data: FeedPluginData = DEFAULT_DATA;
  private saveTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadState();

    this.registerView(
      VIEW_TYPE_ALGO_FEED,
      (leaf) => new NoteFeedView(leaf, this)
    );

    this.addRibbonIcon("dice", "Open Notes Feed", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-notes-feed",
      name: "Open Notes Feed",
      callback: async () => {
        await this.activateView();
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        this.bumpOpenCount(file.path);
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) {
          return;
        }
        const existing = this.data.openCounts[oldPath];
        if (!existing) {
          return;
        }
        this.data.openCounts[file.path] = existing;
        delete this.data.openCounts[oldPath];
        this.queueDataSave();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const path = this.pathForDelete(file);
        if (!path || !this.data.openCounts[path]) {
          return;
        }
        delete this.data.openCounts[path];
        this.queueDataSave();
      })
    );
  }

  async onunload(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ALGO_FEED)) {
      leaf.detach();
    }
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ALGO_FEED)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_ALGO_FEED,
        active: true,
      });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  async loadState(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PersistedState> | undefined;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      weights: {
        ...DEFAULT_SETTINGS.weights,
        ...(loaded?.weights ?? {}),
      },
    };
    this.data = {
      ...DEFAULT_DATA,
      openCounts: {
        ...DEFAULT_DATA.openCounts,
        ...(loaded?.openCounts ?? {}),
      },
    };
  }

  getWindowStart(now: number): number {
    const windowMs = this.settings.mostVisitedWindowDays * 24 * 60 * 60 * 1000;
    return now - windowMs;
  }

  getOpenRecord(path: string): OpenCountRecord | undefined {
    return this.data.openCounts[path];
  }

  buildFeedItems(): FeedItem[] {
    const now = Date.now();
    const candidates = this.collectCandidates(now);
    return buildMixedFeed(candidates, this.settings);
  }

  async readPreview(file: TFile): Promise<string> {
    const raw = await this.app.vault.cachedRead(file);
    return buildPreview(raw);
  }

  private pathForDelete(file: TAbstractFile): string | null {
    if (file instanceof TFile) {
      return file.path;
    }
    if ("path" in file && typeof file.path === "string") {
      return file.path;
    }
    return null;
  }

  private bumpOpenCount(path: string): void {
    const now = Date.now();
    const record = this.data.openCounts[path] ?? {
      count: 0,
      lastOpened: 0,
      recentOpenTimestamps: [],
    };
    record.count += 1;
    record.lastOpened = now;
    record.recentOpenTimestamps = [
      ...(record.recentOpenTimestamps ?? []),
      now,
    ];
    record.recentOpenTimestamps = pruneTimestamps(
      record.recentOpenTimestamps,
      this.getWindowStart(now)
    );
    this.data.openCounts[path] = record;
    this.queueDataSave();
  }

  private queueDataSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(async () => {
      const payload: PersistedState = {
        ...this.settings,
        ...this.data,
      };
      await this.saveData(payload);
      this.saveTimer = null;
    }, 250);
  }

  private collectCandidates(now: number): FeedCandidate[] {
    const windowStart = this.getWindowStart(now);
    const files = this.app.vault.getMarkdownFiles();

    return files.map((file) => {
      const record = this.getOpenRecord(file.path);
      const windowOpenCount = countWindowOpens(record, windowStart);
      return {
        file,
        title: file.basename,
        created: file.stat.ctime,
        modified: file.stat.mtime,
        lastOpened: record?.lastOpened ?? 0,
        windowOpenCount,
      };
    });
  }
}

class NoteFeedView extends ItemView {
  plugin: NotesFeedPlugin;
  private scrollEl: HTMLElement | null = null;
  private scrolling = false;
  private scrollIdleTimer: number | null = null;
  private items: FeedItem[] = [];
  private renderedCount = 0;
  private listEl: HTMLElement | null = null;
  private rendering = false;
  private refreshTimer: number | null = null;
  private cardUpdateTimer: number | null = null;
  private pendingCardUpdates = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: NotesFeedPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ALGO_FEED;
  }

  getDisplayText(): string {
    return "Notes Feed";
  }

  getIcon(): string {
    return "dice";
  }

  async onOpen(): Promise<void> {
    this.addAction("refresh-cw", "Refresh feed", async () => {
      await this.refreshFeed(true);
    });
    this.registerMarkdownVaultEvent("create", () => this.scheduleRefresh());
    this.registerMarkdownVaultEvent("delete", () => this.scheduleRefresh());
    this.registerMarkdownVaultEvent("rename", () => this.scheduleRefresh());
    this.registerMarkdownVaultEvent("modify", (file) => this.scheduleCardUpdate(file));
    await this.refreshFeed(false);
  }

  async onClose(): Promise<void> {
    this.scrollEl?.removeEventListener("scroll", this.onScroll);
    if (this.scrollIdleTimer !== null) {
      window.clearTimeout(this.scrollIdleTimer);
      this.scrollIdleTimer = null;
    }
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.cardUpdateTimer !== null) {
      window.clearTimeout(this.cardUpdateTimer);
      this.cardUpdateTimer = null;
    }
    this.pendingCardUpdates.clear();
  }

  private registerMarkdownVaultEvent(
    event: "create" | "delete" | "rename" | "modify",
    handler: (file: TFile) => void
  ): void {
    this.registerEvent(
      this.app.vault.on(event, (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        handler(file);
      })
    );
  }

  private scheduleRefresh(delayMs = 300): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (this.scrolling) {
        this.scheduleRefresh(delayMs);
        return;
      }
      void this.refreshFeed(false);
    }, delayMs);
  }

  private scheduleCardUpdate(file: TFile, delayMs = 400): void {
    this.pendingCardUpdates.add(file.path);
    if (this.cardUpdateTimer !== null) {
      window.clearTimeout(this.cardUpdateTimer);
    }
    this.cardUpdateTimer = window.setTimeout(() => {
      this.cardUpdateTimer = null;
      const paths = [...this.pendingCardUpdates];
      this.pendingCardUpdates.clear();
      void this.updateCardsForPaths(paths);
    }, delayMs);
  }

  private async updateCardsForPaths(paths: string[]): Promise<void> {
    if (!this.listEl) {
      return;
    }

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }

      const card = this.listEl.querySelector(
        `[data-path="${CSS.escape(path)}"]`
      );
      if (!card) {
        continue;
      }

      const previewEl = card.querySelector(".notes-feed-preview");
      if (previewEl) {
        const preview = await this.plugin.readPreview(file);
        previewEl.textContent = preview || "Empty note";
      }

      const item = this.items.find((entry) => entry.candidate.file.path === path);
      if (item) {
        item.candidate.modified = file.stat.mtime;
      }
    }
  }

  private onScroll = (): void => {
    this.scrolling = true;
    void this.maybeLoadMore();
    if (this.scrollIdleTimer !== null) {
      window.clearTimeout(this.scrollIdleTimer);
    }
    this.scrollIdleTimer = window.setTimeout(() => {
      this.scrolling = false;
      this.scrollIdleTimer = null;
    }, 250);
  };

  private async refreshFeed(manual: boolean): Promise<void> {
    if (!manual && this.scrolling) {
      return;
    }

    const content = this.contentEl;
    content.empty();
    content.addClass("notes-feed-root");

    this.items = this.plugin.buildFeedItems();
    this.renderedCount = 0;
    this.listEl = content.createDiv({ cls: "notes-feed-list" });
    this.scrollEl = this.findScrollContainer();
    this.scrollEl?.removeEventListener("scroll", this.onScroll);
    this.scrollEl?.addEventListener("scroll", this.onScroll, { passive: true });

    if (this.items.length === 0) {
      content.createEl("p", { text: "No markdown notes available yet." });
      return;
    }

    await this.renderNextBatch();
    await this.maybeLoadMore();
  }

  private async renderNextBatch(): Promise<void> {
    if (this.rendering || !this.listEl) {
      return;
    }
    if (this.renderedCount >= this.items.length) {
      return;
    }

    this.rendering = true;
    const upperBound = Math.min(this.renderedCount + FEED_BATCH_SIZE, this.items.length);
    for (let i = this.renderedCount; i < upperBound; i += 1) {
      const item = this.items[i];
      const card = this.listEl.createDiv({ cls: "notes-feed-card" });
      card.setAttr("data-path", item.candidate.file.path);
      card.setAttr("role", "button");
      card.setAttr("tabindex", "0");
      card.setAttr("aria-label", `Open note ${item.candidate.title}`);
      card.createEl("h3", {
        cls: "notes-feed-title",
        text: item.candidate.title,
      });
      card.addClass("notes-feed-card-enter");

      const preview = await this.plugin.readPreview(item.candidate.file);
      card.createEl("p", {
        cls: "notes-feed-preview",
        text: preview || "Empty note",
      });

      const footer = card.createDiv({ cls: "notes-feed-footer" });
      footer.createSpan({
        cls: "notes-feed-reason",
        text: item.reason,
      });
      footer.createSpan({
        cls: "notes-feed-date",
        text: formatDate(item.reasonDate),
      });

      card.addEventListener("click", async (evt: MouseEvent) => {
        const newTab = Keymap.isModEvent(evt) || evt.button === 1;
        const opened = await this.openFeedItem(item.candidate.file, newTab);
        if (!opened) {
          card.remove();
        }
      });

      card.addEventListener("keydown", async (evt: KeyboardEvent) => {
        if (evt.key !== "Enter" && evt.key !== " ") {
          return;
        }
        evt.preventDefault();
        const opened = await this.openFeedItem(item.candidate.file, Keymap.isModEvent(evt));
        if (!opened) {
          card.remove();
        }
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          card.removeClass("notes-feed-card-enter");
        });
      });
    }
    this.renderedCount = upperBound;
    this.rendering = false;
  }

  private async maybeLoadMore(): Promise<void> {
    if (!this.scrollEl || this.rendering || this.renderedCount >= this.items.length) {
      return;
    }
    const thresholdPx = 240;
    const remaining =
      this.scrollEl.scrollHeight - this.scrollEl.scrollTop - this.scrollEl.clientHeight;
    if (remaining <= thresholdPx) {
      await this.renderNextBatch();
      if (this.scrollEl.scrollHeight <= this.scrollEl.clientHeight && this.renderedCount < this.items.length) {
        await this.maybeLoadMore();
      }
    }
  }

  private findScrollContainer(): HTMLElement {
    let el: HTMLElement | null = this.contentEl;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 2) {
        return el;
      }
      const style = window.getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return el;
      }
      el = el.parentElement;
    }
    return this.contentEl;
  }

  private async openFeedItem(file: TFile, newTab: boolean): Promise<boolean> {
    const existing = this.app.vault.getAbstractFileByPath(file.path);
    if (!(existing instanceof TFile)) {
      new Notice("Note was deleted, removed from feed.");
      return false;
    }
    const targetLeaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    try {
      await targetLeaf.openFile(existing);
      return true;
    } catch {
      new Notice("Couldn't open note, removed from feed.");
      return false;
    }
  }
}

function buildMixedFeed(candidates: FeedCandidate[], settings: FeedPluginSettings): FeedItem[] {
  const feedSize =
    settings.feedSize > 0
      ? Math.min(settings.feedSize, candidates.length)
      : candidates.length;
  if (feedSize <= 0) {
    return [];
  }
  const selected = new Set<string>();
  const feed: FeedItem[] = [];

  const pools: Record<keyof FeedPluginSettings["weights"], FeedCandidate[]> = {
    random: shuffle([...candidates]),
    created: [...candidates].sort((a, b) => b.created - a.created),
    openedEdited: [...candidates].sort((a, b) => {
    const scoreA = Math.max(a.lastOpened, a.modified);
    const scoreB = Math.max(b.lastOpened, b.modified);
    return scoreB - scoreA;
    }),
    mostOpened: [...candidates]
      .filter((candidate) => candidate.windowOpenCount > 0)
      .sort((a, b) => b.windowOpenCount - a.windowOpenCount),
  };

  const poolPointers: Record<keyof FeedPluginSettings["weights"], number> = {
    random: 0,
    created: 0,
    openedEdited: 0,
    mostOpened: 0,
  };

  const reasonBuilders: Record<
    keyof FeedPluginSettings["weights"],
    (candidate: FeedCandidate) => string
  > = {
    random: () => "Random pick",
    created: () => "Newly created",
    openedEdited: (candidate) => {
      if (candidate.lastOpened >= candidate.modified && candidate.lastOpened > 0) {
        return `Opened ${formatRelativeDays(candidate.lastOpened)}`;
      }
      return `Modified ${formatRelativeDays(candidate.modified)}`;
    },
    mostOpened: (candidate) =>
      `Opened ${candidate.windowOpenCount} times (${settings.mostVisitedWindowDays}d)`,
  };

  const datePickers: Record<
    keyof FeedPluginSettings["weights"],
    (candidate: FeedCandidate) => number
  > = {
    random: (c) => c.modified,
    created: (c) => c.created,
    openedEdited: (c) => Math.max(c.lastOpened, c.modified),
    mostOpened: (c) => c.lastOpened || c.modified,
  };

  const sequence = buildCategorySequence(settings.weights);
  const fallbackOrder: Array<keyof FeedPluginSettings["weights"]> = [
    "openedEdited",
    "created",
    "mostOpened",
    "random",
  ];

  for (let i = 0; i < feedSize; i += 1) {
    const preferredCategory = sequence[i % sequence.length];
    const candidate =
      pullNextCandidate(preferredCategory, pools, poolPointers, selected) ??
      pullFromFallbacks(fallbackOrder, pools, poolPointers, selected);
    if (!candidate) {
      break;
    }
    const category = candidate.category;
    feed.push({
      candidate: candidate.item,
      reason: reasonBuilders[category](candidate.item),
      reasonDate: datePickers[category](candidate.item),
    });
  }

  return feed.slice(0, feedSize);
}
function buildCategorySequence(
  weights: FeedPluginSettings["weights"]
): Array<keyof FeedPluginSettings["weights"]> {
  const baseSlots = 10;
  const raw = {
    random: weights.random * baseSlots,
    created: weights.created * baseSlots,
    openedEdited: weights.openedEdited * baseSlots,
    mostOpened: weights.mostOpened * baseSlots,
  };
  const counts: Record<keyof FeedPluginSettings["weights"], number> = {
    random: Math.floor(raw.random),
    created: Math.floor(raw.created),
    openedEdited: Math.floor(raw.openedEdited),
    mostOpened: Math.floor(raw.mostOpened),
  };
  let remaining =
    baseSlots - (counts.random + counts.created + counts.openedEdited + counts.mostOpened);
  const remainderOrder = (Object.keys(raw) as Array<keyof typeof raw>).sort(
    (a, b) => raw[b] - Math.floor(raw[b]) - (raw[a] - Math.floor(raw[a]))
  );
  let idx = 0;
  while (remaining > 0) {
    counts[remainderOrder[idx % remainderOrder.length]] += 1;
    remaining -= 1;
    idx += 1;
  }

  const grouped: Array<keyof FeedPluginSettings["weights"]> = [];
  for (const key of ["random", "created", "openedEdited", "mostOpened"] as const) {
    for (let i = 0; i < counts[key]; i += 1) {
      grouped.push(key);
    }
  }
  return shuffle(grouped);
}

function pullNextCandidate(
  category: keyof FeedPluginSettings["weights"],
  pools: Record<keyof FeedPluginSettings["weights"], FeedCandidate[]>,
  pointers: Record<keyof FeedPluginSettings["weights"], number>,
  selected: Set<string>
): { category: keyof FeedPluginSettings["weights"]; item: FeedCandidate } | null {
  const pool = pools[category];
  let cursor = pointers[category];
  while (cursor < pool.length) {
    const item = pool[cursor];
    cursor += 1;
    if (selected.has(item.file.path)) {
      continue;
    }
    pointers[category] = cursor;
    selected.add(item.file.path);
    return { category, item };
  }
  pointers[category] = cursor;
  return null;
}

function pullFromFallbacks(
  order: Array<keyof FeedPluginSettings["weights"]>,
  pools: Record<keyof FeedPluginSettings["weights"], FeedCandidate[]>,
  pointers: Record<keyof FeedPluginSettings["weights"], number>,
  selected: Set<string>
): { category: keyof FeedPluginSettings["weights"]; item: FeedCandidate } | null {
  for (const category of order) {
    const next = pullNextCandidate(category, pools, pointers, selected);
    if (next) {
      return next;
    }
  }
  return null;
}

function countWindowOpens(record: OpenCountRecord | undefined, windowStart: number): number {
  if (!record?.recentOpenTimestamps || record.recentOpenTimestamps.length === 0) {
    return 0;
  }
  return record.recentOpenTimestamps.filter((ts) => ts >= windowStart).length;
}

function pruneTimestamps(timestamps: number[], windowStart: number): number[] {
  return timestamps.filter((ts) => ts >= windowStart);
}

function buildPreview(raw: string): string {
  const withoutFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n?/m, "");
  const withoutCodeBlocks = withoutFrontmatter.replace(/```[\s\S]*?```/g, " ");
  const withoutInlineCode = withoutCodeBlocks.replace(/`([^`]+)`/g, "$1");
  const noImages = withoutInlineCode.replace(/!\[[^\]]*?\]\((.*?)\)/g, " ");
  const noLinks = noImages.replace(/\[([^\]]+)\]\((.*?)\)/g, "$1");
  const noMarkup = noLinks
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\|/g, " ")
    .replace(/\[(x| )\]/gi, " ");
  const compact = noMarkup.replace(/\s+/g, " ").trim();
  return compact.length > 150 ? `${compact.slice(0, 150).trim()}...` : compact;
}

function formatDate(ts: number): string {
  if (!ts) {
    return "No date";
  }
  return new Date(ts).toLocaleDateString();
}

function formatRelativeDays(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) {
    return "just now";
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / dayMs);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "1 day ago";
  }
  return `${days} days ago`;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
