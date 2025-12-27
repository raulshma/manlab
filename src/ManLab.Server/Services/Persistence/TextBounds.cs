using System.Text;

namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Utilities for bounding text stored in the database.
/// </summary>
internal static class TextBounds
{
    /// <summary>
    /// Truncates the string to the last <paramref name="maxBytesUtf8"/> bytes when encoded as UTF-8.
    /// This is useful for keeping "tail" logs bounded.
    /// </summary>
    public static string? TruncateTailUtf8(string? value, int maxBytesUtf8)
    {
        if (string.IsNullOrEmpty(value) || maxBytesUtf8 <= 0)
        {
            return value;
        }

        var bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length <= maxBytesUtf8)
        {
            return value;
        }

        var tail = bytes.AsSpan(bytes.Length - maxBytesUtf8, maxBytesUtf8);

        // Decode tail. If we cut in the middle of a multi-byte sequence, trim leading invalid bytes.
        // UTF-8 continuation bytes start with binary 10xxxxxx (0x80-0xBF).
        var start = 0;
        while (start < tail.Length && (tail[start] & 0xC0) == 0x80)
        {
            start++;
        }

        return Encoding.UTF8.GetString(tail.Slice(start));
    }
}
