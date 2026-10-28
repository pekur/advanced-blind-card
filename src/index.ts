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
  barPresentation,
  compactProgress,
  failedResult,
  lamellaWidth,
  quietResult,
  routineProgress,
} from "./presentation.ts";
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
  detailsOpen?: boolean;
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
  private menuView: View | undefined;
  private menuFocus = false;
  private topLayerMenu: HTMLElement | undefined;
  private sizeObserver: ResizeObserver | undefined;
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
    this.closeMenu();
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
    window.addEventListener("pointerdown", this.dismissMenu, true);
    window.addEventListener("keydown", this.menuEscape, true);
    window.addEventListener("resize", this.menuMoved);
    window.addEventListener("scroll", this.menuMoved, true);
    if (typeof ResizeObserver !== "undefined") {
      this.sizeObserver = new ResizeObserver(this.inlineResized);
      this.sizeObserver.observe(this);
    }
  }
  disconnectedCallback() {
    this.sizeObserver?.disconnect();
    this.sizeObserver = undefined;
    window.removeEventListener("pointerup", this.releasePointer);
    window.removeEventListener("pointercancel", this.cancelPointer);
    window.removeEventListener("pointerdown", this.newPointerSequence, true);
    window.removeEventListener("pointermove", this.checkPointerButtons);
    window.removeEventListener("blur", this.cancelInteraction);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    window.removeEventListener("pointerdown", this.dismissMenu, true);
    window.removeEventListener("keydown", this.menuEscape, true);
    window.removeEventListener("resize", this.menuMoved);
    window.removeEventListener("scroll", this.menuMoved, true);
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
    this.closeMenu();
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
      html`<ha-card lang=${this.hass?.language?.toLowerCase().split(/[-_]/)[0] === "cs" ? "cs" : "en"}>${this.views.map((view) => this.row(view))}</ha-card>${this.menuView ? keyed(`${this.menuView.id}-${this.menuView.controller.revision}`, this.actionMenu(this.menuView)) : nothing}`,
    );
  }
  private row(view: View): ReturnType<typeof keyed> {
    const controller = view.controller;
    const inline = view.settings.layout === "inline";
    const group =
      controller instanceof GroupController ? controller : undefined;
    const revision = controller.revision;
    const generation = this.generation;
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
    const heading = html`<span class="icon" aria-hidden="true">▤</span><div class="heading-text">
        ${view.settings.showName ? html`<h2>${this.nameFor(view)}</h2>` : nothing}
        <div class="metadata">
        ${view.settings.showState || !this.healthyIdle(view) ? html`<p class="state entity-state" role="status">${state}</p>` : nothing}
        ${group && (!inline || (!view.settings.showState && this.healthyIdle(view))) ? html`<p class="state">${this.t("covers", { count: view.members.length })}</p>` : nothing}
        </div>
        ${inline ? this.compactStatus(view) : nothing}
      </div>`;
    const inlineHeading = html`<div class="heading">${heading}<button class="heading-details" type="button" aria-expanded=${String(!!view.detailsOpen)} aria-controls=${`${view.id}-details`} aria-label=${`${this.nameFor(view)} · ${this.t("progressDetails")}`}
      @pointerdown=${(event: PointerEvent) => {
        if (this.current(view, generation, revision, event))
          this.prepareMenu(view);
      }} @click=${(event: MouseEvent) => {
        if (!this.current(view, generation, revision, event)) return;
        this.prepareMenu(view);
        view.detailsOpen = !view.detailsOpen;
        this.requestUpdate();
      }}><span class="detail-cue" aria-hidden="true">${view.detailsOpen ? "⌄" : "›"}</span></button></div>`;
    const expand = group && view.expandable ? this.expandButton(view) : nothing;
    const sliders = keyed(
      view.inputRevision,
      html`<div class="sliders">${this.slider(view, "position", this.t("position"))}${this.slider(view, "tilt", this.t("tilt"))}</div>`,
    );
    const transport = group?.results.length
      ? html`<details class="transport"><summary>${this.t("responses")}</summary><p class="state">${this.t("result", { accepted: group.results.filter((r) => r.status === "accepted").length, failed: group.results.filter((r) => r.status === "failed").length, skipped: group.results.filter((r) => r.status === "skipped").length })}</p></details>`
      : nothing;
    const details = html`${this.movement(view)}
      ${inline ? nothing : sliders}
      ${this.controlDetails(view)}
      ${(["position", "tilt"] as const).map((axis) => html`<div id=${`${this.axisId(view, axis)}-progress`} class="progress" data-progress-axis=${axis}>${this.axisProgress(view, axis, this.report(view, axis))}</div>`)}`;
    return keyed(
      `${view.id}-${revision}`,
      html`<section class=${`row${view.parent ? " child" : ""}${inline ? " inline" : ""}`} data-row=${view.id} data-layout=${view.settings.layout} aria-label=${this.nameFor(view)}>
      ${inline ? html`<div class="inline-grid">${inlineHeading}${sliders}<div class="inline-actions">${view.settings.showButtons ? html`<div class="inline-arrows">${this.button(view, "open", this.t("open"), "↑", false, true)}${this.button(view, "close", this.t("close"), "↓", false, true)}</div>${this.menuButton(view)}` : nothing}${this.stopButton(view)}${expand}</div></div>` : html`<div class="heading">${heading}${expand}</div>`}
      ${
        inline && group && view.settings.showValues
          ? (["position", "tilt"] as const).map((axis) => {
              const known = group.members
                .map((member) => {
                  const entity = entityFor(member.snapshot);
                  return member.hass?.connected &&
                    entity &&
                    ["open", "closed", "opening", "closing"].includes(
                      entity.state,
                    )
                    ? member.reported(axis)
                    : null;
                })
                .filter((value): value is number => value !== null);
              return known.length !== group.members.length ||
                (known.length > 1 && Math.min(...known) !== Math.max(...known))
                ? html`<p class="inline-mixed-report">${this.t(axis === "position" ? "position" : "shortTilt")}: ${this.report(view, axis)}</p>`
                : nothing;
            })
          : nothing
      }
      ${inline ? html`<div id=${`${view.id}-details`} ?hidden=${!view.detailsOpen}>${details}${transport}</div>` : details}
      ${
        inline
          ? nothing
          : html`<div class="buttons">${view.settings.showButtons ? this.button(view, "open", this.t("open"), "↑") : nothing}
        ${this.stopButton(view)}${view.settings.showButtons ? this.button(view, "close", this.t("close"), "↓") : nothing}</div>`
      }
      ${controller.pending && !inline ? html`<p class="pending" role="status">${this.t("sending")}</p>` : nothing}
      ${controller.error ? html`<p class="error" role="alert">${controller.errorText(this.hass?.language)}</p>` : nothing}
      ${group && !view.expanded ? view.members.filter((member) => member.controller.error).map((member) => html`<p class="error" role="alert">${this.nameFor(member)}: ${member.controller.errorText(this.hass?.language)}</p>`) : nothing}
      ${this.stopProgress(view)}
      ${inline ? nothing : transport}
      ${group && view.expandable ? html`<div class="members" id=${`${view.id}-members`}>${view.expanded ? view.members.map((member) => this.row(member)) : nothing}</div>` : nothing}
    </section>`,
    );
  }
  private expandButton(view: View) {
    const generation = this.generation,
      revision = view.controller.revision;
    return html`<button class="expand" type="button" aria-expanded=${String(view.expanded)}
      aria-controls=${`${view.id}-members`} aria-label=${`${this.t(view.expanded ? "collapse" : "expand")} ${this.nameFor(view)}`}
      @pointerdown=${(event: PointerEvent) => {
        if (this.current(view, generation, revision, event))
          this.cancelRelated(view);
      }} @click=${(event: MouseEvent) => {
        if (!this.current(view, generation, revision, event)) return;
        this.closeMenu();
        this.cancelRelated(view);
        (event.currentTarget as HTMLButtonElement).focus({
          preventScroll: true,
        });
        view.expanded = !view.expanded;
        this.requestUpdate();
      }}>${view.expanded ? "▴" : "▾"}</button>`;
  }
  private closeMenu(focus = false) {
    const view = this.menuView;
    if (!view) return;
    this.menuView = undefined;
    this.menuFocus = false;
    if (this.topLayerMenu) {
      try {
        this.topLayerMenu.hidePopover();
      } catch {
        /* Already removed. */
      }
      this.topLayerMenu = undefined;
    }
    if (focus) this.focusInlineAction(view.id);
    this.requestUpdate();
  }
  private dismissMenu = (event: PointerEvent) => {
    if (!this.menuView) return;
    const menu = this.shadowRoot?.getElementById("action-menu");
    const trigger = this.shadowRoot?.getElementById(
      `${this.menuView.id}-menu-toggle`,
    );
    const path = event.composedPath();
    if (
      !path.includes(menu as EventTarget) &&
      !path.includes(trigger as EventTarget)
    )
      this.closeMenu();
  };
  private menuEscape = (event: KeyboardEvent) => {
    if (this.menuView && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu(true);
    }
  };
  private menuMoved = () => {
    this.positionMenu();
  };
  private focusInlineAction(id: string) {
    if (!this.isConnected || document.hidden || !document.hasFocus()) return;
    const buttons = this.shadowRoot
      ?.querySelector(`[data-row="${id}"]`)
      ?.querySelectorAll<HTMLButtonElement>(
        ":scope > .inline-grid .inline-actions button",
      );
    [...(buttons ?? [])]
      .find((button) => !button.disabled && button.getClientRects().length)
      ?.focus({ preventScroll: true });
  }
  private inlineResized = () => {
    const focused = this.shadowRoot?.activeElement as HTMLElement | null;
    if (
      focused?.matches(".inline-arrow, .menu-toggle") &&
      !focused.getClientRects().length
    ) {
      const id = focused.closest<HTMLElement>("[data-row]")?.dataset.row;
      if (id) this.focusInlineAction(id);
    }
    this.positionMenu();
  };
  protected updated() {
    this.positionMenu();
  }
  private positionMenu() {
    const view = this.menuView;
    if (!view || !this.isConnected) return;
    const trigger = this.shadowRoot?.getElementById(`${view.id}-menu-toggle`);
    const menu = this.shadowRoot?.getElementById("action-menu");
    if (!trigger || !menu || (view.parent && !view.parent.expanded)) {
      this.closeMenu();
      return;
    }
    if (!trigger.getClientRects().length) {
      this.closeMenu(true);
      return;
    }
    if (menu.hasAttribute("popover") && this.topLayerMenu !== menu) {
      try {
        menu.showPopover();
        this.topLayerMenu = menu;
      } catch {
        menu.removeAttribute("popover");
      }
    }
    const anchor = trigger.getBoundingClientRect(),
      box = menu.getBoundingClientRect();
    const gap = 6,
      edge = 4;
    const left = Math.max(
      edge,
      Math.min(anchor.right - box.width, window.innerWidth - box.width - edge),
    );
    const below = anchor.bottom + gap;
    const above = Math.max(edge, anchor.top - box.height - gap);
    let top = below + box.height <= window.innerHeight - edge ? below : above;
    let x = left;
    const stops = [
      ...(this.shadowRoot?.querySelectorAll<HTMLButtonElement>("button.stop") ??
        []),
    ]
      .filter((button) => button.getClientRects().length)
      .map((button) => button.getBoundingClientRect());
    const intersects = (a: number, b: number) =>
      stops.some(
        (stop) =>
          Math.min(a + box.width, stop.right) > Math.max(a, stop.left) &&
          Math.min(b + box.height, stop.bottom) > Math.max(b, stop.top),
      );
    if (intersects(x, top)) {
      const options = [top, top === below ? above : below].filter(
        (y) => y >= edge && y + box.height <= window.innerHeight - edge,
      );
      for (const y of options) {
        const obstruction = stops.filter(
          (stop) => stop.bottom > y && stop.top < y + box.height,
        );
        const shifted = Math.max(
          edge,
          Math.min(
            left,
            ...obstruction.map((stop) => stop.left - box.width - gap),
          ),
        );
        if (!intersects(shifted, y)) {
          x = shifted;
          top = y;
          break;
        }
      }
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${top}px`;
    if (this.topLayerMenu !== menu) {
      // A transformed ancestor changes the fixed fallback's coordinate system.
      const placed = menu.getBoundingClientRect();
      const scaleX = placed.width / menu.offsetWidth || 1;
      const scaleY = placed.height / menu.offsetHeight || 1;
      menu.style.left = `${x + (x - placed.left) / scaleX}px`;
      menu.style.top = `${top + (top - placed.top) / scaleY}px`;
    }
    if (this.menuFocus) {
      this.menuFocus = false;
      (
        menu.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menu
      ).focus({ preventScroll: true });
    }
  }
  private menuButton(view: View) {
    const generation = this.generation,
      revision = view.controller.revision;
    return html`<button type="button" class="menu-toggle" id=${`${view.id}-menu-toggle`}
      aria-label=${`${this.t("moreActions")} — ${this.nameFor(view)}`} aria-haspopup="menu"
      aria-expanded=${String(this.menuView === view)} aria-controls=${this.menuView === view ? "action-menu" : nothing}
      @pointerdown=${(event: PointerEvent) => {
        if (
          this.current(view, generation, revision, event) &&
          (event.currentTarget as HTMLElement).getClientRects().length
        )
          this.prepareMenu(view);
      }} @click=${(event: MouseEvent) => {
        if (
          !this.current(view, generation, revision, event) ||
          !(event.currentTarget as HTMLElement).getClientRects().length
        )
          return;
        this.prepareMenu(view);
        if (this.menuView === view) this.closeMenu(true);
        else {
          this.closeMenu();
          this.menuView = view;
          this.menuFocus = true;
          this.requestUpdate();
        }
      }}>⋮</button>`;
  }
  private prepareMenu(view: View) {
    // Opening an auxiliary menu must not commit another row's keyboard edit on blur.
    for (const editing of this.allViews())
      if (editing.controller.draft || this.pointer?.view === editing)
        this.cancelView(editing);
    this.cancelRelated(view);
  }
  private actionMenu(view: View) {
    return html`<div id="action-menu" class="action-menu" role="menu" tabindex="-1"
      lang=${this.hass?.language?.toLowerCase().split(/[-_]/)[0] === "cs" ? "cs" : "en"}
      popover=${typeof HTMLElement.prototype.showPopover === "function" ? "manual" : nothing}
      aria-label=${`${this.t("moreActions")} — ${this.nameFor(view)}`}
      @focusout=${(event: FocusEvent) => {
        if (
          event.relatedTarget &&
          !(event.currentTarget as HTMLElement).contains(
            event.relatedTarget as Node,
          )
        )
          this.closeMenu();
      }} @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Tab") {
          this.closeMenu(true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const items = [
          ...(
            event.currentTarget as HTMLElement
          ).querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        if (!items.length) return;
        const at = items.indexOf(
          this.shadowRoot?.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus({ preventScroll: true });
      }}>${this.button(view, "open", this.t("open"), "↑", true)}${this.button(view, "close", this.t("close"), "↓", true)}</div>`;
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
  private axisStatuses(view: View, axis: Axis): ProgressStatus[] {
    const controller = view.controller;
    if (controller instanceof CoverController) {
      const status = controller.progress.status(axis);
      return status ? [status] : [];
    }
    const group = controller.progressFor(axis);
    return controller.members.flatMap((member) => {
      const status =
        member.progress.status(axis) ??
        group?.members.find((entry) => entry.entity === member.config?.entity)
          ?.status;
      return status ? [status] : [];
    });
  }
  private compactStatus(view: View) {
    const controller = view.controller;
    const activeAxes = (["position", "tilt"] as const).filter(
      (axis) =>
        this.axisStatuses(view, axis).some((status) => !quietResult(status)) ||
        this.visibleReason(view, axis),
    );
    return html`<span class="compact-status">
      ${(["position", "tilt"] as const).map((axis) => {
        const groupGoal =
          controller instanceof GroupController
            ? controller.progressFor(axis)
            : undefined;
        const statuses =
          controller instanceof GroupController
            ? (groupGoal?.members.map((member) => member.status) ?? [])
            : this.axisStatuses(view, axis);
        const counts = new Map<string, number>();
        for (const status of statuses) {
          if (
            quietResult(status) ||
            routineProgress(status) ||
            status.code === "replaced"
          )
            continue;
          const visible = failedResult(status)
            ? { ...status, code: "failed" as const }
            : status;
          const label = `${progressSymbol(visible)} ${compactProgress(visible, this.hass?.language)}`;
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        const reason = this.visibleReason(view, axis);
        const extra =
          controller instanceof GroupController &&
          this.report(view, axis) !== this.report(view, axis, true)
            ? this.report(view, axis)
            : "";
        const individual =
          controller instanceof GroupController
            ? controller
                .individualProgressFor(axis)
                .filter((member) => !quietResult(member.status))
            : [];
        const individualCounts = new Map<string, number>();
        for (const member of individual) {
          const status = failedResult(member.status)
            ? { ...member.status, code: "failed" as const }
            : member.status;
          const ordinary = routineProgress(status);
          const label = `${status.pending && ordinary ? "◷" : progressSymbol(status)} ${ordinary ? "" : `${compactProgress(status, this.hass?.language)} · `}→ ${status.target}%`;
          individualCounts.set(label, (individualCounts.get(label) ?? 0) + 1);
        }
        const targets = [...individualCounts]
          .map(([label, count]) => `${count}/${view.members.length} ${label}`)
          .join(" · ");
        const messages = [
          reason,
          extra,
          groupGoal?.target !== undefined &&
          statuses.some((status) =>
            ["skipped", "replaced"].includes(status.code),
          ) &&
          statuses.some(
            (status) => status.code !== "replaced" && !quietResult(status),
          )
            ? `${progressLabels(this.hass?.language).groupTarget}: ${groupGoal.target}%`
            : "",
          ...[...counts].map(
            ([label, count]) =>
              `${statuses.length > 1 ? `${count}/${statuses.length} ` : ""}${label}`,
          ),
          targets,
        ].filter(Boolean);
        return messages.length
          ? html`<span class="compact-axis" role="status" aria-live="polite"><span class=${activeAxes.length === 1 ? "sr-only" : nothing}>${this.t(axis === "position" ? "position" : "shortTilt")}: </span>${messages.join(" · ")}</span>`
          : nothing;
      })}
      ${!this.visualFor(view) ? html`<span class="compact-axis" title=${this.t("differentMaps")}>? ${this.t("mixedVisual")}</span>` : nothing}
    </span>`;
  }
  private visibleReason(view: View, axis: Axis) {
    return ["waiting", "groupWaiting"].includes(
      view.controller.reasonKey(axis) ?? "",
    )
      ? null
      : view.controller.reason(axis, this.hass?.language);
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
    const quiet =
      view.settings.layout === "inline" &&
      !controller.draft &&
      !controller.pending &&
      details.every(
        (detail) =>
          !detail.reason &&
          !detail.extra &&
          (!group ||
            group.members.every((member) => !member.reason(detail.axis))),
      );
    const mapReason = !this.visualFor(view) ? this.t("differentMaps") : "";
    return html`<div class="control-details">
      ${details.map((detail) => html`<p id=${`${this.axisId(view, detail.axis)}-description`} class=${`description${visible(detail) ? "" : " sr-only"}${detail.chosen ? " draft-values" : ""}`}>${detail.text ? `${this.t(detail.axis === "position" ? "position" : "tilt")}: ${detail.text}` : nothing}</p>`)}
      ${mapReason ? html`<p id=${`${this.axisId(view, "tilt")}-visual`} class="description map-reason">${mapReason}</p>` : nothing}
      <p id=${`${view.id}-instruction`} class=${`instruction${quiet ? " sr-only" : ""}`}>${instruction}</p>
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
    const inline = view.settings.layout === "inline";
    const members =
      controller instanceof GroupController ? controller.members : [controller];
    const values = members.map((member) => {
      const entity = entityFor(member.snapshot);
      return member.hass?.connected &&
        entity &&
        ["open", "closed", "opening", "closing"].includes(entity.state)
        ? member.reported(axis)
        : null;
    });
    const statuses = this.axisStatuses(view, axis);
    const bar = barPresentation(
      values,
      statuses,
      draft ? (value ?? undefined) : undefined,
    );
    const attention = statuses.filter((status) => !quietResult(status));
    const status =
      attention.find(failedResult) ??
      attention.find((status) =>
        [
          "unconfirmed",
          "unknown",
          "unavailable",
          "unsupported",
          "interrupted",
          "skipped",
        ].includes(status.code),
      ) ??
      attention.find((status) => status.pending) ??
      attention.find((status) => status.code === "moving") ??
      attention[0];
    const visibleStatus =
      status && failedResult(status)
        ? { ...status, code: "failed" as const }
        : status;
    const indicator = draft
      ? "◇"
      : bar.uncertain || mapReason
        ? "?"
        : visibleStatus?.pending && routineProgress(visibleStatus)
          ? "◷"
          : visibleStatus
            ? progressSymbol(visibleStatus)
            : bar.min !== bar.max
              ? "↔"
              : "";
    const indicatorText = draft
      ? this.t("preview")
      : mapReason ||
        (bar.uncertain
          ? this.t("unknown")
          : visibleStatus
            ? progressText(visibleStatus, this.hass?.language)
            : this.t("mixedReadings"));
    const targetForAria = inline
      ? bar.target
      : chosen
        ? (value ?? undefined)
        : undefined;
    const inputClass = [
      !chosen && reported === null ? "unknown" : "",
      inline && draft ? "range-editing" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const input = html`<input id=${id} type="range" min="0" max="100" step=${step} class=${inputClass || nothing}
        .value=${untouchedKeyboard ? noChange : live(String(value ?? 0))} ?disabled=${reason !== null}
        aria-label=${this.views.length === 1 && !group && !view.parent ? label : `${this.nameFor(view)} ${group ? this.t("targetAxis", { axis: label }) : label}`}
        aria-valuetext=${group || chosen || targetForAria !== undefined ? `${targetForAria !== undefined ? `${this.t("target")} ${this.t("percent", { value: targetForAria })}${draft ? ` ${this.t("preview")}` : ""}` : this.t("noTarget")}. ${this.t("reported")}: ${report}` : value === null ? this.t("unknown") : this.t("percent", { value })}
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
        }} />`;
    const targetPosition =
      bar.target === undefined ? 0 : Math.min(100, Math.max(0, bar.target));
    const reportWidth = bar.target === undefined ? 8 : 2;
    const angleUnknown = axis === "tilt" && (!visual || bar.uncertain);
    return html`<section class="slider" aria-label=${label}>
      <div class="slider-label"><label for=${id}>${visibleLabel}${group ? html`<span class=${`target-label${inline ? " sr-only" : ""}`}>${this.t("target")}</span>` : nothing}</label>${inline && indicator ? html`<span class="axis-phase" data-code=${visibleStatus?.code ?? (draft ? "preview" : "mixed")} data-tone=${bar.tone} role="status" aria-label=${indicatorText} title=${indicatorText}>${indicator}</span>` : nothing}<div class="slider-values">${axis === "tilt" && !inline ? this.slats(group && !chosen ? reported : value, visual ?? defaultTiltVisual, mapReason) : nothing}${revealValues ? html`<output aria-live="off" for=${id} title=${inline ? `${this.t("reported")}: ${report}` : nothing}>${inline ? this.report(view, axis, true) : displayValue}</output>` : nothing}${inline && bar.target !== undefined ? html`<span class="inline-target" aria-label=${`${this.t(draft ? "preview" : "target")}: ${bar.target}%`}>→ ${bar.target}%</span>` : nothing}</div></div>
      ${
        inline
          ? html`<div class="range-control" data-axis=${axis} data-tone=${bar.tone} data-uncertain=${String(bar.uncertain)} data-angle-unknown=${String(angleUnknown)} data-active=${String(bar.target !== undefined)}>
        <div class="range-track" aria-hidden="true">
          <span class="range-fill" style=${`width:${bar.min}%`}></span>
          <span class="range-mixed" style=${`inset-inline-start:${bar.min}%;width:${bar.max - bar.min}%`}></span>
          ${axis === "tilt" && !angleUnknown && visual ? html`<span class="range-lamella">${Array.from({ length: 20 }, (_, i) => html`<span style=${`--slat-size:${((lamellaWidth((i / 19) * 100, visual) ?? 0) / 8) * 100}%`}></span>`)}</span>` : nothing}
          ${!bar.uncertain && bar.min === bar.max ? html`<span class="range-report" style=${`width:${reportWidth}px;inset-inline-start:clamp(0px, calc(${bar.min}% - ${reportWidth / 2}px), calc(100% - ${reportWidth}px))`}></span>` : nothing}
          ${bar.target !== undefined && !draft ? html`<span class="range-target" style=${`inset-inline-start:clamp(0px, calc(${targetPosition}% - 4px), calc(100% - 8px))`}></span>` : nothing}
        </div>
        ${input}
      </div>`
          : input
      }
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
    if (view.settings.layout === "inline")
      return this.axisStatuses(view, axis).some(
        (status) => !quietResult(status),
      );
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
  private button(
    view: View,
    action: Action,
    label: string,
    symbol: string,
    inMenu = false,
    compact = false,
  ) {
    const generation = this.generation,
      revision = view.controller.revision;
    const reason = view.controller.reason(action, this.hass?.language);
    const group =
      view.controller instanceof GroupController ? view.controller : undefined;
    return html`<button type="button" class=${compact ? "inline-arrow" : nothing} data-action=${compact ? action : nothing} role=${inMenu ? "menuitem" : nothing} aria-label=${this.views.length === 1 && !group && !view.parent ? label : `${this.nameFor(view)} ${label}`}
      ?disabled=${reason !== null} title=${reason ?? (group ? group.coverage(action, this.hass?.language) : label)} aria-description=${reason ?? (group ? group.coverage(action, this.hass?.language) : "")}
      @pointerdown=${
        compact
          ? (event: PointerEvent) => {
              if (
                this.current(view, generation, revision, event) &&
                (event.currentTarget as HTMLElement).getClientRects().length
              )
                this.prepareMenu(view);
            }
          : nothing
      }
      @click=${(event: MouseEvent) => {
        if (
          this.current(view, generation, revision, event) &&
          ((!compact && !inMenu) ||
            (event.currentTarget as HTMLElement).getClientRects().length) &&
          (!inMenu ||
            (this.menuView === view &&
              this.shadowRoot
                ?.getElementById(`${view.id}-menu-toggle`)
                ?.getClientRects().length))
        ) {
          if (compact) this.prepareMenu(view);
          this.prepare(view);
          void view.controller.perform(action);
          if (inMenu) this.closeMenu(true);
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
          this.closeMenu();
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
    .row.inline { padding:5px; }
    ha-card > .row.inline + .row.inline { margin-top:6px; }
    .inline-grid { display:grid; grid-template-columns:minmax(80px, 96px) minmax(0, 1fr) auto; gap:6px; align-items:center; }
    .inline-grid .heading { position:relative; margin:0; gap:0; min-width:0; }
    .inline-grid .heading-details { position:absolute; inset:0; display:flex; justify-content:flex-end; align-items:center; padding:0; border:0; border-radius:4px; background:transparent; text-align:start; width:calc(100% + 4px); }
    .inline-grid .heading-details:hover { background:transparent; }
    .detail-cue { position:absolute; right:0; width:4px; font-size:12px; color:var(--secondary-text-color, #666); }
    .compact-status { display:block; font-size:11px; line-height:14px; overflow-wrap:anywhere; }
    .compact-axis { display:block; }
    [hidden] { display:none !important; }
    .inline-grid .icon { display:none; }
    .inline-grid h2 { font-size:14px; line-height:18px; }
    .inline-grid .metadata { display:block; }
    .inline-grid .state { font-size:12px; line-height:16px; }
    .inline-grid .sliders { min-width:0; gap:0 8px; grid-template-rows:none; grid-auto-rows:auto; }
    .inline-grid .slider { display:flex; }
    .inline-mixed-report { color:var(--secondary-text-color, #666); font-size:11px; line-height:16px; overflow-wrap:anywhere; }
    .inline-grid .slider-label { display:flex; flex-wrap:nowrap; min-height:16px; align-items:center; gap:0 3px; }
    .inline-grid .slider-label label { font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .inline-grid .slider-label:has(.inline-target) label { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .inline-grid .slider-values { gap:2px; margin-inline-start:auto; min-width:0; overflow:hidden; }
    .inline-grid output { font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .inline-target { font-size:11px; line-height:16px; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .axis-phase { font-size:11px; line-height:16px; color:var(--primary-color, #03a9f4); }
    .axis-phase[data-tone="caution"] { color:var(--warning-color, #a56800); }
    .axis-phase[data-tone="error"] { color:var(--error-color, #db4437); }
    .range-control { position:relative; height:44px; min-width:0; --range-color:var(--primary-color, #03a9f4); }
    .range-control[data-tone="caution"] { --range-color:var(--warning-color, #a56800); }
    .range-control[data-tone="error"] { --range-color:var(--error-color, #db4437); }
    .range-track { position:absolute; inset:8px 0; border-radius:9px; overflow:hidden; background:var(--secondary-background-color, #e5e7eb); box-shadow:inset 0 0 0 1px var(--divider-color, #ccc); pointer-events:none; }
    .range-track::after { content:""; position:absolute; inset:0; z-index:1; pointer-events:none; }
    .range-control[data-active="true"] .range-track::after { background:color-mix(in srgb, var(--range-color) 13%, transparent); }
    .range-fill, .range-mixed { position:absolute; top:0; bottom:0; pointer-events:none; }
    .range-fill { inset-inline-start:0; background:var(--range-color); opacity:.75; }
    .range-mixed { background:repeating-linear-gradient(120deg, var(--range-color) 0 2px, transparent 2px 5px); opacity:.75; }
    .range-lamella { position:absolute; inset:0; display:flex; }
    .range-lamella > span { flex:1 1 0; position:relative; }
    .range-lamella > span::before { content:""; position:absolute; inset-block:0; inset-inline-start:0; width:var(--slat-size, 100%); background:color-mix(in srgb, var(--primary-text-color, #212121) 16%, var(--secondary-background-color, #e5e7eb)); }
    .range-control[data-axis="tilt"] .range-fill { display:none; }
    .range-control[data-axis="tilt"] .range-mixed { z-index:1; opacity:.45; }
    .range-target, .range-report { position:absolute; z-index:2; top:0; bottom:0; box-sizing:border-box; border-radius:8px; border:1px solid #41454a; background:linear-gradient(90deg, #fff 0 2px, #41454a 2px 4px, #fff 4px); }
    .range-target { width:8px; }
    .range-control[data-active="true"] .range-report { border:0; border-radius:1px; background:var(--primary-text-color, #212121); opacity:.7; }
    .range-control[data-uncertain="true"] .range-track, .range-control[data-angle-unknown="true"] .range-track { background:repeating-linear-gradient(120deg, var(--secondary-background-color, #e5e7eb) 0 4px, var(--divider-color, #ccc) 4px 5px); }
    .range-control input { position:relative; z-index:4; appearance:none; -webkit-appearance:none; background:transparent; border:0; border-radius:9px; }
    .range-control input::-webkit-slider-runnable-track { height:28px; background:transparent; border:0; }
    .range-control input::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; height:28px; width:8px; box-sizing:border-box; border:1px solid #41454a; border-radius:8px; background:linear-gradient(90deg, #fff 0 2px, #41454a 2px 4px, #fff 4px); }
    .range-control input::-moz-range-track { height:28px; background:transparent; border:0; }
    .range-control input::-moz-range-thumb { height:28px; width:8px; box-sizing:border-box; border:1px solid #41454a; border-radius:8px; background:#fff; }
    .range-control input:not(.range-editing)::-webkit-slider-thumb { visibility:hidden; }
    .range-control input:not(.range-editing)::-moz-range-thumb { visibility:hidden; }
    .inline-actions { display:flex; gap:6px; align-items:center; }
    .inline-actions button { flex:none; width:44px; min-width:44px; min-height:44px; padding:0; margin:0; border:0;
      background:var(--secondary-background-color, #f5f7f9); }
    .inline-actions .menu-toggle { display:none; font-size:22px; }
    .inline-arrows { display:grid; gap:4px; height:60px; }
    .inline-actions .inline-arrow { height:28px; min-height:28px; font-size:18px; }
    .inline-arrow > span:not(.button-symbol) { display:none; }
    .inline-actions .stop { color:inherit; font-size:11px; }
    .inline-actions .stop .button-symbol { display:none; }
    .inline > .members:not(:empty) { gap:6px; margin:6px 0 0 8px; padding-left:8px; border-left:1px solid var(--divider-color, #ddd); }
    .action-menu { position:fixed; z-index:10; inset:auto; top:0; left:0; margin:0; display:grid; gap:4px; box-sizing:border-box;
      width:144px; max-width:calc(100vw - 8px); padding:4px; border:1px solid var(--divider-color, #ccc); border-radius:10px;
      color:var(--primary-text-color, #212121); background:var(--ha-card-background, var(--card-background-color, #fff)); }
    .action-menu[popover]:not(:popover-open) { display:none; }
    .action-menu button { display:flex; width:100%; min-height:44px; gap:8px; padding:8px; border:0; text-align:start; align-items:center;
      background:var(--secondary-background-color, #f5f7f9); font-size:14px; }
    @container blind-card (max-width:430px) {
      .inline-arrows { display:flex; height:44px; gap:6px; }
      .inline-actions .inline-arrow { height:44px; min-height:44px; }
      .inline-grid { grid-template-columns:minmax(0,1fr) auto; row-gap:0; }
      .inline-grid .heading { grid-column:1; grid-row:1; }
      .inline-grid .inline-actions { grid-column:2; grid-row:1; }
      .inline-grid .sliders { grid-column:1 / -1; grid-row:2; }
    }
    .motion-icon { display: inline-block; color: var(--primary-color, #03a9f4); animation: motion-pulse 1s ease-in-out infinite alternate; }
    @keyframes motion-pulse { from { opacity: 0.45; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .motion-icon { animation: none; } }
  `;
}

if (!customElements.get("advanced-blind-card")) {
  customElements.define("advanced-blind-card", AdvancedBlindCard);
}
