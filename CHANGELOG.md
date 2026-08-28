# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Persist Garmin activity kudos through the conversation API instead of relying on synthetic DOM clicks.
- Restrict Garmin kudos to activity cards so comment likes are never included.
- Place the Garmin header button outside the upload control to prevent the upload tooltip from leaking onto Kudo All.
- Detect Garmin's current generated top-bar layout through the visible upload control, force the heart icon to remain visible despite inherited Garmin styles, and always provide a guarded floating fallback.
- Anchor Kudo All to the upload control's viewport position so Garmin cannot place it in a separate header row.
- Send Garmin's page CSRF token with activity-like requests and report exact HTTP failures in the button tooltip.
- Match Garmin's native empty-body activity-like request and require a returned conversation-like ID before reporting success.
- Ignore Garmin's hidden upload tooltip when locating the visible header control.
- Fill confirmed activity hearts immediately while Garmin's React feed still shows its stale outline SVG.
- Process Garmin activity kudos concurrently with bounded retries for faster completion.

## [0.1]

### New

- Start a new project based on https://github.com/tciles/kudo-all
