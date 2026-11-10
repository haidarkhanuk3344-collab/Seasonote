# Build from source

## Browser preview

No package install is required for the renderer. From the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory seasons
```

Open http://127.0.0.1:8080. This browser preview has scene controls, PNG capture and immersive mode; system media control requires a native shell.

## macOS

Requires macOS 13+, Xcode Command Line Tools (Swift/Clang), Python 3 and zsh. All adapter sources are included with their upstream license.

```sh
zsh seasons/macos/build.sh
open seasons/macos/Seasonote.app
```

The script builds a universal Intel / Apple Silicon app with an ad-hoc local signature. It also builds the standalone media diagnostics helper as an intermediate dependency. macOS music integration uses a private MediaRemote adapter and may need updates with future macOS versions; it is not an official QQ Music API.

## Windows — PowerShell

Install .NET SDK 8 and Microsoft WebView2 Runtime. From the repository root, to build the x64 application:

```powershell
./scripts/build-windows.ps1 -Runtime win-x64
```

For ARM64 use `-Runtime win-arm64`. Output is in `artifacts/Seasonote-<runtime>/`; the whole directory is needed. The included .NET runtime means end users do not need to install .NET separately. NuGet access is required when building from source.

On macOS/Linux with .NET SDK 8, cross-publish both architectures using `zsh seasons/windows/build.sh`. Native desktop behavior still requires testing on Windows.

## Tests

Node.js 20+ and npm:

```sh
cd tests/music-ui
npm install
node tests.mjs
```

From repository root, with .NET SDK 8:

```sh
dotnet run --project tests/windows-media/BehaviorTests.csproj
dotnet run --project tests/server/Test.csproj
dotnet run --project tests/placement/Test.csproj
```

These exercise the production source with fake SMTC sessions / screen geometry. They do not replace actual Windows desktop or QQ Music testing.
