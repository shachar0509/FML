import { create } from "zustand";
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@/core/domain/schemas";
import { defaultDataRoot, readJson, writeJson } from "@/core/lib/storage";

const FILE = "settings.json";

type State = {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
};

export const useSettings = create<State>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const parsed = SettingsSchema.safeParse((await readJson(FILE)) ?? {});
    const s = parsed.success ? parsed.data : DEFAULT_SETTINGS; // corrupt file -> defaults
    if (!s.dataRoot) s.dataRoot = await defaultDataRoot().catch(() => "Shalav");
    set({ settings: s, loaded: true });
  },
  update: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    void writeJson(FILE, get().settings);
  },
}));
