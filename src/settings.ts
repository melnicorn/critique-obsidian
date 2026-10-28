import { PluginSettingTab, Setting, type App } from "obsidian";
import type CritiquePlugin from "./main";
import type { TimestampPrecision } from "./time";
import { DEFAULT_GUIDE_URL } from "./agent-header";

export type MarkStyle = "highlight" | "underline" | "off";
export type DeletionStyle = "strike-color" | "color" | "bold-color";
export type AdditionStyle = "underline-color" | "color" | "bold-color";
export type PanelFilter = "all" | "changes" | "comments";

export interface CritiqueSettings {
  authorName: string;
  addTimestamps: boolean;
  timestampPrecision: TimestampPrecision;
  recordEditTime: boolean;
  colors: { addition: string; deletion: string; highlight: string; comment: string };
  tintStrength: number;
  markStyle: MarkStyle;
  deletionStyle: DeletionStyle;
  additionStyle: AdditionStyle;
  colorByAuthor: boolean;
  foldMetadata: boolean;
  indicatorsEditor: boolean;
  indicatorsReading: boolean;
  showMarksReading: boolean;
  panelLocation: "right" | "left";
  confirmDelete: boolean;
  stripOnCopy: boolean;
  showToolbar: boolean;
  toolbarInReading: boolean;
  commentLabels: boolean;
  labels: string[];
  /** Insert the one-line agent guide header when the first mark is added to a note. */
  agentHeader: boolean;
  agentGuideUrl: string;
  // Panel state, persisted for convenience.
  panelFilter: PanelFilter;
  panelMine: boolean;
  panelShowResolved: boolean;
}

export const DEFAULT_SETTINGS: CritiqueSettings = {
  authorName: "",
  addTimestamps: true,
  timestampPrecision: "minutes",
  recordEditTime: false,
  colors: { addition: "#3fb950", deletion: "#f85149", highlight: "#e3b341", comment: "#58a6ff" },
  tintStrength: 100,
  markStyle: "highlight",
  deletionStyle: "strike-color",
  additionStyle: "underline-color",
  colorByAuthor: true,
  foldMetadata: false,
  indicatorsEditor: true,
  indicatorsReading: true,
  showMarksReading: true,
  panelLocation: "right",
  confirmDelete: true,
  stripOnCopy: false,
  showToolbar: true,
  toolbarInReading: true,
  commentLabels: false,
  labels: ["question", "suggestion", "issue", "praise"],
  agentHeader: false,
  agentGuideUrl: DEFAULT_GUIDE_URL,
  panelFilter: "all",
  panelMine: false,
  panelShowResolved: false,
};

const BODY_CLASS_PREFIXES = ["cq-markstyle-", "cq-delstyle-", "cq-addstyle-"];

/** Push the settings into CSS variables and body classes on a window's document. */
export function applySettingsToDocument(doc: Document, s: CritiqueSettings): void {
  const body = doc.body;
  for (const cls of Array.from(body.classList)) if (BODY_CLASS_PREFIXES.some((p) => cls.startsWith(p))) body.classList.remove(cls);
  body.classList.add(`cq-markstyle-${s.markStyle}`, `cq-delstyle-${s.deletionStyle}`, `cq-addstyle-${s.additionStyle}`);
  body.classList.toggle("cq-color-authors", s.colorByAuthor);
  body.classList.toggle("cq-hide-marks-reading", !s.showMarksReading);
  const st = body.style;
  st.setProperty("--cq-add", s.colors.addition);
  st.setProperty("--cq-del", s.colors.deletion);
  st.setProperty("--cq-hl", s.colors.highlight);
  st.setProperty("--cq-cmt", s.colors.comment);
  st.setProperty("--cq-tint", `${Math.round((18 * s.tintStrength) / 100)}%`);
  st.setProperty("--cq-tint-strong", `${Math.round((40 * s.tintStrength) / 100)}%`);
}

export class CritiqueSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CritiquePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    const save = () => void this.plugin.saveSettings();

    new Setting(containerEl).setName("Signature").setHeading();
    new Setting(containerEl)
      .setName("Author name")
      .setDesc('Written as author="…" on every mark you create. Leave empty to write marks without an author.')
      .addText((t) =>
        t.setPlaceholder("Your name").setValue(s.authorName).onChange((v) => {
          s.authorName = v.trim();
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Add timestamps")
      .setDesc('Written as date="…" on every mark you create.')
      .addToggle((t) =>
        t.setValue(s.addTimestamps).onChange((v) => {
          s.addTimestamps = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Timestamp precision")
      .setDesc("ISO 8601 with the local UTC offset.")
      .addDropdown((d) =>
        d
          .addOptions({ date: "Date only", minutes: "Minutes", seconds: "Seconds" })
          .setValue(s.timestampPrecision)
          .onChange((v) => {
            s.timestampPrecision = v as TimestampPrecision;
            save();
          }),
      );
    new Setting(containerEl)
      .setName("Record edit time")
      .setDesc('Add edited="…" when a comment is changed later.')
      .addToggle((t) =>
        t.setValue(s.recordEditTime).onChange((v) => {
          s.recordEditTime = v;
          save();
        }),
      );

    new Setting(containerEl).setName("Appearance").setHeading();
    const colorSetting = new Setting(containerEl).setName("Colors").setDesc("Addition, deletion, highlight, comment. Substitution uses addition and deletion.");
    for (const key of ["addition", "deletion", "highlight", "comment"] as const) {
      colorSetting.addColorPicker((c) =>
        c.setValue(s.colors[key]).onChange((v) => {
          s.colors[key] = v;
          save();
        }),
      );
    }
    colorSetting.addExtraButton((b) =>
      b
        .setIcon("rotate-ccw")
        .setTooltip("Reset colors")
        .onClick(() => {
          s.colors = { ...DEFAULT_SETTINGS.colors };
          save();
          this.display();
        }),
    );
    new Setting(containerEl)
      .setName("Mark style")
      .setDesc("How marked text is called out. Off shows plain text and relies on the margin indicators alone.")
      .addDropdown((d) =>
        d
          .addOptions({ highlight: "Highlighted", underline: "Dashed underline", off: "Off (tray only)" })
          .setValue(s.markStyle)
          .onChange((v) => {
            s.markStyle = v as MarkStyle;
            save();
          }),
      );
    new Setting(containerEl)
      .setName("Tint strength")
      .setDesc("Background tint for the Highlighted style.")
      .addSlider((sl) =>
        sl
          .setLimits(0, 200, 10)
          .setValue(s.tintStrength)
          .setDynamicTooltip()
          .onChange((v) => {
            s.tintStrength = v;
            save();
          }),
      );
    new Setting(containerEl).setName("Deletion style").addDropdown((d) =>
      d
        .addOptions({ "strike-color": "Strikethrough + color", color: "Color only", "bold-color": "Bold + color" })
        .setValue(s.deletionStyle)
        .onChange((v) => {
          s.deletionStyle = v as DeletionStyle;
          save();
        }),
    );
    new Setting(containerEl).setName("Addition style").addDropdown((d) =>
      d
        .addOptions({ "underline-color": "Underline + color", color: "Color only", "bold-color": "Bold + color" })
        .setValue(s.additionStyle)
        .onChange((v) => {
          s.additionStyle = v as AdditionStyle;
          save();
        }),
    );
    new Setting(containerEl)
      .setName("Color comments by author")
      .setDesc("Each author gets a stable hue for their comment anchors and avatars.")
      .addToggle((t) =>
        t.setValue(s.colorByAuthor).onChange((v) => {
          s.colorByAuthor = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Fold metadata in Source mode")
      .setDesc("Show the attribute prefix as a small chip until the cursor enters it.")
      .addToggle((t) =>
        t.setValue(s.foldMetadata).onChange((v) => {
          s.foldMetadata = v;
          save();
        }),
      );

    new Setting(containerEl).setName("Indicators and Reading mode").setHeading();
    new Setting(containerEl)
      .setName("Margin indicators in editor")
      .setDesc("Always on when Mark style is Off.")
      .addToggle((t) =>
        t.setValue(s.indicatorsEditor).onChange((v) => {
          s.indicatorsEditor = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Margin indicators in Reading mode")
      .setDesc("Always on when Mark style is Off.")
      .addToggle((t) =>
        t.setValue(s.indicatorsReading).onChange((v) => {
          s.indicatorsReading = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Show marks in Reading mode")
      .setDesc("Off renders the accepted text with no marks or indicators.")
      .addToggle((t) =>
        t.setValue(s.showMarksReading).onChange((v) => {
          s.showMarksReading = v;
          save();
        }),
      );

    new Setting(containerEl).setName("Authoring").setHeading();
    new Setting(containerEl)
      .setName("Selection toolbar in the editor")
      .setDesc("Show a small toolbar above selected text.")
      .addToggle((t) =>
        t.setValue(s.showToolbar).onChange((v) => {
          s.showToolbar = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Selection toolbar in Reading mode")
      .addToggle((t) =>
        t.setValue(s.toolbarInReading).onChange((v) => {
          s.toolbarInReading = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Comment labels")
      .setDesc('Offer a label (question, suggestion, …) when writing a comment, stored as label="…".')
      .addToggle((t) =>
        t.setValue(s.commentLabels).onChange((v) => {
          s.commentLabels = v;
          save();
          this.display();
        }),
      );
    if (s.commentLabels) {
      new Setting(containerEl)
        .setName("Labels")
        .setDesc("Comma separated.")
        .addText((t) =>
          t.setValue(s.labels.join(", ")).onChange((v) => {
            s.labels = v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            save();
          }),
        );
    }

    new Setting(containerEl).setName("Agents").setHeading();
    new Setting(containerEl)
      .setName("Add agent guide header to reviewed notes")
      .setDesc("When the first mark is added to a note, insert a one-line HTML comment after the frontmatter that tells an AI agent how the marks work and links to the guide. Removed again when the last mark goes. Hidden in Live Preview and Reading mode.")
      .addToggle((t) =>
        t.setValue(s.agentHeader).onChange((v) => {
          s.agentHeader = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Agent guide URL")
      .setDesc("Linked from the header. The same guide ships with the plugin as SKILL.md.")
      .addText((t) =>
        t.setValue(s.agentGuideUrl).onChange((v) => {
          s.agentGuideUrl = v.trim() || DEFAULT_GUIDE_URL;
          save();
        }),
      );

    new Setting(containerEl).setName("Review panel and safety").setHeading();
    new Setting(containerEl).setName("Panel location").addDropdown((d) =>
      d
        .addOptions({ right: "Right sidebar", left: "Left sidebar" })
        .setValue(s.panelLocation)
        .onChange((v) => {
          s.panelLocation = v as "right" | "left";
          save();
        }),
    );
    new Setting(containerEl).setName("Confirm before deleting comments").addToggle((t) =>
      t.setValue(s.confirmDelete).onChange((v) => {
        s.confirmDelete = v;
        save();
      }),
    );
    new Setting(containerEl)
      .setName("Strip marks when copying")
      .setDesc("Copy the accepted text to the clipboard instead of raw syntax.")
      .addToggle((t) =>
        t.setValue(s.stripOnCopy).onChange((v) => {
          s.stripOnCopy = v;
          save();
        }),
      );
  }
}
