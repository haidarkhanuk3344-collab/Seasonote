# Version 0.4.0 validation

Mac and Windows share the same renderer and media UI. macOS has been tested with real QQ Music metadata, album artwork, controls and desktop entry. Windows x64 and ARM64 cross-builds pass, with 21 fake-SMTC production-code behavior tests, 28 localhost server checks and 7 placement / DPI arithmetic checks. Shared media UI has 31 DOM checks.

There has not yet been a Windows hardware test. Transparent composition, Windows+D, Explorer restart, mixed-DPI / virtual desktops and real Windows QQ Music control remain unverified on hardware. Compilation and simulated sessions do not prove those behaviors. Feedback from Windows users is welcome.

The scene is an evolving four-season desktop artwork. Exact visual equivalence to the reference video has not been established. The labelled prototype illustration is design documentation, not a screenshot or a promise of different rendering quality.

No login service, automatic QQ installation, bundled music, telemetry or startup-at-login feature is included.
