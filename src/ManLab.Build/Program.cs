using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

internal static class Program
{
    private sealed record BuildVersion(
        string InformationalVersion,
        string? MsbuildVersion,
        string? AssemblyFileVersion);

    private sealed record Options(
        string Configuration,
        string RepoRoot,
        string AgentProject,
        string ArtifactsRoot,
        string ServerDistributionRoot,
        IReadOnlyList<string> Rids,
        bool Help);

    public static int Main(string[] args)
    {
        try
        {
            var options = ParseArgs(args);
            if (options.Help)
            {
                PrintHelp();
                return 0;
            }

            return PublishAndStage(options);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static int PublishAndStage(Options options)
    {
        if (!File.Exists(options.AgentProject))
        {
            throw new FileNotFoundException($"Agent project not found at: {options.AgentProject}");
        }

        Directory.CreateDirectory(options.ArtifactsRoot);
        Directory.CreateDirectory(options.ServerDistributionRoot);

        Console.WriteLine($"Publishing ManLab.Agent ({options.Configuration}) for: {string.Join(", ", options.Rids)}");
        Console.WriteLine($"Repo root: {options.RepoRoot}");
        Console.WriteLine($"Artifacts: {options.ArtifactsRoot}");
        Console.WriteLine($"Server distribution: {options.ServerDistributionRoot}");

        var version = GetBuildVersion(options.RepoRoot);
        Console.WriteLine($"Agent version (informational): {version.InformationalVersion}");
        if (!string.IsNullOrWhiteSpace(version.MsbuildVersion))
        {
            Console.WriteLine($"Agent version (msbuild): {version.MsbuildVersion}");
        }
        if (!string.IsNullOrWhiteSpace(version.AssemblyFileVersion))
        {
            Console.WriteLine($"Agent file/assembly version: {version.AssemblyFileVersion}");
        }

        var agentAppSettings = Path.Combine(options.RepoRoot, "src", "ManLab.Agent", "appsettings.json");

        foreach (var rid in options.Rids)
        {
            var publishOut = Path.Combine(options.ArtifactsRoot, rid, "publish");
            Directory.CreateDirectory(publishOut);

            Console.WriteLine($"- dotnet publish -r {rid}");

            var publishArgs = new List<string>
            {
                "publish",
                options.AgentProject,
                "-c",
                options.Configuration,
                "-r",
                rid,
                "-o",
                publishOut,
                "-p:PublishAot=true",
            };

            // Stamp a meaningful version into the produced binary so the dashboard can display it.
            // - InformationalVersion can include prerelease/build metadata.
            // - AssemblyVersion/FileVersion must be numeric (x.y.z.w).
            publishArgs.Add($"-p:InformationalVersion={version.InformationalVersion}");
            if (!string.IsNullOrWhiteSpace(version.MsbuildVersion))
            {
                publishArgs.Add($"-p:Version={version.MsbuildVersion}");
            }
            if (!string.IsNullOrWhiteSpace(version.AssemblyFileVersion))
            {
                publishArgs.Add($"-p:AssemblyVersion={version.AssemblyFileVersion}");
                publishArgs.Add($"-p:FileVersion={version.AssemblyFileVersion}");
            }

            var exit = RunProcess("dotnet", publishArgs);
            if (exit != 0)
            {
                Console.Error.WriteLine($"dotnet publish failed for rid '{rid}' (exit code {exit}).");
                return exit;
            }

            var publishedBinaryName = rid.StartsWith("win-", StringComparison.OrdinalIgnoreCase)
                ? "ManLab.Agent.exe"
                : "ManLab.Agent";

            var sourceExe = Path.Combine(publishOut, publishedBinaryName);
            if (!File.Exists(sourceExe))
            {
                var available = Directory.Exists(publishOut)
                    ? string.Join(", ", Directory.GetFiles(publishOut).Select(Path.GetFileName))
                    : "(publish folder missing)";

                throw new FileNotFoundException(
                    $"Expected published binary '{publishedBinaryName}' not found in {publishOut}. Found: {available}");
            }

            var stageDir = Path.Combine(options.ServerDistributionRoot, rid);
            Directory.CreateDirectory(stageDir);

            var destBinaryName = rid.StartsWith("win-", StringComparison.OrdinalIgnoreCase)
                ? "manlab-agent.exe"
                : "manlab-agent";

            var destExe = Path.Combine(stageDir, destBinaryName);
            File.Copy(sourceExe, destExe, overwrite: true);

            // If we are running on a non-Windows host, make sure the staged binary is executable.
            // (Copying a freshly built file generally retains permissions, but staging can vary.)
            TryChmodPlusX(destExe);

            if (File.Exists(agentAppSettings))
            {
                File.Copy(agentAppSettings, Path.Combine(stageDir, "appsettings.json"), overwrite: true);
            }

            Console.WriteLine($"  Staged -> {stageDir}");
        }

        Console.WriteLine($"Done. Server distribution folder: {options.ServerDistributionRoot}");
        return 0;
    }

    private static BuildVersion GetBuildVersion(string repoRoot)
    {
        var describe = TryGetGitDescribe(repoRoot);
        if (string.IsNullOrWhiteSpace(describe))
        {
            // Reasonable fallback; we still stamp something deterministic.
            return new BuildVersion("0.0.0", "0.0.0", "0.0.0.0");
        }

        var info = describe.Trim();
        if (info.StartsWith("v", StringComparison.OrdinalIgnoreCase) && info.Length > 1)
        {
            info = info.Substring(1);
        }

        // If git describe returns a bare commit hash (no tag), keep it informational-only.
        string? msbuildVersion = null;
        if (info.Length > 0 && char.IsDigit(info[0]))
        {
            msbuildVersion = info;
        }

        // Derive a numeric assembly/file version from the leading x.y.z tag if present.
        // Example: "0.1.0-3-gabcd" -> "0.1.0.0".
        string? assemblyFileVersion = null;
        var m = Regex.Match(info, @"^(\d+)\.(\d+)\.(\d+)");
        if (m.Success)
        {
            assemblyFileVersion = $"{m.Groups[1].Value}.{m.Groups[2].Value}.{m.Groups[3].Value}.0";
        }

        return new BuildVersion(info, msbuildVersion, assemblyFileVersion);
    }

    private static string? TryGetGitDescribe(string repoRoot)
    {
        try
        {
            // Prefer tags, fall back to commit hash. Add -dirty to avoid lying when the tree isn't clean.
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                WorkingDirectory = repoRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };

            psi.ArgumentList.Add("describe");
            psi.ArgumentList.Add("--tags");
            psi.ArgumentList.Add("--always");
            psi.ArgumentList.Add("--dirty");

            using var proc = Process.Start(psi);
            if (proc is null)
            {
                return null;
            }

            var stdout = proc.StandardOutput.ReadToEnd();
            _ = proc.StandardError.ReadToEnd();
            proc.WaitForExit();
            if (proc.ExitCode != 0)
            {
                return null;
            }

            var s = stdout.Trim();
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }
        catch
        {
            return null;
        }
    }

    private static int RunProcess(string fileName, IReadOnlyList<string> args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        foreach (var a in args)
        {
            psi.ArgumentList.Add(a);
        }

        using var proc = Process.Start(psi);
        if (proc is null)
        {
            throw new InvalidOperationException($"Failed to start process: {fileName}");
        }

        proc.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                Console.WriteLine(e.Data);
            }
        };

        proc.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                Console.Error.WriteLine(e.Data);
            }
        };

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        proc.WaitForExit();
        return proc.ExitCode;
    }

    private static void TryChmodPlusX(string path)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        try
        {
            // Best-effort. If chmod isn't present (rare), ignore.
            _ = RunProcess("chmod", new[] { "+x", path });
        }
        catch
        {
            // ignore
        }
    }

    private static Options ParseArgs(string[] args)
    {
        var configuration = "Release";
        var repoRoot = FindRepoRoot(Directory.GetCurrentDirectory());
        var rids = new List<string>();

        // Native AOT does not support cross-OS compilation.
        // Default to RIDs compatible with the current OS.
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            rids.Add("win-x64");
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            rids.AddRange(new[] { "linux-x64", "linux-arm64" });
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            rids.AddRange(new[] { "osx-x64", "osx-arm64" });
        }
        else
        {
            // Fallback to current RID if we can't detect OS
            rids.Add(RuntimeInformation.RuntimeIdentifier);
        }

        string? agentProject = null;
        string? artifactsRoot = null;
        string? serverDistributionRoot = null;
        var help = false;

        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (a is "-h" or "--help" or "help")
            {
                help = true;
                continue;
            }

            if (a.Equals("--configuration", StringComparison.OrdinalIgnoreCase) || a.Equals("-c", StringComparison.OrdinalIgnoreCase))
            {
                configuration = RequireValue(args, ref i, a);
                continue;
            }

            if (a.Equals("--repo-root", StringComparison.OrdinalIgnoreCase))
            {
                repoRoot = RequireValue(args, ref i, a);
                continue;
            }

            if (a.Equals("--rid", StringComparison.OrdinalIgnoreCase))
            {
                var rid = RequireValue(args, ref i, a);
                rids.Clear();
                rids.Add(rid);
                continue;
            }

            if (a.Equals("--rids", StringComparison.OrdinalIgnoreCase))
            {
                var list = RequireValue(args, ref i, a);
                rids.Clear();
                rids.AddRange(list.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                continue;
            }

            if (a.Equals("--agent-project", StringComparison.OrdinalIgnoreCase))
            {
                agentProject = RequireValue(args, ref i, a);
                continue;
            }

            if (a.Equals("--artifacts-root", StringComparison.OrdinalIgnoreCase))
            {
                artifactsRoot = RequireValue(args, ref i, a);
                continue;
            }

            if (a.Equals("--server-distribution-root", StringComparison.OrdinalIgnoreCase))
            {
                serverDistributionRoot = RequireValue(args, ref i, a);
                continue;
            }

            throw new ArgumentException($"Unknown argument: {a}");
        }

        if (string.IsNullOrWhiteSpace(repoRoot))
        {
            repoRoot = Directory.GetCurrentDirectory();
        }

        agentProject ??= Path.Combine(repoRoot, "src", "ManLab.Agent", "ManLab.Agent.csproj");
        artifactsRoot ??= Path.Combine(repoRoot, "artifacts", "agent");
        serverDistributionRoot ??= Path.Combine(repoRoot, "src", "ManLab.Server", "Distribution", "agent");

        // Normalize.
        repoRoot = Path.GetFullPath(repoRoot);
        agentProject = Path.GetFullPath(agentProject);
        artifactsRoot = Path.GetFullPath(artifactsRoot);
        serverDistributionRoot = Path.GetFullPath(serverDistributionRoot);

        // If user supplied any rid(s), validate they didn't accidentally give an empty list.
        if (rids.Count == 0)
        {
            throw new ArgumentException("At least one RID must be provided.");
        }

        return new Options(
            Configuration: configuration,
            RepoRoot: repoRoot,
            AgentProject: agentProject,
            ArtifactsRoot: artifactsRoot,
            ServerDistributionRoot: serverDistributionRoot,
            Rids: rids,
            Help: help);
    }

    private static string RequireValue(string[] args, ref int index, string optionName)
    {
        if (index + 1 >= args.Length)
        {
            throw new ArgumentException($"Missing value for {optionName}.");
        }

        index++;
        return args[index];
    }

    private static string FindRepoRoot(string startDirectory)
    {
        var dir = new DirectoryInfo(startDirectory);
        while (dir is not null)
        {
            var slnx = Path.Combine(dir.FullName, "ManLab.slnx");
            if (File.Exists(slnx))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        // Fallback: current directory.
        return startDirectory;
    }

    private static void PrintHelp()
    {
        Console.WriteLine("manlab-build - publishes and stages ManLab.Agent binaries for ManLab.Server");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  dotnet run --project src/ManLab.Build -- [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  -c, --configuration <Debug|Release>   Build configuration (default: Release)");
        Console.WriteLine("  --repo-root <path>                   Repo root (auto-detected via ManLab.slnx)");
        Console.WriteLine("  --rid <rid>                          Publish a single RID (overrides defaults)");
        Console.WriteLine("  --rids <rid1,rid2,...>               Publish multiple RIDs (overrides defaults)");
        Console.WriteLine("  --agent-project <path>               Path to ManLab.Agent.csproj");
        Console.WriteLine("  --artifacts-root <path>              Local artifacts output (default: artifacts/agent)");
        Console.WriteLine("  --server-distribution-root <path>    Staging folder served by BinariesController");
        Console.WriteLine("  -h, --help                           Show help");
        Console.WriteLine();
        Console.WriteLine("Note: Native AOT does not support cross-OS compilation.");
        Console.WriteLine("Default RIDs are based on the current OS:");
        Console.WriteLine("  Windows: win-x64");
        Console.WriteLine("  Linux:   linux-x64, linux-arm64");
        Console.WriteLine("  macOS:   osx-x64, osx-arm64");
        Console.WriteLine();
        Console.WriteLine("Staged layout:");
        Console.WriteLine("  {DistributionRoot}/agent/{rid}/manlab-agent[.exe]");
        Console.WriteLine("  {DistributionRoot}/agent/{rid}/appsettings.json");
    }
}
