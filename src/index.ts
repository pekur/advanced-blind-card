import { css, html, LitElement, noChange, nothing, svg } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import "./editor.ts";
import { CoverController } from "./controller.ts";
import { GroupController } from "./group.ts";
import {
  errorNotice,
  type MessageKey,
  noticeText,
  type Params,
  stateText,
  text,
} from "./localize.ts";
import {
  type Action,
  type Axis,
  type CardConfig,
  type CoverConfig,
  defaultTiltVisual,
  entityFor,
  type HomeAssistant,
  parseConfig,
  type RowSettings,
  sharedTiltVisual,
  snapTarget,
  type TiltVisual,
  tiltRotation,
} from "./model.ts";
import {
  type ProgressStatus,
  progressLabels,
  progressSymbol,
  progressText,
} from "./progress.ts";

type Controller = CoverController | GroupController;
interface View {
  id: string;
  controller: Controller;
  settings: RowSettings;
  name?: string;
  parent?: View;
  members: View[];
  expandable: boolean;
  expanded: boolean;
  inputRevision: number;
}
const sliderKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export class AdvancedBlindCard extends LitElement {
  static getConfigElement() {
    return document.createElement("advanced-blind-card-editor");
  }
  private t(key: MessageKey, params?: Params) {
    return text(key, this.hass?.language, params);
  }
  private views: View[] = [];
  private config: CardConfig | undefined;
  private _hass: HomeAssistant | undefined;
  private generation = 0;
  private attached = false;
  private pointer:
    | {
        id: number;
        axis: Axis;
        view: View;
        revision: number;
        input: HTMLInputElement;
      }
    | undefined;
  private allViews() {
    return this.views.flatMap((view) => [view, ...view.members]);
  }
  private leaves() {
    return this.allViews().filter(
      (view) => view.controller instanceof CoverController,
    );
  }
  private dispose() {
    this.cancelInteraction();
    for (const view of this.views)
      if (view.controller instanceof GroupController) view.controller.dispose();
    for (const view of this.leaves())
      (view.controller as CoverController).setAttached(false);
  }
  setConfig(value: unknown) {
    this.dispose();
    this.generation++;
    this.views = [];
    this.config = undefined;
    try {
      const config = parseConfig(value);
      const cover = (leaf: CoverConfig, id: string): View => {
        const controller = new CoverController(() => this.requestUpdate());
        controller.configureCover(leaf);
        if (this._hass) controller.setHass(this._hass);
        controller.setAttached(this.attached);
        return {
          id,
          controller,
          settings: leaf,
          name: leaf.name,
          members: [],
          expandable: false,
          expanded: false,
          inputRevision: 0,
        };
      };
      this.views = config.rows.map((row, index) => {
        const id = `row-${index}`;
        if (row.kind === "single") return cover(row, id);
        const members = row.members.map((leaf, child) =>
          cover(leaf, `${id}-${child}`),
        );
        const controller = new GroupController(
          members.map((view) => view.controller as CoverController),
          () => this.requestUpdate(),
        );
        const view: View = {
          id,
          controller,
          settings: row,
          name: row.name,
          members,
          expandable: row.expandable,
          expanded: false,
          inputRevision: 0,
        };
        for (const member of members) member.parent = view;
        return view;
      });
      this.config = config;
    } catch (error) {
      throw new Error(noticeText(errorNotice(error), this.hass?.language));
    } finally {
      this.requestUpdate();
    }
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }
  set hass(hass: HomeAssistant) {
    const active = this.allViews().filter((view) => view.controller.draft);
    this._hass = hass;
    for (const view of this.leaves())
      (view.controller as CoverController).setHass(hass);
    for (const view of this.views)
      if (view.controller instanceof GroupController) view.controller.refresh();
    for (const view of active)
      if (!view.controller.draft) this.cancelView(view);
    this.requestUpdate();
  }
  getCardSize() {
    return Math.max(
      1,
      Math.ceil(
        (this.getBoundingClientRect().height || this.views.length * 350) / 50,
      ),
    );
  }
  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }
  connectedCallback() {
    super.connectedCallback();
    this.attached = true;
    for (const view of this.leaves())
      (view.controller as CoverController).setAttached(true);
    window.addEventListener("pointerup", this.releasePointer);
    window.addEventListener("pointercancel", this.cancelPointer);
    window.addEventListener("pointerdown", this.newPointerSequence, true);
    window.addEventListener("pointermove", this.checkPointerButtons);
    window.addEventListener("blur", this.cancelInteraction);
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }
  disconnectedCallback() {
    window.removeEventListener("pointerup", this.releasePointer);
    window.removeEventListener("pointercancel", this.cancelPointer);
    window.removeEventListener("pointerdown", this.newPointerSequence, true);
    window.removeEventListener("pointermove", this.checkPointerButtons);
    window.removeEventListener("blur", this.cancelInteraction);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.attached = false;
    this.dispose();
    super.disconnectedCallback();
  }
  private releasePointer = (event: PointerEvent) => {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointer = undefined;
    const controller = pointer.view.controller;
    if (pointer.revision === controller.revision) {
      if (
        !pointer.input.isConnected ||
        !event.composedPath().includes(pointer.input)
      )
        controller.cancel();
      void controller.finish(pointer.axis, "pointer");
    }
    if (pointer.input.hasPointerCapture(pointer.id))
      pointer.input.releasePointerCapture(pointer.id);
  };
  private endCancelledPointer() {
    const pointer = this.pointer;
    if (!pointer) return;
    this.pointer = undefined;
    pointer.view.controller.cancel();
    if (pointer.revision === pointer.view.controller.revision)
      void pointer.view.controller.finish(pointer.axis, "pointer");
    if (pointer.input.hasPointerCapture(pointer.id))
      pointer.input.releasePointerCapture(pointer.id);
  }
  private cancelView(view: View) {
    view.inputRevision++;
    if (this.pointer?.view === view) this.endCancelledPointer();
    view.controller.cancel();
    view.controller.retireGesture();
    this.requestUpdate();
  }
  private related(view: View) {
    return view.members.length
      ? [view, ...view.members]
      : [view, ...(view.parent ? [view.parent] : [])];
  }
  private prepare(view: View) {
    for (const other of this.related(view))
      if (other !== view) this.cancelView(other);
  }
  private cancelRelated(view: View) {
    for (const other of this.related(view)) this.cancelView(other);
  }
  private cancelInteraction = () => {
    const focused = this.shadowRoot?.activeElement as HTMLInputElement | null;
    const focusedId = focused?.id;
    for (const view of this.allViews())
      if (view.controller.draft || this.pointer?.view === view)
        this.cancelView(view);
    const generation = this.generation;
    if (focusedId && document.hasFocus() && !document.hidden) {
      void this.updateComplete.then(() => {
        if (
          this.isConnected &&
          generation === this.generation &&
          document.hasFocus() &&
          !document.hidden &&
          !this.shadowRoot?.activeElement
        )
          this.shadowRoot
            ?.querySelector<HTMLInputElement>(`#${focusedId}`)
            ?.focus({ preventScroll: true });
      });
    }
  };
  private cancelPointer = (event: PointerEvent) => {
    if (this.pointer?.id === event.pointerId) this.cancelInteraction();
  };
  private visibilityChanged = () => {
    if (document.hidden) this.cancelInteraction();
  };
  private newPointerSequence = () => {
    if (this.pointer) this.endCancelledPointer();
  };
  private checkPointerButtons = (event: PointerEvent) => {
    if (this.pointer?.id === event.pointerId && (event.buttons & 1) === 0)
      this.endCancelledPointer();
  };
  private nameFor(view: View): string {
    if (view.name) return view.name;
    if (view.controller instanceof GroupController)
      return this.t("group", { count: view.members.length });
    const entity = entityFor(view.controller.snapshot);
    return (
      (entity ? this.hass?.formatEntityName?.(entity) : undefined) ??
      (typeof entity?.attributes.friendly_name === "string"
        ? entity.attributes.friendly_name
        : (view.controller.config?.entity ?? this.t("cover")))
    );
  }
  private current(
    view: View,
    generation: number,
    revision: number,
    event: Event,
  ) {
    return (
      this.isConnected &&
      generation === this.generation &&
      revision === view.controller.revision &&
      this.allViews().includes(view) &&
      (!view.parent || view.parent.expanded) &&
      (event.currentTarget as HTMLElement).isConnected
    );
  }
  protected render() {
    if (!this.config)
      return html`<ha-card><p role="status">${this.t("configure")}</p></ha-card>`;
    return keyed(
      this.generation,
      html`<ha-card lang=${this.hass?.language?.toLowerCase().split(/[-_]/)[0] === "cs" ? "cs" : "en"}>${this.views.map((view) => this.row(view))}</ha-card>`,
    );
  }
  private row(view: View): ReturnType<typeof keyed> {
    const controller = view.controller;
    const group =
      controller instanceof GroupController ? controller : undefined;
    const generation = this.generation,
      revision = controller.revision;
    const entity =
      controller instanceof CoverController
        ? entityFor(controller.snapshot)
        : undefined;
    const state = group
      ? group.state(this.hass?.language)
      : !this.hass?.connected
        ? this.t("haDisconnected")
        : !entity
          ? this.t("entityMissing")
          : (this.hass.formatEntityState?.(entity) ??
            stateText(entity.state, this.hass?.language));
    return keyed(
      `${view.id}-${revision}`,
      html`<section class=${view.parent ? "row child" : "row"} data-row=${view.id} aria-label=${this.nameFor(view)}>
      <div class="heading"><span class="icon" aria-hidden="true">▤</span><div class="heading-text">
        ${view.settings.showName ? html`<h2>${this.nameFor(view)}</h2>` : nothing}
        <div class="metadata">
        ${view.settings.showState || !this.healthyIdle(view) ? html`<p class="state entity-state" role="status">${state}</p>` : nothing}
        ${group ? html`<p class="state">${this.t("covers", { count: view.members.length })}</p>` : nothing}
        </div>
      </div>${
        group && view.expandable
          ? html`<button class="expand" type="button" aria-expanded=${String(view.expanded)}
        aria-controls=${`${view.id}-members`} aria-label=${`${this.t(view.expanded ? "collapse" : "expand")} ${this.nameFor(view)}`}
        @pointerdown=${(event: PointerEvent) => {
          if (this.current(view, generation, revision, event))
            this.cancelRelated(view);
        }}
        @click=${(event: MouseEvent) => {
          if (this.current(view, generation, revision, event)) {
            this.cancelRelated(view);
            (event.currentTarget as HTMLButtonElement).focus({
              preventScroll: true,
            });
            view.expanded = !view.expanded;
            this.requestUpdate();
          }
        }}>${view.expanded ? "▴" : "▾"}</button>`
          : nothing
      }</div>
      ${this.movement(view)}
      ${keyed(view.inputRevision, html`<div class="sliders">${this.slider(view, "position", this.t("position"))}${this.slider(view, "tilt", this.t("tilt"))}</div>`)}
      ${this.controlDetails(view)}
      ${(["position", "tilt"] as const).map((axis) => html`<div id=${`${this.axisId(view, axis)}-progress`} class="progress" data-progress-axis=${axis}>${this.axisProgress(view, axis, this.report(view, axis))}</div>`)}
      <div class="buttons">${view.settings.showButtons ? this.button(view, "open", this.t("open"), "↑") : nothing}
        ${this.stopButton(view)}${view.settings.showButtons ? this.button(view, "close", this.t("close"), "↓") : nothing}</div>
      ${controller.pending ? html`<p class="pending" role="status">${this.t("sending")}</p>` : nothing}
      ${controller.error ? html`<p class="error" role="alert">${controller.errorText(this.hass?.language)}</p>` : nothing}
      ${group && !view.expanded ? view.members.filter((member) => member.controller.error).map((member) => html`<p class="error" role="alert">${this.nameFor(member)}: ${member.controller.errorText(this.hass?.language)}</p>`) : nothing}
      ${this.stopProgress(view)}
      ${group?.results.length ? html`<details class="transport"><summary>${this.t("responses")}</summary><p class="state">${this.t("result", { accepted: group.results.filter((r) => r.status === "accepted").length, failed: group.results.filter((r) => r.status === "failed").length, skipped: group.results.filter((r) => r.status === "skipped").length })}</p></details>` : nothing}
      ${group && view.expandable ? html`<div class="members" id=${`${view.id}-members`}>${view.expanded ? view.members.map((member) => this.row(member)) : nothing}</div>` : nothing}
    </section>`,
    );
  }
  private axisId(view: View, axis: Axis) {
    return this.views.length === 1 && !view.parent && !view.members.length
      ? axis
      : `${view.id}-${axis}`;
  }
  private report(view: View, axis: Axis, compact = false) {
    const controller = view.controller;
    if (controller instanceof GroupController)
      return controller.aggregate(axis, this.hass?.language, compact).text;
    const value = controller.reported(axis);
    return value === null ? this.t("unknown") : `${value}%`;
  }
  private visualFor(view: View) {
    return view.controller instanceof GroupController
      ? sharedTiltVisual(
          view.controller.members.map(
            (member) => member.config?.tiltVisual ?? defaultTiltVisual,
          ),
        )
      : view.settings.tiltVisual;
  }
  private controlDetails(view: View) {
    const controller = view.controller;
    const group =
      controller instanceof GroupController ? controller : undefined;
    const details = (["position", "tilt"] as const).map((axis) => {
      const reason = controller.reason(axis, this.hass?.language);
      const base = reason ?? group?.coverage(axis, this.hass?.language) ?? "";
      const draft = controller.draft?.axis === axis && controller.draft.touched;
      const requested = controller.requested?.axis === axis;
      const chosen = draft || requested;
      const report = this.report(view, axis);
      const parts = [];
      if (chosen)
        parts.push(
          `${this.t("target")}: ${controller.value(axis)}% · ${this.t(draft ? "preview" : "requested")}`,
        );
      if (base) parts.push(base);
      if (chosen || (group && this.showValues(view, axis)))
        parts.push(`${this.t("reported")}: ${report}.`);
      return {
        axis,
        reason,
        base,
        chosen,
        text: parts.join(". "),
        extra:
          group &&
          report !== this.report(view, axis, true) &&
          this.showValues(view, axis),
      };
    });
    const same = details[0]?.base === details[1]?.base;
    const visible = (detail: (typeof details)[number]) =>
      detail.chosen || !!detail.extra || (!same && !!detail.base);
    const shared =
      same && !details.some(visible) ? (details[0]?.base ?? "") : "";
    const instruction = [
      shared,
      details.some((detail) => !detail.reason) ? this.t("releaseShort") : "",
    ]
      .filter(Boolean)
      .join(". ");
    const mapReason = !this.visualFor(view) ? this.t("differentMaps") : "";
    return html`<div class="control-details">
      ${details.map((detail) => html`<p id=${`${this.axisId(view, detail.axis)}-description`} class=${`description${visible(detail) ? "" : " sr-only"}${detail.chosen ? " draft-values" : ""}`}>${detail.text ? `${this.t(detail.axis === "position" ? "position" : "tilt")}: ${detail.text}` : nothing}</p>`)}
      ${mapReason ? html`<p id=${`${this.axisId(view, "tilt")}-visual`} class="description map-reason">${mapReason}</p>` : nothing}
      <p id=${`${view.id}-instruction`} class="instruction">${instruction}</p>
    </div>`;
  }
  private slider(view: View, axis: Axis, label: string) {
    const controller = view.controller;
    const group =
      controller instanceof GroupController ? controller : undefined;
    const generation = this.generation,
      revision = controller.revision,
      inputRevision = view.inputRevision;
    const reason = controller.reason(axis, this.hass?.language),
      value = controller.value(axis),
      reported = controller.reported(axis);
    const draft = controller.draft?.axis === axis && controller.draft.touched;
    const requested = controller.requested?.axis === axis;
    const chosen = draft || requested;
    const report = this.report(view, axis);
    const displayValue =
      group && !chosen
        ? this.report(view, axis, true)
        : value === null
          ? this.t("unknown")
          : `${value}%`;
    const revealValues = this.showValues(view, axis);
    const visual = this.visualFor(view);
    const mapReason = axis === "tilt" && !visual ? this.t("differentMaps") : "";
    const id = this.axisId(view, axis);
    const step =
      axis === "position" ? view.settings.positionStep : view.settings.tiltStep;
    // Preserve the keydown seed across Lit's update before the native action.
    const untouchedKeyboard =
      controller.draft?.axis === axis &&
      controller.draft.mode === "keyboard" &&
      !controller.draft.touched;
    // Native ranges snap their idle thumb to the grid. A late change at that
    // unchanged seed must not turn an off-grid HA report into a new command.
    const unchangedSeed = (input: HTMLInputElement) => {
      const actual = controller.reported(axis);
      return (
        !controller.draft &&
        actual !== null &&
        input.valueAsNumber === snapTarget(actual, step)
      );
    };
    const visibleLabel = axis === "tilt" ? this.t("shortTilt") : label;
    const current = (event: Event) =>
      this.current(view, generation, revision, event) &&
      inputRevision === view.inputRevision &&
      (event.currentTarget as HTMLElement).isConnected;
    return html`<section class="slider" aria-label=${label}>
      <div class="slider-label"><label for=${id}>${visibleLabel}${group ? html`<span class="target-label">${this.t("target")}</span>` : nothing}</label><div class="slider-values">${axis === "tilt" ? this.slats(group && !chosen ? reported : value, visual ?? defaultTiltVisual, mapReason) : nothing}${revealValues ? html`<output aria-live="off" for=${id}>${displayValue}</output>` : nothing}</div></div>
      <input id=${id} type="range" min="0" max="100" step=${step} class=${!chosen && reported === null ? "unknown" : nothing}
        .value=${untouchedKeyboard ? noChange : live(String(value ?? 0))} ?disabled=${reason !== null}
        aria-label=${this.views.length === 1 && !group && !view.parent ? label : `${this.nameFor(view)} ${group ? this.t("targetAxis", { axis: label }) : label}`}
        aria-valuetext=${group || chosen ? `${chosen ? `${this.t("target")} ${this.t("percent", { value: value ?? 0 })}${draft ? ` ${this.t("preview")}` : ""}` : this.t("noTarget")}. ${this.t("reported")}: ${report}` : value === null ? this.t("unknown") : this.t("percent", { value })}
        aria-describedby=${`${id}-description ${id}-progress ${view.id}-instruction${mapReason ? ` ${id}-visual` : ""}`}
        @pointerdown=${(event: PointerEvent) => {
          if (!current(event) || event.button !== 0 || !event.isPrimary) return;
          this.prepare(view);
          if (controller.begin(axis, "pointer")) {
            const input = event.currentTarget as HTMLInputElement;
            this.pointer = { axis, id: event.pointerId, view, revision, input };
            try {
              input.setPointerCapture(event.pointerId);
              // A tap on the current seed emits no native input/change.
              // Compare the report, not begin()'s zero seed for mixed groups.
              const initial = controller.reported(axis);
              if (initial !== input.valueAsNumber)
                controller.input(axis, input.valueAsNumber);
            } catch {
              this.cancelInteraction();
            }
          }
        }}
        @lostpointercapture=${(event: PointerEvent) => {
          if (current(event) && this.pointer?.id === event.pointerId)
            this.cancelInteraction();
        }}
        @input=${(event: Event) => {
          if (current(event)) {
            if (unchangedSeed(event.currentTarget as HTMLInputElement)) return;
            this.prepare(view);
            controller.input(
              axis,
              (event.currentTarget as HTMLInputElement).valueAsNumber,
            );
          }
        }}
        @change=${(event: Event) => {
          if (current(event)) {
            if (unchangedSeed(event.currentTarget as HTMLInputElement)) return;
            this.prepare(view);
            void controller.change(
              axis,
              (event.currentTarget as HTMLInputElement).valueAsNumber,
            );
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (!current(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            this.cancelInteraction();
          } else if (sliderKeys.has(event.key) && this.pointer)
            event.preventDefault();
          else if (
            sliderKeys.has(event.key) &&
            event.repeat &&
            (controller.draft?.mode !== "keyboard" ||
              controller.draft.axis !== axis)
          )
            event.preventDefault();
          else if (
            sliderKeys.has(event.key) &&
            !event.repeat &&
            controller.draft?.axis !== axis
          ) {
            this.prepare(view);
            if (controller.begin(axis, "keyboard")) {
              const input = event.currentTarget as HTMLInputElement;
              const initial = controller.value(axis);
              if (event.key === "Home" || event.key === "End") {
                // The thumb can already be at an endpoint while HA reports 1/99.
                // Home/End still explicitly select the exact endpoint target.
                controller.input(axis, event.key === "Home" ? 0 : 100);
              } else if (initial !== null && initial % step !== 0) {
                const rtl = getComputedStyle(input).direction === "rtl";
                const increasing =
                  event.key === "ArrowUp" ||
                  event.key === "PageUp" ||
                  (event.key === "ArrowRight" && !rtl) ||
                  (event.key === "ArrowLeft" && rtl);
                // Seed the native action on the opposite side: 9 -> 10, not 20.
                input.value = String(
                  (increasing
                    ? Math.floor(initial / step)
                    : Math.ceil(initial / step)) * step,
                );
              }
            }
          }
        }}
        @keyup=${(event: KeyboardEvent) => {
          if (current(event) && sliderKeys.has(event.key))
            void controller.finish(axis, "keyboard");
        }}
        @blur=${(event: FocusEvent) => {
          if (current(event) && controller.draft?.mode === "keyboard") {
            if (!document.hasFocus()) this.cancelInteraction();
            else void controller.finish(axis, "keyboard");
          }
        }} />
    </section>`;
  }
  private axisProgress(view: View, axis: Axis, report: string) {
    const language = this.hass?.language;
    const text = progressLabels(language);
    const controller = view.controller;
    const group =
      controller instanceof GroupController
        ? controller.progressFor(axis)
        : undefined;
    const status =
      controller instanceof CoverController
        ? controller.progress.status(axis)
        : undefined;
    const individual =
      controller instanceof GroupController
        ? controller.individualProgressFor(axis)
        : [];
    if (!group && !status && !individual.length) return nothing;
    const target = group?.target ?? status?.target;
    const counts = new Map<string, number>();
    for (const member of group?.members ?? []) {
      const message = progressText(member.status, language);
      counts.set(message, (counts.get(message) ?? 0) + 1);
    }
    return html`
      <p class="progress-axis">${this.t(axis === "position" ? "position" : "tilt")}</p>
      <p class="progress-values">${text.reported}: ${report}${target === undefined ? nothing : html` · ${group && individual.length ? text.groupTarget : text.target}: ${target}%`}</p>
      ${status ? html`<p class="progress-state" role="status" aria-live="polite" aria-atomic="true" data-code=${status.code}><span aria-hidden="true" class=${status.code === "moving" && !status.historical ? "motion-icon" : ""}>${progressSymbol(status)}</span> ${progressText(status, language)}</p>` : nothing}
      ${
        group
          ? html`<p class="progress-state" role="status" aria-live="polite" aria-atomic="true">${[...counts].map(([message, count]) => `${count}/${group.members.length} ${message}`).join(" · ")}</p>
        <ul class="member-progress">${group.members.map((member) => {
          const name = view.members.find(
            (child) =>
              child.controller instanceof CoverController &&
              child.controller.config?.entity === member.entity,
          );
          return html`<li data-progress-entity=${member.entity} data-code=${member.status.code}><span aria-hidden="true" class=${member.status.code === "moving" && !member.status.historical ? "motion-icon" : ""}>${progressSymbol(member.status)}</span> ${name ? this.nameFor(name) : member.entity}: ${progressText(member.status, language)}${member.status.code === "replaced" && member.status.target !== undefined ? ` · ${text.target}: ${member.status.target}%` : ""}${member.status.reason ? ` · ${noticeText(member.status.reason, language)}` : ""}</li>`;
        })}</ul>`
          : nothing
      }
      ${
        individual.length
          ? html`<p class="progress-heading">${text.individualTargets}</p>
        <ul class="member-progress individual-progress">${individual.map(
          (member) => {
            const name = view.members.find(
              (child) =>
                child.controller instanceof CoverController &&
                child.controller.config?.entity === member.entity,
            );
            return html`<li data-individual-entity=${member.entity}>
            <p class="progress-values"><span class="member-name">${name ? this.nameFor(name) : member.entity}</span> · ${text.target}: ${member.status.target}% · ${text.reported}: ${member.reported === null ? text.unknownValue : `${member.reported}%`}</p>
            <p class="progress-state" role="status" aria-live="polite" aria-atomic="true" data-code=${member.status.code}><span aria-hidden="true" class=${member.status.code === "moving" && !member.status.historical ? "motion-icon" : ""}>${progressSymbol(member.status)}</span> ${progressText(member.status, language)}${member.status.reason ? ` · ${noticeText(member.status.reason, language)}` : ""}</p>
          </li>`;
          },
        )}</ul>`
          : nothing
      }
    `;
  }
  private movement(view: View) {
    if (!(view.controller instanceof CoverController)) return nothing;
    const entity = entityFor(view.controller.snapshot);
    if (
      !this.hass?.connected ||
      !entity ||
      !["opening", "closing"].includes(entity.state)
    )
      return nothing;
    const states = (["position", "tilt"] as const).map((axis) =>
      view.controller instanceof CoverController
        ? view.controller.progress.status(axis)
        : undefined,
    );
    const animate = !states.some(
      (status) =>
        status?.historical ||
        ["unconfirmed", "interrupted", "failed"].includes(status?.code ?? ""),
    );
    const text = progressLabels(this.hass.language);
    return html`<p class="ha-motion" role="status" aria-live="polite"><span aria-hidden="true" class=${animate ? "motion-icon" : ""}>↕</span> ${entity.state === "opening" ? text.opening : text.closing}</p>`;
  }
  private stopProgress(view: View) {
    const controller = view.controller;
    const text = progressLabels(this.hass?.language);
    const message = (status: string, failed = false): string =>
      failed && status !== "failed"
        ? `${text.stopFailed} · ${message(status)}`
        : status === "sending"
          ? text.stopSending
          : status === "accepted"
            ? text.stopAccepted
            : status === "failed"
              ? text.stopFailed
              : status === "unconfirmed"
                ? text.stopUnconfirmed
                : status === "replaced"
                  ? text.replaced
                  : text.skipped;
    if (controller instanceof CoverController) {
      const status = controller.progress.stopStatus();
      return status
        ? html`<p class="stop-progress" role="status" aria-live="polite">■ ${message(status, controller.progress.stopFailed())}</p>`
        : nothing;
    }
    const stops = controller.stopProgress();
    if (!stops.length) return nothing;
    const counts = new Map<string, number>();
    for (const stop of stops) {
      const label = message(stop.status, stop.failed);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return html`<p class="stop-progress" role="status" aria-live="polite">■ ${[...counts].map(([label, count]) => `${count}/${stops.length} ${label}`).join(" · ")}</p>
      ${
        counts.size > 1
          ? html`<ul class="member-progress stop-members">${stops.map(
              (stop) => {
                const member = view.members.find(
                  (child) =>
                    child.controller instanceof CoverController &&
                    child.controller.config?.entity === stop.entity,
                );
                return html`<li>${member ? this.nameFor(member) : stop.entity}: ${message(stop.status, stop.failed)}</li>`;
              },
            )}</ul>`
          : nothing
      }`;
  }
  private healthyIdle(view: View) {
    const members =
      view.controller instanceof GroupController
        ? view.controller.members
        : [view.controller];
    const states = members.map((member) =>
      member.hass?.connected ? entityFor(member.snapshot)?.state : undefined,
    );
    return (
      states.length > 0 &&
      states.every(
        (state) =>
          (state === "open" || state === "closed") && state === states[0],
      )
    );
  }
  private showValues(view: View, axis: Axis) {
    const controller = view.controller;
    if (
      view.settings.showValues ||
      !this.healthyIdle(view) ||
      controller.reported(axis) === null ||
      controller.pending ||
      controller.draft?.axis === axis ||
      controller.requested?.axis === axis
    )
      return true;
    const unresolved = (status: ProgressStatus | undefined) =>
      status !== undefined &&
      (status.pending ||
        !["reached", "already", "replaced"].includes(status.code));
    if (controller instanceof CoverController)
      return !!unresolved(controller.progress.status(axis));
    return (
      controller.members.some((member) =>
        unresolved(member.progress.status(axis)),
      ) ||
      !!controller
        .progressFor(axis)
        ?.members.some((member) => unresolved(member.status))
    );
  }
  private slats(value: number | null, visual: TiltVisual, reason: string) {
    const rotation = reason ? null : tiltRotation(value, visual);
    return html`<svg class="slats" viewBox="0 0 64 96" role="img" aria-label=${reason || (rotation === null ? this.t("unknownAngle") : this.t("slatPreview", { value: value ?? 0 }))}>
      ${rotation === null ? svg`<text x="32" y="60" font-size="36" text-anchor="middle">?</text>` : [16, 48, 80].map((y) => svg`<rect x="18" y=${y - 2} width="28" height="4" rx="2" transform=${`rotate(${90 - rotation} 32 ${y})`} />`)}
    </svg>`;
  }
  private button(view: View, action: Action, label: string, symbol: string) {
    const generation = this.generation,
      revision = view.controller.revision;
    const reason = view.controller.reason(action, this.hass?.language);
    const group =
      view.controller instanceof GroupController ? view.controller : undefined;
    return html`<button type="button" aria-label=${this.views.length === 1 && !group && !view.parent ? label : `${this.nameFor(view)} ${label}`}
      ?disabled=${reason !== null} title=${reason ?? (group ? group.coverage(action, this.hass?.language) : label)} aria-description=${reason ?? (group ? group.coverage(action, this.hass?.language) : "")}
      @click=${(event: MouseEvent) => {
        if (this.current(view, generation, revision, event)) {
          this.prepare(view);
          void view.controller.perform(action);
        }
      }}><span class="button-symbol" aria-hidden="true">${symbol}</span><span>${this.t(action === "open" ? "up" : "down")}</span></button>`;
  }
  private stopButton(view: View) {
    const generation = this.generation,
      revision = view.controller.revision;
    const reason =
      view.controller.reason("stop", this.hass?.language) &&
      view.controller.reason("stopTilt", this.hass?.language);
    return html`<button type="button" class="stop" aria-label=${this.views.length === 1 && !view.members.length && !view.parent ? this.t("stop") : `${this.nameFor(view)} ${this.t("stop")}`}
      ?disabled=${reason !== null} title=${reason ?? this.t("stopHelp")} aria-description=${reason ?? ""}
      @pointerdown=${(event: PointerEvent) => {
        if (this.current(view, generation, revision, event))
          this.cancelRelated(view);
      }}
      @click=${(event: MouseEvent) => {
        if (this.current(view, generation, revision, event)) {
          this.cancelRelated(view);
          void view.controller.stop();
        }
      }}><span class="button-symbol" aria-hidden="true">■</span><span>${this.t("stop")}</span></button>`;
  }
  static styles = css`
    :host { display: block; container: blind-card / inline-size; }
    ha-card { display: block; padding: 0; color: var(--primary-text-color, #212121);
      background: transparent; border: 0; box-shadow: none; }
    .row { min-width: 0; padding: 12px; border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #ddd));
      border-radius: var(--ha-card-border-radius, 16px); background: var(--ha-card-background, var(--card-background-color, #fff)); }
    ha-card > .row + .row { margin-top: 12px; }
    .child { border: 0; border-radius: 12px; background: var(--secondary-background-color, #f5f7f9); }
    .members:not(:empty) { display: grid; gap: 10px; margin-top: 12px; }
    .members:empty { display: none; }
    .expand { flex: none; margin-left: auto; width: 44px; min-width: 44px; padding: 0; font-size: 16px; }
    .heading { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; min-height: 44px; }
    .heading-text { flex: 1; min-width: 0; }
    .metadata { display: flex; flex-wrap: wrap; gap: 2px 6px; }
    .metadata p + p::before { content: "·"; margin-right: 6px; }
    .icon { flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; font-size: 24px;
      color: var(--primary-color, #03a9f4); background: var(--secondary-background-color, #f5f7f9);
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent); }
    .child .icon { background: var(--ha-card-background, var(--card-background-color, #fff)); }
    h2 { font-size: 15px; font-weight: 500; line-height: 1.35; margin: 0; overflow-wrap: anywhere; }
    p { margin: 0; font-size: 12px; line-height: 1.4; }
    .state, .description, .instruction, .pending { color: var(--secondary-text-color, #666); }
    .sliders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 12px; row-gap: 0; }
    .slider { min-width: 0; display: flex; flex-direction: column; }
    .slider-label { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 44px; gap: 4px; }
    .slider-label label { min-width: 0; font-size: 12px; line-height: 1.4; color: var(--secondary-text-color, #666); overflow-wrap: anywhere; }
    .target-label { display: block; font-size: 11px; }
    .slider-values { display: flex; align-items: center; min-width: 0; gap: 4px; }
    output { min-width: 0; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    input { min-width: 0; box-sizing: border-box; width: 100%; margin: 0; height: 44px; min-height: 44px; color: inherit; accent-color: var(--primary-color, #03a9f4); cursor: pointer; }
    input:disabled { cursor: default; opacity: 0.5; }
    input.unknown::-webkit-slider-thumb { visibility: hidden; }
    input.unknown::-moz-range-thumb { visibility: hidden; }
    .description, .instruction { overflow-wrap: anywhere; }
    .description:empty, .instruction:empty { display: none; }
    .control-details > :not(.sr-only):not(:empty) { margin-top: 4px; }
    .slats { flex: none; width: 32px; height: 40px; fill: var(--primary-color, #03a9f4); }
    .buttons { display: flex; gap: 8px; margin-top: 8px; }
    button { flex: 1; min-height: 44px; min-width: 0; padding: 6px 4px; border-radius: 9px;
      border: 1px solid var(--divider-color, #ccc); background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .buttons button { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px;
      border-color: transparent; background: var(--secondary-background-color, #f5f7f9); }
    .child .buttons button { background: transparent; border-color: var(--divider-color, #ccc); }
    .button-symbol { font-size: 16px; line-height: 1; }
    .stop { font-weight: 500; }
    .stop .button-symbol { color: var(--primary-color, #03a9f4); }
    button:disabled { opacity: 0.45; cursor: default; }
    button:not(:disabled):hover { background: var(--secondary-background-color, #f2f2f2); }
    input:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .error { margin-top: 8px; color: var(--primary-text-color, #212121);
      color: color-mix(in srgb, var(--error-color, #db4437) 60%, var(--primary-text-color, #212121)); overflow-wrap: anywhere; }
    .pending { margin-top: 8px; }
    .progress { margin-top: 6px; overflow-wrap: anywhere; }
    .progress:empty { margin: 0; }
    .progress-axis { font-weight: 500; margin-bottom: 2px; }
    .progress-values { color: var(--secondary-text-color, #666); font-size: 12px; }
    .progress-heading { margin-top: 6px; font-size: 12px; font-weight: 500; }
    .member-name { color: var(--primary-text-color, #212121); font-weight: 500; }
    .progress-state, .stop-progress, .ha-motion { margin-top: 4px; }
    .member-progress { padding-left: 16px; margin: 4px 0 0; font-size: 12px; line-height: 1.5; }
    .ha-motion { margin-bottom: 8px; }
    .transport { margin-top: 8px; color: var(--secondary-text-color, #666); font-size: 12px; overflow-wrap: anywhere; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @supports (grid-template-rows: subgrid) {
      .sliders { grid-template-rows: minmax(44px, auto) 44px; grid-auto-rows: minmax(44px, auto); }
      .slider { display: grid; grid-template-rows: subgrid; grid-row: span 2; row-gap: 0; }
      .slider-label { grid-row: 1; }
      input { grid-row: 2; }
    }
    @container blind-card (max-width: 315px) { .sliders { grid-template-columns: minmax(0, 1fr); } }
    .motion-icon { display: inline-block; color: var(--primary-color, #03a9f4); animation: motion-pulse 1s ease-in-out infinite alternate; }
    @keyframes motion-pulse { from { opacity: 0.45; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .motion-icon { animation: none; } }
  `;
}

if (!customElements.get("advanced-blind-card")) {
  customElements.define("advanced-blind-card", AdvancedBlindCard);
}
