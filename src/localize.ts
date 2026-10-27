const en = {
  layout: "Layout",
  detailed: "Detailed",
  inline: "Inline / row",
  layoutHelp:
    "Inline keeps sliders and STOP in the row. Open / Close are in the actions menu. Groups expand directly to members.",
  layoutInvalid: "{path} must be detailed or inline.",
  moreActions: "More actions",
  position: "Position",
  tilt: "Slat tilt",
  shortTilt: "Tilt",
  up: "Open",
  down: "Close",
  releaseShort: "Release to send",
  open: "Open / up",
  close: "Close / down",
  stop: "Stop",
  stopHelp: "Stop supported lift and tilt movement",
  expand: "Expand",
  collapse: "Collapse",
  group: "Group ({count} covers)",
  covers: "{count} covers",
  cover: "Cover",
  configure: "Configure covers in blinds.",
  sending: "Sending command…",
  target: "Target",
  targetAxis: "{axis} target",
  noTarget: "No target selected",
  reported: "Reported",
  unknown: "Unknown",
  percent: "{value} percent",
  preview: "preview — not sent",
  requested: "requested",
  release: "Adjust, then release to send.",
  differentMaps:
    "Members have different visual settings; no common angle is defined.",
  unknownAngle: "Slat angle unknown",
  slatPreview: "Illustrative slat preview at {value} percent",
  responses: "Service responses — physical completion unconfirmed",
  result:
    "Last group action: {accepted} commands accepted by HA; {failed} failed; {skipped} skipped.",
  coverage: "Controls {eligible} of {total}",
  unknownCount: "{count} unknown",
  unavailableCount: "{count} unavailable",
  unsupportedCount: "{count} unsupported",
  disconnected: "disconnected",
  missing: "missing",
  openState: "open",
  closedState: "closed",
  openingState: "opening",
  closingState: "closing",
  unavailableState: "unavailable",
  unknownState: "unknown",
  notConfigured: "Card is not configured.",
  notAttached: "Card is not connected.",
  haDisconnected: "Home Assistant is disconnected.",
  entityMissing: "Entity not found.",
  entityUnavailable: "Entity is unavailable.",
  stateUnknown: "Entity state is unknown.",
  unsupported: "Not supported by this cover.",
  serviceUnavailable: "Home Assistant service is unavailable.",
  valueUnknown: "Current value is unknown.",
  stopSending: "Sending stop command…",
  waiting: "Waiting for a command response.",
  groupWaiting: "Waiting for a group command response.",
  noMembers: "No eligible group members.",
  cancelled: "Operation cancelled.",
  stopUnavailable: "Stop is unavailable.",
  changed: "Card configuration or operation changed.",
  notDispatched: "Command was not dispatched.",
  targetInvalid: "Target must be an integer from 0 to 100.",
  singleRequired: "A cover controller requires one single cover.",
  boolean: "{path} must be a boolean.",
  object: "{path} must be an object.",
  option: "Unsupported {path} option: {key}.",
  mode: "{path}.mode must be single or bidirectional.",
  angle: "{path} must be a finite number from -90 to 90.",
  bounds:
    "{path}.tilt_visual.max_angle must exceed min_angle after inheritance.",
  type: "Expected type: custom:advanced-blind-card.",
  rows: "blinds must contain at least one row.",
  name: "{path}.name must be a nonempty string.",
  entity: "{path}.entity must be a cover entity ID.",
  duplicate: "{path}.entity duplicates {entity}.",
  both: "{path} must use either entity or entities, not both.",
  members: "{path}.entities requires at least two members.",
  editorIntro:
    "Global options only. Edit covers, groups and member overrides in YAML; their settings are preserved.",
  buttons: "Show Open / Close buttons (supported STOP remains visible)",
  names: "Show names",
  states: "Show ordinary idle states",
  values: "Show ordinary idle values",
  visual: "Slat illustration",
  modeLabel: "Tilt mode",
  single: "Single direction",
  bidirectional: "Both directions",
  min: "Minimum angle (°)",
  max: "Maximum angle (°)",
  invert: "Invert illustration only",
  visualHelp:
    "0° is horizontal. These options never change HA percentages or motor commands. Row and member overrides take precedence.",
  default: "Default",
  yes: "Yes",
  no: "No",
  invalidYaml: "Correct the configuration in YAML to use this editor.",
  numeric: "{path} must be a complete number.",
  steps: "Slider steps",
  positionStep: "Position step (%)",
  tiltStep: "Tilt step (%)",
  stepHelp:
    "Target steps only; reported values stay exact. Defaults to 10%. Row and member overrides take precedence.",
  stepInvalid: "{path} must be one of: 1, 2, 4, 5, 10, 20, 25, 50, 100.",
} as const;

const cs: Record<keyof typeof en, string> = {
  layout: "Rozložení",
  detailed: "Podrobné",
  inline: "Řádkové",
  layoutHelp:
    "Řádkové zobrazení ponechá posuvníky a STOP v řádku. Nahoru / Dolů jsou v menu příkazů. Skupina přímo rozbalí členy.",
  layoutInvalid: "{path} musí být detailed nebo inline.",
  moreActions: "Další příkazy",
  steps: "Kroky posuvníků",
  positionStep: "Krok polohy (%)",
  tiltStep: "Krok náklonu (%)",
  stepHelp:
    "Kroky pouze pro volbu cíle; hlášené hodnoty zůstávají přesné. Výchozí krok je 10 %. Nastavení řádků a členů má přednost.",
  stepInvalid:
    "{path} musí být jedna z hodnot: 1, 2, 4, 5, 10, 20, 25, 50, 100.",
  position: "Poloha",
  tilt: "Náklon lamel",
  shortTilt: "Náklon",
  up: "Nahoru",
  down: "Dolů",
  releaseShort: "Uvolněním odeslat",
  open: "Otevřít / nahoru",
  close: "Zavřít / dolů",
  stop: "Stop",
  stopHelp: "Zastavit podporovaný pohyb výšky a náklonu",
  expand: "Rozbalit",
  collapse: "Sbalit",
  group: "Skupina ({count} žaluzií)",
  covers: "Počet žaluzií: {count}",
  cover: "Žaluzie",
  configure: "Nastavte žaluzie v blinds.",
  sending: "Odesílání příkazu…",
  target: "Cíl",
  targetAxis: "{axis} — cíl",
  noTarget: "Cíl není vybrán",
  reported: "Hlášeno",
  unknown: "Neznámé",
  percent: "{value} procent",
  preview: "náhled — neodesláno",
  requested: "požadováno",
  release: "Upravte a uvolněním odešlete.",
  differentMaps:
    "Členové mají různá vizuální nastavení; společný úhel není určen.",
  unknownAngle: "Úhel lamel není známý",
  slatPreview: "Ilustrační náhled lamel při {value} procentech",
  responses: "Odpovědi služeb — nepotvrzují fyzické dokončení",
  result:
    "Poslední skupinová akce: HA přijalo {accepted} příkazů; selhalo {failed}; vynecháno {skipped}.",
  coverage: "Ovládá {eligible} z {total}",
  unknownCount: "Neznámé: {count}",
  unavailableCount: "Nedostupné: {count}",
  unsupportedCount: "Nepodporované: {count}",
  disconnected: "odpojeno",
  missing: "chybí",
  openState: "Otevřeno",
  closedState: "Zavřeno",
  openingState: "Otevírání",
  closingState: "Zavírání",
  unavailableState: "Nedostupné",
  unknownState: "Neznámé",
  notConfigured: "Karta není nastavená.",
  notAttached: "Karta není připojená.",
  haDisconnected: "Home Assistant je odpojený.",
  entityMissing: "Entita nebyla nalezena.",
  entityUnavailable: "Entita je nedostupná.",
  stateUnknown: "Stav entity není známý.",
  unsupported: "Tato žaluzie funkci nepodporuje.",
  serviceUnavailable: "Služba Home Assistant není dostupná.",
  valueUnknown: "Aktuální hodnota není známá.",
  stopSending: "Odesílání příkazu STOP…",
  waiting: "Čekání na odpověď příkazu.",
  groupWaiting: "Čekání na odpověď skupinového příkazu.",
  noMembers: "Žádný člen skupiny nemůže příkaz provést.",
  cancelled: "Operace zrušena.",
  stopUnavailable: "STOP není dostupný.",
  changed: "Nastavení karty nebo operace se změnily.",
  notDispatched: "Příkaz nebyl odeslán.",
  targetInvalid: "Cíl musí být celé číslo od 0 do 100.",
  singleRequired: "Ovladač vyžaduje právě jednu samostatnou žaluzii.",
  boolean: "{path} musí být true nebo false.",
  object: "{path} musí být objekt.",
  option: "Nepodporovaná volba v {path}: {key}.",
  mode: "{path}.mode musí být single nebo bidirectional.",
  angle: "{path} musí být konečné číslo od -90 do 90.",
  bounds:
    "{path}.tilt_visual.max_angle musí být po dědění větší než min_angle.",
  type: "Očekávaný type: custom:advanced-blind-card.",
  rows: "blinds musí obsahovat alespoň jeden řádek.",
  name: "{path}.name musí být neprázdný text.",
  entity: "{path}.entity musí být ID entity cover.",
  duplicate: "{path}.entity opakuje {entity}.",
  both: "{path} musí používat entity nebo entities, nikoli obojí.",
  members: "{path}.entities vyžaduje alespoň dva členy.",
  editorIntro:
    "Pouze globální volby. Žaluzie, skupiny a přepisy členů upravujte v YAML; jejich nastavení zůstane zachováno.",
  buttons: "Zobrazit Otevřít / Zavřít (podporovaný STOP zůstává viditelný)",
  names: "Zobrazit názvy",
  states: "Zobrazit běžné klidové stavy",
  values: "Zobrazit běžné klidové hodnoty",
  visual: "Ilustrace lamel",
  modeLabel: "Režim náklonu",
  single: "Jednosměrný",
  bidirectional: "Obousměrný",
  min: "Minimální úhel (°)",
  max: "Maximální úhel (°)",
  invert: "Invertovat pouze ilustraci",
  visualHelp:
    "0° znamená vodorovné lamely. Tyto volby nemění procenta HA ani příkazy motorům. Přepisy řádků a členů mají přednost.",
  default: "Výchozí",
  yes: "Ano",
  no: "Ne",
  invalidYaml: "Pro použití editoru opravte konfiguraci v YAML.",
  numeric: "{path} musí být úplné číslo.",
};

export type MessageKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;
export interface Message {
  readonly key: MessageKey;
  readonly params?: Params;
}
export type Notice = Message | string;
export function languageCode(language?: string): "cs" | "en" {
  return language?.toLowerCase().split(/[-_]/)[0] === "cs" ? "cs" : "en";
}
export function text(key: MessageKey, language?: string, params: Params = {}) {
  const dictionary = languageCode(language) === "cs" ? cs : en;
  return dictionary[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
export function notice(key: MessageKey, params?: Params): Message {
  return { key, params };
}
export function noticeText(value: Notice, language?: string): string {
  return typeof value === "string"
    ? value
    : text(value.key, language, value.params);
}
export class MessageError extends Error {
  readonly detail: Message;
  constructor(key: MessageKey, params?: Params) {
    super(text(key, undefined, params));
    this.detail = notice(key, params);
  }
}
export function errorNotice(error: unknown): Notice {
  if (error instanceof MessageError) return error.detail;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error);
}
export function stateText(state: string, language?: string) {
  const keys: Record<string, MessageKey> = {
    open: "openState",
    closed: "closedState",
    opening: "openingState",
    closing: "closingState",
    unavailable: "unavailableState",
    unknown: "unknownState",
  };
  return Object.hasOwn(keys, state)
    ? text(keys[state] as MessageKey, language)
    : state;
}
