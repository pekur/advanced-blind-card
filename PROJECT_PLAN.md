# Advanced Blind Card — plán projektu a předání do Codex CLI

Datum: 2026-10-23  
Zamýšlené umístění: `C:\_Projects\HA-advanced-blind-card`  
Typ: samostatná open-source custom Lovelace karta pro Home Assistant, distribuovatelná přes HACS.

## 1. Zadání a rozhodnutí

Vytvořit kompaktní kartu pro venkovní žaluzie, která přímo v dashboardu umožňuje ovládání **výšky** a **náklonu lamel** bez otevření dialogu More Info. Vodorovné posuvníky jsou vyhovující. Náklon má mít grafickou stupnici a živě zobrazovat aktuálně volenou či hlášenou hodnotu. Vzhled má respektovat standardní HA tile kartu, světlé/tmavé téma a mobilní rozložení.

Karta musí podporovat jak jedinou `cover` entitu, tak **logicky sdruženou žaluzii tvořenou dvěma nebo více samostatnými motory**. Sdružený řádek se běžně chová jako jedna žaluzie; lze jej rozbalit a ovládat každou entitu samostatně. Rozbalení nemění stav motorů.

Aktuální domácí případ: šest hlavních řádků, z nichž „Obývák – jih“ obsahuje dvě samostatné žaluzie/portály (L a P). Motory podporují vytažení a jednosměrný náklon. Open-source řešení však musí umožnit konfigurovat i obousměrný náklon, invertování a rozdílnou orientaci jednotlivých zařízení.

Zachovat tlačítka **nahoru / stop / dolů**, praktické zvláště při rozjezdu pohybu. Nechť jsou volitelná, aby kompaktní vzhled zůstal možný.

### Princip skupiny

- Společný posuvník odešle požadovanou cílovou pozici všem podporujícím členům skupiny; společný náklon obdobně.
- Pokud se členové liší, zobrazit rozsah hodnot (např. `40–60 %`), nikoli zavádějící průměr `50 %`.
- Při neznámém atributu některého člena neskrývat nejistotu; zobrazit indikátor neurčitého/mixed stavu.
- Samotné renderování, rozbalení ani inicializace **nesmí** odeslat příkaz nebo automaticky synchronizovat členy.
- V rozbalené části je každý motor samostatně ovladatelný včetně stavu, výšky, náklonu a zastavení.
- Při částečné nedostupnosti některého člena jasně ukázat problém; neposílat příkazy na nedostupné entity. Nezamlčet částečný neúspěch.
- V1 nemusí vytvářet nové HA `cover` group entity ani helpery.

## 2. Technické předpoklady a omezení

- Prostudovat aktuální HA frontend custom card API, HACS pravidla a podobné existující projekty (Mushroom Cover, Enhanced/Everyday Shutter Card) pouze jako inspiraci; kód necopy-pastovat bez posouzení licencí.
- TypeScript + Web Component. Volba Lit nebo čistého HTMLElement až po krátkém odůvodnění; preferovat udržovatelnou minimalistickou implementaci a minimální runtime závislosti.
- Číst aktuální entity, atributy a `supported_features` z `hass.states`; reagovat na aktualizace `hass`.
- Používat standardní HA služby `cover.set_cover_position`, `cover.set_cover_tilt_position`, `cover.open_cover`, `cover.close_cover`, `cover.stop_cover`; volat jen služby, které daná entita podporuje. Pro různé schopnosti motorů zajistit odpovídající degradaci UI.
- Ověřit význam `current_position` a `current_tilt_position`, rozsahy 0–100 a zejména rozdíl mezi HA procenty a skutečným geometrickým úhlem lamel. Grafická vizualizace má být konfigurovatelná, ne předstírat fyzikální přesnost bez kalibrace.
- U obousměrného náklonu oddělit HA procentní hodnotu od vizuálního mapování na úhel (např. `tilt_visual: { min_angle: -90, max_angle: 90, invert: false }`); u jednosměrného např. 0 až 90. Ujasnit výchozí mapování před implementací.
- Slider musí odesílat příkaz **po dokončení interakce**, ne při každém pixelu pohybu; průběžně zobrazit náhled a následně synchronizovat se skutečným stavem. Zajistit správné chování myši, touch, klávesnice, accessibility a při průběžných aktualizacích `hass`.
- Respektovat HA theme variables, světlý/tmavý režim, lokalizaci, responzivní zobrazení. Žádné přímé síťové volání mimo HA frontend API.
- Konfiguraci validovat s čitelnými chybami. Primárně YAML; grafický editor je cílem pro veřejné vydání, ale nemá blokovat první funkční MVP.

## 3. Návrh konfigurace (kontrakt k upřesnění během fáze 1)

```yaml
type: custom:advanced-blind-card
show_buttons: true
position_step: 10    # krok volby cíle výšky v procentních bodech
tilt_step: 10        # krok volby cíle náklonu v procentních bodech
tilt_visual:
  mode: single       # single | bidirectional
  min_angle: 0
  max_angle: 90
  invert: false
blinds:
  - entity: cover.loznice
    name: Ložnice
  - name: Obývák – jih
    entities:
      - entity: cover.portal_jih_l
        name: Portál jih L
      - entity: cover.portal_jih_p
        name: Portál jih P
    expandable: true
  - entity: cover.ela
    name: Ela
```

Podporovat dědění globálních nastavení a jejich přepsání na úrovni řádku/konkrétního motoru. Nekopírovat model nativních HA `cover` groups. Přesný config schema rozhodnout a zdokumentovat jednou; zabránit nekonzistentním synonymům (`entity` vs `entities`) mimo výslovně navrženou syntaxi.

## 4. UI / UX

Výchozí řádek: ikona, jméno, stav, posuvník výšky, posuvník náklonu s grafickou stupnicí a volitelné ovladače nahoru/stop/dolů. Šířka se adaptuje: desktop dovolí dva posuvníky vedle sebe; mobil je může skládat pod sebe. Žádný detailový dialog není potřeba pro základní ovládání.

U skupiny zobrazit indikátor počtu motorů a šipku rozbalení. Sbalený řádek zobrazuje společné ovládání; rozbalený ukazuje jednotlivé motory. Rozbalení je výchozím stavem vypnuté. Stav rozbalení stačí udržet v běžící instanci karty, bez trvalého ukládání.

Od bety 9 mají obě rozvržení pevnou odstupňovanou strukturu v posuvníku náklonu a pohyblivý jezdec; původní samostatné SVG bylo nahrazeno na základě schváleného návrhu vlastníka. Jednosměrné i obousměrné režimy používají konfigurovatelné mapování, kde 0° značí vodorovnou lamelu. Rozlišovat `unknown`, `unavailable`, `opening`, `closing` a podporované funkce; skutečné hodnoty přebírat z HA.

**Zřetelná indikace pohybu a nedokončeného cíle (doplněno 2026-10-24, plánováno pro fázi 3):** U výšky i náklonu viditelně odlišit požadovanou cílovou hodnotu, skutečnou hodnotu hlášenou HA a průběh mezi nimi. Použít srozumitelný text a vizuální indikátor, nikoli pouze změnu barvy. Rozlišit odesílání příkazu, čekání na stav a pohyb potvrzený HA; samotné přijetí služby neznamená dokončení pohybu. Dokončení potvrzovat jen podle dostupných stavových dat, při zpoždění nebo chybějící zpětné vazbě přiznat nejistotu. U skupiny ukázat průběh jednotlivých členů a jejich nedokončené cíle, neoznačit celou skupinu za hotovou podle prvního motoru. Po STOP, chybě či nedostupnosti rozlišit přerušený nebo nepotvrzený výsledek; indikace nikdy sama neodesílá další příkazy ani nedorovnává cíl.

Bezpečnost interakcí: žádný náhodný pohyb po tapnutí do neovládací oblasti; žádná skrytá synchronizace; přístupné popisky/klávesnice; tlačítko STOP vždy umožnit tam, kde jej entita podporuje.

## 5. Etapy (implementovat postupně)

### Fáze 0 – Rešerše a repo

- Ověřit aktuální veřejné API HA custom cards a formát HACS dashboard pluginu.
- Založit lokální git repo v `C:\_Projects\advanced-blind-card`; rozhodnutí a minimum nástrojů (`package.json`, TypeScript build, lint, test) srozumitelně odůvodnit.
- Vytvořit úvodní `README.md`, licenci (návrh MIT, potvrdit vlastníkem), `.gitignore` a základní CI až když bude potřebné. **Nezakládat automaticky GitHub remote ani nepublikovat** bez výslovného pokynu.
- Přidat `/.codex-handoffs/` do kořenového `.gitignore` hned při založení repozitáře; tento adresář je lokální, nesmí se dostat do commitu ani na Git remote. Před prvním pushem ověřit `git status` a `git check-ignore .codex-handoffs/<test-file>`.

### Fáze 1 – Minimální funkční karta

- Jediná `cover` entita, zobrazení stavu, výškový slider, tilt slider a základní SVG lamely.
- Akce nahoru/stop/dolů. Kontrola `supported_features` a missing attributes.
- Bezpečné odeslání hodnoty až při release slideru. Reaktivní aktualizace bez přetahování slideru stavem z HA.
- Smoke test v HA, světlé/tmavé téma, desktop/mobil.

### Fáze 2 – Skupiny a expanze

- Více řádků; skupina s více motory jako jediný řádek.
- Expand/collapse; samostatné ovládání členů.
- Společné akce pro podporované dostupné členy.
- Konzistentní rozmezí při rozdílných polohách, missing values a offline člen.
- Testy: rozdílné stavy, dvě různé rychlosti motorů, společný příkaz, samostatný příkaz, částečný fail, redraw, žádný vedlejší pohyb při expanzi.

### Fáze 3 – Nastavitelnost a ergonomie

- Zřetelná indikace pohybu a průběhu od požadovaného cíle po potvrzený výsledek podle pravidel UI / UX výše, pro jednotlivé osy i členy skupiny.
- Konfigurace jednosměrného/obousměrného náklonu, minimální/maximální vizuální úhel, inverze na úrovni motoru.
- Nastavitelná viditelnost tlačítek, názvů a údajů; responzivní layout.
- Nastavitelné `position_step` a `tilt_step` v YAML s děděním globál → řádek → člen a globálními volbami v editoru (doplněno a schváleno 2026-10-25). Výchozí krok obou os 10 procentních bodů, povoleny celočíselné dělitele 100 včetně 1. Krok omezuje pouze volbu nového cíle; hlášené hodnoty a skupinové rozsahy se nezaokrouhlují. Společný posuvník určuje stejný cíl pro všechny podporující členy bez dalšího zaokrouhlení podle člena. Zachovat odeslání po dokončení interakce a nulové pasivní povely.
- Grafický editor konfigurace jen v rozsahu, který lze dlouhodobě udržovat.
- Přístupnost, klávesnice, české/anglické názvy/překlady podle rozumného rozsahu.

### Fáze 4 – Příprava na distribuci

- HACS kompatibilita, release artefakt (bundle JS) a instrukce instalace.
- Reálné otestování alespoň: jedna žaluzie, dvě sdružené žaluzie, motor bez tilt, nedostupný motor, jednosměrné/obousměrné mapování.
- Po dokončení funkčních částí společně s vlastníkem finálně doladit vzhled (velikosti, rozestupy, typografii a hustotu na mobilu/desktopu i v obou tématech). Současný vzhled je pracovní; závěrečná vizuální úprava patří před vydání (požadavek vlastníka 2026-10-25).
- Stručné README s ukázkou konfigurace a obrázkem, changelog jen pokud má smysl.
- Kontrola kvality bundle, licence, verzování, žádný build artefakt nepotřebný pro HACS.
- GitHub publikace až na samostatné zadání uživatele.

### Fáze 5 – Návrh režimů zobrazení a kompaktnosti

- Požadavek vlastníka 2026-10-26: současná karta je příliš vysoká; navrhnout více režimů zobrazení včetně kompaktního. Šest hlavních položek se sbalenými skupinami má při srovnatelné šířce zabírat přibližně výšku šesti řádků v levé části referenčního snímku, nejvýše její dvojnásobek. Výškovou interpretaci a přesné měřitelné rozměry potvrdit při návrhu.
- Před implementací společně vybrat režimy, jejich konfiguraci a rozložení ovladačů; upřesnit chování při rozbalení, pohybu, chybách a smíšených stavech. Zachovat dostupný STOP, bezpečné dokončování interakcí, čitelnost a použitelnost dotykem i klávesnicí.
- Nejprve samostatně schválit návrh, poté implementaci; požadavek sám neschvaluje změnu runtime, další vydání ani nasazení.
- Vlastník následně schválil lokální implementaci `layout: detailed | inline` s výchozím `detailed`, děděním karta → řádek → člen a globální volbou v editoru. Řádkový režim ponechá oba posuvníky a STOP přímo, Nahoru/Dolů v malém menu ⋮ a šipku pro přímé rozbalení členů bez velkého mezibloku. Ostatní makety Seznam/Kompaktní zatím nejsou součástí implementace. Před commitem, zveřejněním, novým vydáním nebo HA nasazením je potřeba příslušný samostatný souhlas.
- Po pasivním ověření bety 2 vlastník schválil navazující lokální úpravu: v řádkovém režimu nad šířkou karty 430 px nahradit ⋮ přímými šipkami Nahoru/Dolů nad sebou (44 × 28 px, mezera 4 px); na užší kartě zachovat menu. Výška řádku se nesmí zvýšit, STOP zůstává samostatný. `show_buttons: false` skrývá obě varianty. Samotná lokální úprava neschvaluje commit ani další vydání/nasazení.
- Vlastník schválil lokální implementaci návrhu **Hodnoty nad pruhem**: v `inline` výplň podle skutečně hlášených hodnot HA, šrafované min–max skupin, oddělená značka cíle a náhledu, barva doplněná symbolem a stručným stavem. Nepředstírat fyzický průběh při opožděné zpětné vazbě. Podrobný průběh otevřít ze záhlaví, chyby a nejistotu ponechat viditelné. Zachovat rozměry klidového řádku a dosavadní bezpečné dokončení interakcí; `detailed` zachovává původní prezentaci. Commit, review, publikace a nasazení vyžadují samostatné schválení.
- Beta 5 zavedla texturu lamel a ztišení dokončených výsledků; tento vzhled byl následně nahrazen podle připomínek vlastníka. Od vydané bety 6 má posuvník náklonu stálou odstupňovanou strukturu odpovídající vizuálnímu mapování, nezalomené hodnoty cíle a úplné skupinové rozsahy. Zachovat STOP, neznámé a smíšené stavy i odeslání příkazu až po dokončení interakce.
- Vydaná beta 7 po novém příslušném hlášení HA a přijetí příkazu vyhodnocuje polohu i náklon v toleranci ±2 procentní body po 2 sekundách ustálení, samostatně pro členy skupiny. Jde o odhad podle HA, nikoli potvrzení fyzického zastavení; později neplatný výsledek zůstává viditelný jako historický. Skutečně ověřené případy a omezení jsou v README. Dosud chybí reálné ověření tolerance polohy, rozdílných konečných hodnot členů a STOP v betě 7; další pohyby vyžadují samostatný souhlas vlastníka.
- Vydaná beta 8 podle schválené makety zobrazuje na úzkých kartách přímé šipky vedle sebe a na desktopu ponechává více místa posuvníkům užším sloupcem názvu. Vlastník poskytl snímky telefonu a desktopu v obou tématech a uvedl, že ovladače fungují dobře; podrobnosti a limity ověření jsou v README.
- Vydaná beta 9 sjednocuje posuvníky i v podrobném rozvržení a nahrazuje samostatný náhled SVG. Vlastník potvrdil pasivní načtení a rozbalení bez chyby a pohybu; podrobnosti a limity ověření jsou v README.
- Vydaná beta 10 opravuje viditelnost smíšeného rozsahu při `show_values: false` a popis editoru. Vlastník potvrdil pasivní kontrolu; samostatné ověření kombinace `show_values: false` na reálném HA nebylo zaznamenáno. Podrobnosti a limity jsou v README.

## 6. Akceptační kritéria

1. Z dashboardu lze bez otevření detailu změnit výšku i náklon podporované žaluzie.
2. Stupnice náklonu a jezdec zobrazují odpovídající hodnotu; lze nastavit jednosměrné a obousměrné vizuální mapování.
3. Jedna skupina dvou motorů se ve výchozím stavu zobrazuje jako jeden řádek a řídí oba motory.
4. Po rozbalení lze každý motor řídit nezávisle; zpětné sbalení nic nepřestaví.
5. Rozdílné hodnoty členů se nezaměňují za průměr; UI ukazuje rozsah nebo nejistotu.
6. Unsupported tilt, `unknown`, `unavailable` a částečné chyby mají bezpečné a srozumitelné chování.
7. Žádné HA služby se nespouštějí při renderu, mountu nebo expand/collapse.
8. Build a relevantní automatické testy procházejí; kartu lze načíst jako Lovelace resource v HA.
9. Styl odpovídá HA tématům, funguje na mobilu i desktopu.
10. Konfigurace je přenositelná mezi instalacemi a neobsahuje hard-coded domácí entity.
11. Průběh změny polohy/náklonu je zřetelný: uživatel rozliší požadovaný cíl, skutečnou hlášenou hodnotu, probíhající pohyb/čekání a potvrzený či přerušený/neověřený výsledek. Přijetí služby ani dokončení jednoho člena nesmí vytvořit falešné potvrzení celé skupiny.

## 7. Codex CLI — doporučené řízení

Použít **jednu hlavní dlouhodobou implementační session** a **samostatnou, podle potřeby spouštěnou read-only review session**. Nepřenášet každý drobný úkol pomocí handoff souborů.

1. **Implementer / owner (workspace-write):** Načte tento plán, vytváří malé implementační kroky, rozhoduje o lokálním pořadí práce, upravuje kód, spouští build/testy a na konci každého kroku předloží stručný souhrn změn, ověření a rizik. Nemá automaticky publikovat GitHub repo, nasazovat do produkčního HA nebo překročit odsouhlasený rozsah.
2. **Independent Reviewer (read-only):** Spouští se na kontrolních bodech, zejména po prvním funkčním ovládání, po dokončení skupin, po změně konfiguračního rozhraní a před veřejným vydáním. Posoudí aktuální `git diff`, relevantní kód, testy a tento plán. Hlásí konkrétní nálezy podle závažnosti a důkazy; neimplementuje opravy. Implementer zjištění opraví.
3. **Uživatel / maintainer:** Schvaluje UX/API rozhodnutí, která mění chování zařízení, případné breaking changes, první nasazení a publikaci. Git commit po odsouhlasené etapě; review může proběhnout ještě před commitem.

**Veškerá souborová komunikace s Codexem patří výhradně do `C:\_Projects\advanced-blind-card\.codex-handoffs\`.** To zahrnuje ad hoc zadání, předávací prompty, review reporty, dočasné plány, výsledky a pracovní poznámky mezi sessions. V konzoli lze běžně komunikovat; pokud se má komunikace zapsat do souboru, použít pouze tuto složku. Složka je lokální pracovní prostor, nikoli součást projektu určená ke zveřejnění. Kořenový `.gitignore` musí obsahovat:

```gitignore
/.codex-handoffs/
```

Nezaměňovat ji za `PROJECT_PLAN.md`, `AGENTS.md` či `README.md`, což jsou záměrně verzované projektové dokumenty. Žádné handoff reporty či plány neukládat do `docs/` nebo kořene repozitáře. Pokud by soubory z `.codex-handoffs` už byly trackované, samotný `.gitignore` nestačí: před publikací je nutné odstranit je z Git indexu bez mazání lokálních souborů a prověřit případnou již publikovanou historii.

Tok: `Implementer → build/test → (na checkpointu) nezávislý review → oprava → schválení/commit → další krok`.

V repozitáři mít pouze stručné trvalé artefakty:

- `PROJECT_PLAN.md` — tento plán, zdroj pravdy o cíli a akceptačních kritériích.
- `AGENTS.md` — maximálně stručná, nadčasová pravidla: minimalismus, respekt HA API, bezpečné ovládání motorů, žádné side-effecty při renderu, relevantní testy, zákaz nevyžádaného publikování.
- `README.md` — uživatelská instalace a konfigurace, rozšiřovat s hotovými funkcemi.

Nevytvářet automaticky `next-implementer-prompt.md`, přepisované handoff soubory, tři permanentní role ani složitou orchestraci. Pokud je písemné předání či pracovní plán užitečný, vytvořit jej pouze v `.codex-handoffs/`; u malých úkolů stačí komunikace v session. Zabránit souběžným zápisům do stejných souborů. Náročnost modelu/effort volit dle konkrétního kroku, nevyžadovat automatické doporučení pro každý drobný úkol.

## 8. První prompt pro hlavní Codex session

> Pracujeme na novém projektu `C:\_Projects\advanced-blind-card`. Přečti celý `PROJECT_PLAN.md` a respektuj cíle, akceptační kritéria a etapy. Jsi hlavní implementační agent. Začni Fází 0: ověř aktuální HA custom-card/HACS podklady, navrhni minimalistický stack a založ repo skeleton v tomto adresáři včetně stručného `AGENTS.md`. Nejdříve vytvoř `.gitignore` s položkou `/.codex-handoffs/`. Veškerou případnou souborovou komunikaci a pracovní handoffy ukládej pouze do `.codex-handoffs/`, která nesmí být trackovaná Gitem. Proveď jen Fázi 0; první funkční MVP zatím neimplementuj. Otestuj, co lze, a shrň konkrétní výstupy, otevřená rozhodnutí a další navržený malý krok. Nepublikuj GitHub remote ani nic nenasazuj.

### Prompt pro nezávislé review (na checkpointu)

> V tomto repozitáři působíš jako nezávislý read-only reviewer. Přečti `PROJECT_PLAN.md`, `AGENTS.md`, relevantní kód a současný `git diff`. Posuď zejména bezpečnost volání HA cover služeb, správnost skupinového ovládání, mixed/offline stavy, UI interakce, regresní rizika a chybějící testy. Vrať nejdříve konkrétní nálezy se závažností a odkazy na soubory/řádky; žádné editace. Pokud nenajdeš chyby, řekni to výslovně a popiš zbytková rizika či neověřené chování.

## 9. Schválená distribuční rozhodnutí a zbývající body

- Místně se připravuje první stabilní verze `0.1.0` se stejným runtime chováním a konfigurací jako beta 10. Vlastník 2026-10-29 výslovně přijal zdokumentovaná omezení a schválil dokončení podkladů a lokální commit. Podpora dalších integrací, minimálních HA/HACS verzí a zbývající neověřené případy se tím neprohlašují za ověřené. Publikace vyžaduje samostatný souhlas vlastníka.

- Schválený veřejný název: **Advanced Blind Card**, název repozitáře `advanced-blind-card`; lokální adresář se nepřejmenovává.
- Veřejný repozitář: `https://github.com/pekur/advanced-blind-card`; vytvoření a první publikace byly samostatně schválené vlastníkem.
- Schválená licence: **MIT**, copyright **2026 Petr Kurka**. Přibalené knihovny si zachovávají vlastní licenční oznámení v distribuovaném JS.
- První vydaná verze: **0.1.0-beta.1**, veřejný tag `v0.1.0-beta.1` nad commitem `45479d8`, označený jako experimentální prerelease. Text a jediný stažený JS asset byly ověřeny proti schváleným podkladům; zbývající testovací limity jsou zveřejněné v README a release notes.
- Schválené balení: verzovat právě `dist/advanced-blind-card.js`, ostatní generované výstupy ignorovat. HACS 2.0.5 při prvním přidání standardně odfiltruje prerelease; tento soubor slouží pro validaci struktury repozitáře. Výstup buildu, verzovaný JS a příslušný release asset musí být totožné; zachovat LF. Manifest ponechává `hide_default_branch: true` a při instalaci se výslovně vybere požadovaná verze.
- Vlastník potvrdil registraci custom repository a instalaci **v0.1.0-beta.1** přes HACS **2.0.5**, frontend **20250128065759**, jedinou HACS resource a pasivní načtení/expanzi/editor bez chyb a pozorovaného pohybu. Výchozí stažení nabídlo commit; přesnou betu bylo nutné vybrat přes jinou verzi v dialogu Stáhnout / Znovu stáhnout. Jde o uživatelské potvrzení, nikoli přímé měření HA serverového souboru.
- Minimum podporovaných HA/HACS verzí, hash JS přímo na HA serveru, aktualizace mezi dvěma vydanými verzemi a skutečný rollback zůstávají neověřené. Ostatní reálné motorové, mobilní a přístupnostní mezery uvedené v README zůstávají otevřené; instalace stejné bety je neuzavírá.
- Jak přesně vypadá mapování `current_tilt_position` na skutečný úhel u různých motorů; v1 použije konfigurovatelné lineární vizuální mapování.
- Jak nejlépe zobrazit skupinové rozsahy na velmi úzkém mobilním displeji.
- Grafický editor pokrývá globální volby; definice entit, skupin a jejich přepsání zůstává v YAML.

Kód a dokumentaci držet minimální, idiomatické a snadno reviewovatelné. Nevytvářet obecný framework, plugin systém ani dlouhou dokumentaci bez aktuální potřeby.
