using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ManLab.Agent.Commands;

/// <summary>
/// Executes a shell command with strict timeouts and output bounds.
///
/// NOTE: This is intentionally conservative to reduce abuse/memory pressure.
/// </summary>
internal static class ShellExecutor
{
    public static async Task<string> ExecuteAsync(
        string command,
        TimeSpan timeout,
        int maxOutputChars,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            throw new ArgumentException("Command must be non-empty.", nameof(command));
        }

        var (fileName, arguments) = GetShellInvocation(command);

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

        logger.LogInformation("Executing shell command via {Shell}: {Command}", fileName, command);

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to start shell process '{fileName}'.", ex);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        var outputBuilder = new StringBuilder(capacity: Math.Min(maxOutputChars, 4_096));

        try
        {
            var stdoutTask = ReadBoundedAsync(process.StandardOutput, outputBuilder, maxOutputChars, timeoutCts.Token);
            var stderrTask = ReadBoundedAsync(process.StandardError, outputBuilder, maxOutputChars, timeoutCts.Token);

            await Task.WhenAll(stdoutTask, stderrTask).ConfigureAwait(false);

            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Best-effort kill.
            }

            throw new TimeoutException($"Shell command timed out after {timeout.TotalSeconds:0}s.");
        }

        var exitCode = process.ExitCode;
        var output = outputBuilder.ToString();

        if (exitCode != 0)
        {
            // Include output for diagnostics (already bounded).
            return $"ExitCode={exitCode}\n{output}".Trim();
        }

        return output.Trim();
    }

    private static async Task ReadBoundedAsync(StreamReader reader, StringBuilder buffer, int maxChars, CancellationToken cancellationToken)
    {
        // Read in chunks to avoid unbounded memory.
        var charBuffer = new char[1024];
        while (true)
        {
            var read = await reader.ReadAsync(charBuffer.AsMemory(0, charBuffer.Length), cancellationToken).ConfigureAwait(false);
            if (read <= 0)
            {
                break;
            }

            lock (buffer)
            {
                var remaining = maxChars - buffer.Length;
                if (remaining <= 0)
                {
                    // Discard remaining output.
                    continue;
                }

                var toAppend = Math.Min(remaining, read);
                buffer.Append(charBuffer, 0, toAppend);
            }

            if (buffer.Length >= maxChars)
            {
                // Stop reading aggressively once we hit the cap.
                return;
            }
        }
    }

    private static (string fileName, string arguments) GetShellInvocation(string command)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            // cmd.exe is available on Windows.
            return ("cmd.exe", $"/c {command}");
        }

        // Prefer bash when available.
        // Using -lc to load login shell environment and run command in one go.
        return ("/bin/bash", $"-lc \"{EscapeForBash(command)}\"");
    }

    private static string EscapeForBash(string value)
    {
        // Minimal escaping for double-quoted context.
        return value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal);
    }
}
