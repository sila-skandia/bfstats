# .NET analyzers and warnings-as-errors

All C# projects inherit a shared analyzer policy from `Directory.Build.props`:

- `AnalysisLevel=latest-all` — every shipped CA rule is on
- `EnforceCodeStyleInBuild=true` — unused-code IDE rules run at build time
- `TreatWarningsAsErrors=true` — a warning fails CI and local builds
- `NuGetAuditMode=all` / `NuGetAuditLevel=low` — vulnerable packages fail the build

`.editorconfig` then turns off the handful of rules that are wrong for this app. Each suppression has a comment explaining why. The important ones:

| Rule | Why it is off |
| --- | --- |
| CA2007 | ASP.NET Core has no `SynchronizationContext`; `ConfigureAwait(false)` everywhere is noise |
| CA1515 | This is a public web API, not a class library |
| CA1062 | Nullable reference types already cover argument nullness |
| CA2227 / CA1002 / CA1819 | EF entities and JSON DTOs need settable `List<T>` / arrays |
| CA1031 | Hosted services and HTTP boundaries catch `Exception` on purpose |
| CA1862 | EF Core SQLite cannot translate `StringComparison` overloads |
| CA1812 | ADO.NET/`SqlQuery` materialization looks unused to the analyzer |
| CA1848 / CA1873 | LoggerMessage source generators stay as IDE suggestions |

Generated EF migrations are marked `generated_code = true`. Test projects skip xunit-unfriendly rules (underscores in names, IDisposable ceremony).

If a new analyzer fires on real code, **fix the code**. Only add a suppression when the rule is a false positive for this architecture, and document why next to the `dotnet_diagnostic.*.severity` entry.
