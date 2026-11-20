# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Task progress woven into the flow: node progress brightens its outgoing
  links, overall progress boosts the active chain, plus an optional
  "Task 45% · 12 queued" badge next to the Flow button.

## [0.1.0-beta.1] - 2026-11-20

### Added

- Water-pipe link flow: translucent pipe wall, dashed water segments, white
  highlight dashes, and bubbles on fast streams.
- Flow speed follows live generation progress (`progress` / `progress_state`
  events, EMA-smoothed steps/s); finished links ease to a stop, failed links
  turn red, idle links drift.
- Per-type neon node glow: hue derived from the node type (golden-angle
  spread), executing node pulses, title-bar gradient. Drawn on an overlay
  canvas so nodes with DOM widgets are covered; `drawNode` wrap as fallback.
- Settings panel (bottom-right "Flow" button) with 9 persisted options.
- Compatibility hardening: both `executing` detail shapes, `progress_state`
  fallback, per-frame canvas re-read (tab switches), disabled links skipped,
  self-healing overlay, capped link-state memory, decoupled setup so a link
  takeover failure never disables node glow or the panel.

[Unreleased]: https://github.com/Daroumm/ComfyUI-FlowLinks/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/Daroumm/ComfyUI-FlowLinks/releases/tag/v0.1.0-beta.1
