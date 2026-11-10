# Third-party notices

The MIT license at the repository root applies to original Seasonote code. Third-party components retain their own licenses.

| Component | Use | License / location |
|---|---|---|
| Three.js | Local WebGL renderer | MIT, `seasons/vendor/LICENSE-three.txt` |
| [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) | macOS system media bridge | BSD-3-Clause, `music-connection/vendor/mediaremote-adapter/LICENSE`; upstream revision recorded in `SOURCE_COMMIT` |
| Microsoft WebView2 SDK | Windows composition web view | NuGet package license governs use; restored by `Seasonote.csproj`, not relicensed by this repository |
| .NET runtime | Windows release runtime | Distribution notices in `seasons/windows/licenses/`; source builds restore runtime through the .NET SDK |
| Happy DOM | Development-only DOM tests | MIT; restored from package registry, not vendored |

The application icon and the explicitly labelled prototype artwork were generated with AI assistance. The runtime image is an unaltered project render with no personal desktop or music metadata. Music, album artwork, reference footage, user configuration, diagnostics and private working files are not part of the source repository. Runtime music images belong to their respective rights holders and are obtained locally from the active player.

Visual inspiration: [four-season turntable reference video](https://v.douyin.com/GkQiiNzaLUc/). That video is not included or covered by this project's license. Seasonote is an independent project and is not affiliated with QQ Music, Apple or Microsoft.
