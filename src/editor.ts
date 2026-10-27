import { css, html, LitElement, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { ConfigDraft, type EditorField } from "./editor-model.ts";
import { languageCode, type MessageKey, noticeText, text } from "./localize.ts";
import { type HomeAssistant, sliderSteps } from "./model.ts";

export class AdvancedBlindCardEditor extends LitElement {
  private draft = new ConfigDraft();
  private _hass: HomeAssistant | undefined;
  setConfig(value: unknown) {
    this.draft.setConfig(value);
    this.requestUpdate();
  }
  set hass(value: HomeAssistant | undefined) {
    this._hass = value;
    this.lang = languageCode(value?.language);
    this.requestUpdate();
  }
  get hass() {
    return this._hass;
  }
  private t(key: MessageKey) {
    return text(key, this.hass?.language);
  }
  private change(field: EditorField, value: string) {
    const config = this.draft.update(field, value);
    this.requestUpdate();
    if (config)
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config },
          bubbles: true,
          composed: true,
        }),
      );
  }
  private select(field: EditorField, label: MessageKey, mode = false) {
    const value = this.draft.value(field);
    return html`<label for=${field}>${this.t(label)}</label>
      <select id=${field} .value=${live(this.draft.value(field))}
        aria-describedby="editor-help" ?disabled=${!this.draft.editable}
        @change=${(event: Event) => this.change(field, (event.currentTarget as HTMLSelectElement).value)}>
        <option value="" .selected=${value === ""}>${this.t("default")}</option>
        ${
          mode
            ? html`<option value="single" .selected=${value === "single"}>${this.t("single")}</option><option value="bidirectional" .selected=${value === "bidirectional"}>${this.t("bidirectional")}</option>`
            : html`<option value="true" .selected=${value === "true"}>${this.t("yes")}</option><option value="false" .selected=${value === "false"}>${this.t("no")}</option>`
        }
      </select>`;
  }
  private stepSelect(field: "position_step" | "tilt_step", label: MessageKey) {
    const value = this.draft.value(field);
    return html`<label for=${field}>${this.t(label)}</label>
      <select id=${field} .value=${live(value)} ?disabled=${!this.draft.editable}
        aria-describedby="step-help"
        @change=${(event: Event) => this.change(field, (event.currentTarget as HTMLSelectElement).value)}>
        <option value="" .selected=${value === ""}>${this.t("default")} (10 %)</option>
        ${sliderSteps.map((step) => html`<option value=${String(step)} .selected=${value === String(step)}>${step} %</option>`)}
      </select>`;
  }
  private layoutSelect() {
    const value = this.draft.value("layout");
    return html`<label for="layout">${this.t("layout")}</label>
      <select id="layout" .value=${live(value)} ?disabled=${!this.draft.editable}
        aria-describedby="layout-help"
        @change=${(event: Event) => this.change("layout", (event.currentTarget as HTMLSelectElement).value)}>
        <option value="" .selected=${value === ""}>${this.t("default")} (${this.t("detailed")})</option>
        <option value="detailed" .selected=${value === "detailed"}>${this.t("detailed")}</option>
        <option value="inline" .selected=${value === "inline"}>${this.t("inline")}</option>
      </select>`;
  }
  protected render() {
    return html`<p id="editor-help">${this.t("editorIntro")}</p>
      ${this.draft.error ? html`<p id="editor-error" class="error" role="alert">${noticeText(this.draft.error, this.hass?.language)}${!this.draft.editable ? ` ${this.t("invalidYaml")}` : ""}</p>` : nothing}
      <div class="fields">
        ${this.layoutSelect()}
        ${this.select("show_buttons", "buttons")}${this.select("show_name", "names")}
        ${this.select("show_state", "states")}${this.select("show_values", "values")}
      </div>
      <p id="layout-help">${this.t("layoutHelp")}</p>
      <fieldset><legend>${this.t("steps")}</legend>
        <p id="step-help">${this.t("stepHelp")}</p><div class="fields">
        ${this.stepSelect("position_step", "positionStep")}
        ${this.stepSelect("tilt_step", "tiltStep")}
      </div></fieldset>
      <fieldset><legend>${this.t("visual")}</legend>
        <p id="visual-help">${this.t("visualHelp")}</p><div class="fields">
        ${this.select("mode", "modeLabel", true)}
        ${(["min_angle", "max_angle"] as const).map(
          (field) => html`
          <label for=${field}>${this.t(field === "min_angle" ? "min" : "max")}</label>
          <input id=${field} type="text" inputmode="decimal" .value=${live(this.draft.value(field))}
            placeholder=${this.t("default")} ?disabled=${!this.draft.editable}
            aria-invalid=${this.draft.error ? "true" : "false"}
            aria-describedby=${`visual-help${this.draft.error ? " editor-error" : ""}`}
            @input=${(event: Event) => this.change(field, (event.currentTarget as HTMLInputElement).value)} />`,
        )}
        ${this.select("invert", "invert")}
      </div></fieldset>`;
  }
  static styles = css`
    :host { display:block; color:var(--primary-text-color, #212121); }
    p { font-size:14px; line-height:1.5; overflow-wrap:anywhere; }
    .fields { display:grid; grid-template-columns:minmax(0, 1fr) minmax(100px, 1fr); gap:12px; align-items:center; }
    label { overflow-wrap:anywhere; }
    select, input { box-sizing:border-box; width:100%; min-height:44px; font:inherit; color:inherit;
      background:var(--ha-card-background, var(--card-background-color, #fff)); border:1px solid var(--divider-color, #888); border-radius:4px; padding:8px; }
    input::placeholder { color:var(--secondary-text-color, #666); opacity:1; }
    fieldset { min-width:0; margin:20px 0 0; border:1px solid var(--divider-color, #888); }
    input:focus-visible, select:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
    .error { color:var(--error-color, #db4437); }
    @media (max-width:400px) { .fields { grid-template-columns:minmax(0,1fr); gap:8px; } }
  `;
}
if (!customElements.get("advanced-blind-card-editor"))
  customElements.define("advanced-blind-card-editor", AdvancedBlindCardEditor);
