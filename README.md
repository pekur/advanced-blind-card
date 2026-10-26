# Advanced Blind Card

A Home Assistant dashboard card for blind position and slat tilt, with inline
sliders, small stacked slats, expandable groups and supported STOP controls.
Group readings show ranges and uncertainty. Loading or expanding the card never
synchronizes motors.

**Local beta preparation: 0.1.0-beta.1.** This checkout is prepared for a future
release; no public release or HACS installation is claimed. See
[verification and limits](#verification-and-limits) before using it with devices.

![Advanced Blind Card showing a single blind and an expanded group](images/advanced-blind-card.png)

Example from the actual card bundle with simulated entities and generic names.

## Configuration

```yaml
type: custom:advanced-blind-card
show_buttons: true
blinds:
  - entity: cover.example
    name: Office blind
  - name: Living room pair
    entities:
      - entity: cover.living_left
        name: Left
      - entity: cover.living_right
        name: Right
    expandable: true
```

`blinds` requires at least one row, in display order. Each row uses either `entity`
or `entities`, never both. A group needs at least two members, each using `entity`
and optional `name`; nested groups are not supported. Every entity ID may occur
only once within a card. A missing entity is shown as a runtime problem.

`name` is optional; individual motors fall back to the Home Assistant entity name.
Unnamed groups show their member count. `show_buttons` defaults to `true` and can
be overridden per row or group member. **`show_buttons: false` hides only
Open / Close; STOP remains visible**, with the same capability and availability
checks.
Groups start collapsed; `expandable` defaults to `true`, and `false`
hides the expansion control. Expansion is local UI state and never moves motors.
The [visual editor](#language-accessibility-and-visual-editor) supports global options;
covers, groups and member overrides use YAML.

Group readings show the actual range (such as 40–60%), plus unknown, unavailable,
or unsupported members. They never substitute an average. Group sliders select an
explicit target; reported values remain visible while previewing. An unknown or
mixed tilt has no invented SVG angle. Releasing a group slider sends the same
target separately to each eligible member. Skipped members and failures are
reported; accepted commands do not prove that a motor physically reached its target.
Expanded member controls affect only that member. Errors remain visible when
collapsed. A group STOP attempts every independently supported stop channel.
There is no retry, rollback, automatic synchronization, or automatic tilt restoration
after STOP. Motor mechanics may change tilt during height travel or stopping.

Position and tilt use Home Assistant percentages from 0 to 100. Slider movement
previews locally; releasing the pointer or a slider key sends one command. Escape
or a cancelled pointer gesture discards the preview. Incoming state updates do not
interrupt an active edit. A keyboard edit also commits on focus loss.
Switching away from the page or losing pointer capture discards an active drag.

The compact SVG is no taller than a range control and stacks the slats vertically,
each tilting around its own center. By default,
it shows vertical slats at 0% and horizontal slats at 100%. This is an
illustration, not a measured physical angle; service values are never inverted.
Unknown values are labeled and cannot send slider commands. Actions require the
entity's matching capability, an available service, and a connected Home Assistant.
STOP independently invokes supported lift-stop and tilt-stop services and remains
available while movement requests await a response. Errors are shown in the card.
Rendering, initialization, and state updates never command a motor.

## Command progress

Position and tilt retain the last sent target separately from the HA-reported
reading. Status distinguishes sending, waiting for state, HA-reported movement,
an exactly reported target, a near result, interruption, and uncertainty. Service
acceptance does not confirm physical completion. An initially matching value is
labelled as already reported; subsequent external changes make completed results
historical. Group progress counts members separately, including skipped, failed,
and individually replaced targets. Mixed readings remain ranges.
Collapsed groups also show current individual targets and their live results,
separately from the last common target. An individual target never becomes an
implied common target for the group.

A result within one percentage point is labelled **near**, never exactly reached.
After 120 seconds without confirmation, the result is unconfirmed; this UI deadline
does not release pending service requests or send any command. Later HA data can
clarify the result. STOP interrupts tracked goals and reports service responses
without claiming physical rest. A cover's opening/closing state does not prove
tilt movement. No travel time or physical progress percentage is estimated.

New progress messages follow the HA language (Czech or English, English fallback)
and movement indicators respect reduced-motion preferences. Tracking is local to
the current card instance and is cleared on configuration replacement or removal.

## Visual and display settings

The following options inherit **card → row → group member**. A child overrides
only explicitly supplied fields. Names, entity IDs, and `expandable` do not inherit.

| Option                  | Default                                | Effect                                         |
| ----------------------- | -------------------------------------- | ---------------------------------------------- |
| `tilt_visual.mode`      | `single`                               | Preset: `single` or `bidirectional`            |
| `tilt_visual.min_angle` | `-90`                                  | Minimum illustrative angle, from `-90` to `90` |
| `tilt_visual.max_angle` | `0` for single, `90` for bidirectional | Maximum angle; must exceed the minimum         |
| `tilt_visual.invert`    | `false`                                | Reverse SVG mapping only                       |
| `show_buttons`          | `true`                                 | Show Open / Close; STOP remains                |
| `show_name`             | `true`                                 | Show the heading name                          |
| `show_state`            | `true`                                 | Show the ordinary idle state                   |
| `show_values`           | `true`                                 | Show ordinary idle percentage labels           |

Angles use **0° = horizontal** and ±90° = vertical. The default single range
−90°→0° preserves the earlier illustration. Bidirectional −90°→90° is horizontal
at 50% and vertical at both ends. Custom ranges map linearly; inversion reverses
the visual input. **HA percentages, slider steps and outgoing commands never invert.**

Merge explicit visual fields before filling preset defaults. An explicit parent
bound stays inherited even when a child changes mode. To let a child use its full
preset, omit parent bounds or override them at the child. Every level must be valid;
a child cannot repair invalid parent settings. Nulls, alternative option names and coerced types
are rejected; `tilt_visual: {}` simply inherits.

```yaml
type: custom:advanced-blind-card
show_buttons: false
tilt_visual:
  mode: single
blinds:
  - entity: cover.office
    show_values: false
  - name: Living room pair
    tilt_visual:
      mode: bidirectional
    entities:
      - entity: cover.living_left
      - entity: cover.living_right
        tilt_visual:
          invert: true
        show_buttons: true
```

In this example STOP remains everywhere; the right member also shows Open / Close.
The two member maps differ, so their shared SVG is indeterminate even if their
reported percentages match. Member previews use their own maps. Equal effective
maps can share a preview even if their preset names differ. Mixed or unknown data
still use ranges or uncertainty, without an averaged or invented angle.

Hiding names preserves accessible names and member identification in results/errors.
Hiding state or values never suppresses movement, mixed/unknown readings, errors,
previews, unresolved goals or the numeric context in progress panels. STOP remains
available during a pending movement request.

## Slider steps

Both sliders now default to **10 percentage points**, including configurations
without step options. To keep the earlier fine-grained selection, set both to `1`.
Configure the axes independently:

```yaml
position_step: 10
tilt_step: 10
```

Allowed numeric steps are `1`, `2`, `4`, `5`, `10`, `20`, `25`, `50`, and `100`.
They divide the full range so both 0 and 100 remain selectable. These options
inherit from the card to a row and then to a member. The visual editor changes
the two global options; choose Default to remove an explicit global value.
Set row/member overrides in YAML.

A group slider chooses one target using the group's step and sends that same
target to every eligible member. A member's step applies to its own slider.
Reported values, ranges, slat illustrations and progress retain exact HA values:
9% stays 9%. The native slider thumb can rest on the nearest grid value while
its text and accessible report remain exact. A first arrow-key edit selects
the adjacent grid target (for example, 9 → 10 when increasing with step 10).
Home and End choose 0 and 100. Commands still wait for interaction completion;
loading, changing steps and state updates never send commands. Progress tolerances
are independent of the step size.


## Tile layout

The position and tilt controls sit side by side, switching to a single column
in a narrow card. Small stacked slats sit beside the tilt value. Expanded members
use a separate background, and supported STOP remains available with Open / Close
hidden. This layout uses the existing configuration options.

An incomplete group reading shows a compact range with `+ ?`; the full uncertainty
and eligibility explanations remain below the sliders. During interaction, the
preview target and reported values appear below the controls. Progress for each
axis spans the row and retains individual member results when the group is collapsed.


## Language, accessibility and visual editor

The card and editor use Czech for `hass.language` values such as `cs` or `cs-CZ`,
and English for other languages. Entity names and states use Home Assistant's
public formatters when available. Custom names and errors returned by HA services
are preserved. Language changes do not send commands or reset an active gesture.

Sliders support native keyboard interaction; release the key or finish interaction
to send, and use Escape to cancel. Group controls distinguish a chosen target from
reported ranges. Numeric outputs have live announcements disabled; progress
changes use polite announcements. Names remain accessible when headings are hidden,
and expansion retains focus on its button. Actual screen-reader support remains
unverified; browser checks alone do not establish assistive-technology compatibility.

The visual editor for an existing card changes only global `show_buttons`,
`show_name`, `show_state`, `show_values`, `position_step`, `tilt_step`, and
`tilt_visual` options. Edit `blinds`,
groups and member overrides in YAML. Their configuration and dashboard layout and
visibility metadata are preserved when global options change. Row/member overrides
still take precedence. There is no automatic entity selection or card-picker setup.

Select **Default** to remove a global override; empty angle fields remove explicit
bounds. Display flags default to true, `mode` to `single`, and `invert` to false.
Changing mode preserves explicit angles and otherwise uses that mode's bounds.
Invalid or incomplete numbers remain local until the complete configuration is
valid. Unsupported source YAML is reported for correction in YAML, without repair
or removal of its fields. Loading, rendering, validation and passive preview
updates never send motor commands.

## Installation and updates

For a local installation, [build the card](#development), then copy
`dist/advanced-blind-card.js` into `www/` within your Home Assistant configuration
directory. This is a dashboard resource, not a `custom_components` integration.
Register one **JavaScript module** dashboard resource:

```text
/local/advanced-blind-card.js?v=0.1.0-beta.1
```

Add a manual card using the [configuration above](#configuration), replacing the
example entity IDs. On update, replace the JS file and change the existing
resource's query suffix to the new version or build hash, then fully reload the
dashboard (for example Ctrl+F5 on desktop). Keep one active resource for this card.
For an unreleased rebuild, use a new hash suffix even if the version is unchanged.

### HACS distribution preparation

The planned public repository is `https://github.com/pekur/advanced-blind-card`.
It has not been published by this preparation. The intended first release is
`v0.1.0-beta.1`, marked as a prerelease, with one `advanced-blind-card.js` asset.
Creating the public repository and release requires separate maintainer approval.

The owner has HACS 2.0.5 (frontend 20250128065759). In that version, beta releases
are filtered out by default when registering a custom repository. To allow the
initial repository validation, Git tracks exactly `dist/advanced-blind-card.js`
as a fallback; other generated files remain ignored. See the pinned HACS 2.0.5
[release filtering](https://github.com/hacs/integration/blob/2.0.5/custom_components/hacs/repositories/base.py)
and [JS discovery](https://github.com/hacs/integration/blob/2.0.5/custom_components/hacs/repositories/plugin.py).
This source-level check is not an actual HACS installation test.

#### Installation after publication

1. Add the repository URL above to HACS as a **Dashboard** custom repository.
2. Enable beta versions for that repository and select **v0.1.0-beta.1** before
   downloading. The manifest keeps `hide_default_branch: true`; do not substitute
   the default branch or a different version. If the beta is not offered, stop
   and check the error before changing the installation.
3. Use the JavaScript module resource provided by HACS, normally
   `/hacsfiles/advanced-blind-card/advanced-blind-card.js` with its cache query.
   Disable the old manual `/local/` resource so only one resource loads the card,
   then fully reload the dashboard. Keep the manual file and resource address
   available for rollback.
4. First check loading, expansion and the editor without moving motors. For
   later updates, select the intended release in HACS and refresh the dashboard
   cache. Re-downloading the same beta does not verify an update between versions.

If loading fails, disable the HACS resource, restore the single manual resource,
and reload. Do not load both copies. Actual HACS registration, prerelease selection,
installation and updates remain unverified. See the official
[HACS dashboard requirements](https://www.hacs.dev/docs/publish/plugin/) and
[custom repository instructions](https://www.hacs.dev/docs/faq/custom_repositories/).

## Verification and limits

| Area                                                                           | Evidence and remaining limits                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual/group motor control                                                 | Owner-operated Overkiz checks on earlier functional builds covered position, tilt, STOP, independent/shared commands and different member results.                                                                                                                          |
| Current layout and steps                                                       | Independent code reviews and mock browser regressions; owner-operated passive HA checks covered loading/reload, expansion, both themes, editor changes, defaults, YAML key removal and save/reopen without observed movement. New steps have not been physically exercised. |
| Android                                                                        | Passive HA app check on a Pixel 9 Pro with an Android beta. Exact Android/app/WebView builds and native touch command delivery are unverified.                                                                                                                              |
| Unsupported tilt, unavailable entities, partial failures, bidirectional motors | Automated capability, dispatch, progress and UI mocks. No suitable real devices were available for these cases. SVG bidirectional mapping does not establish motor compatibility.                                                                                           |
| Accessibility and browsers                                                     | Native keyboard, focus, DOM/SSR, simulated input events, emulated touch and mock theme contrast checked in Edge. Actual screen readers, other browser engines and forced CSS fallbacks are unverified.                                                                      |
| Distribution                                                                   | Local single-file build and packaging checks. Public release, HACS install/update and minimum supported HA/HACS versions are not established.                                                                                                                               |

The earlier owner-reported HA version was 2026.10.2; the later description
"latest HA" does not pin an exact server or app build. The local beta has undergone
independent prerelease review, including verification of fixes. A public release
still requires maintainer acceptance of the remaining test gaps and explicit approval.

## Development

Use Node.js 24 or newer and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test
```

Run the build before tests. The Node runner tests configuration, capabilities,
command dispatch, gesture cancellation, pending requests, and stale results using
the same TypeScript helpers as the card. It also checks that the browser bundle
parses and has no external runtime dependencies. No DOM emulator, TypeScript loader,
or extra test framework is used. Node tests do not establish browser or device
compatibility; those require separate checks.
The bundle is written to `dist/advanced-blind-card.js`. This single generated file
is tracked for initial HACS repository validation; commit the freshly built bundle
with source changes that affect it. It uses LF line endings to preserve its bytes
across checkouts and is excluded from Biome's source checks. Other generated files
remain ignored. A release asset must match this built file byte for byte.

TypeScript checks the source, Lit supplies reactive web components, esbuild produces
a single browser ES module with Lit included, and Biome handles linting and
formatting. pnpm is pinned in `package.json`.
No development server or CI is included.

The esbuild dependency's install script is explicitly disabled in
`pnpm-workspace.yaml`. The build uses its platform binary installed through optional
dependencies; no dependency install script needs approval.

Working notes and handoffs belong in the Git-ignored `.codex-handoffs/` directory.

## License

[MIT](LICENSE), copyright 2026 Petr Kurka. The standalone JS includes the complete
project license and BSD-3-Clause notices for its bundled Lit packages. Build
metadata identifies the actual bundled package versions. The package remains
private; this project does not publish an npm package.
