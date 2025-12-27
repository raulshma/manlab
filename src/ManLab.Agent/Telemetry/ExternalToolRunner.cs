using System.Diagnostics;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Minimal external-process runner for telemetry collectors.
///
/// Keep this AOT-friendly and defensive: short timeouts, no shell, small outputs.
/// </summary>
internal static class ExternalToolRunner
{
    public static bool TryRun(string fileName, string arguments, int timeoutMs, out string stdout, out string stderr)
    {
        stdout = string.Empty;
        stderr = string.Empty;

        try
        {
            using var process = new Process();

            process.StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            if (!process.Start())
            {
                return false;
            }

            // Note: outputs are expected to be small (CSV / key-value). To keep things simple and AOT-safe,
            // we only read after exit.
            if (!process.WaitForExit(Math.Max(100, timeoutMs)))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch
                {
                    // ignore
                }

                return false;
            }

            stdout = process.StandardOutput.ReadToEnd();
            stderr = process.StandardError.ReadToEnd();

            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }
}
