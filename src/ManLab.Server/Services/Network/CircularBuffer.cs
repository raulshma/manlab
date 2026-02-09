namespace ManLab.Server.Services.Network;

/// <summary>
/// A thread-safe, fixed-capacity circular buffer optimized for high-throughput scenarios.
/// Provides O(1) insertion with automatic eviction of oldest items when capacity is reached.
/// Avoids the O(n) cost of List.RemoveRange(0, n) which causes memory fragmentation.
/// </summary>
/// <typeparam name="T">The type of elements in the buffer.</typeparam>
public sealed class CircularBuffer<T>
{
    private readonly T[] _buffer;
    private readonly object _lock = new();
    private int _head; // Points to the next write position
    private int _tail; // Points to the oldest item
    private int _count;
    private long _droppedCount;

    /// <summary>
    /// Creates a new circular buffer with the specified capacity.
    /// </summary>
    /// <param name="capacity">Maximum number of items to store. Must be at least 1.</param>
    public CircularBuffer(int capacity)
    {
        if (capacity < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity), "Capacity must be at least 1.");
        }

        _buffer = new T[capacity];
    }

    /// <summary>
    /// Gets the maximum capacity of the buffer.
    /// </summary>
    public int Capacity => _buffer.Length;

    /// <summary>
    /// Gets the current number of items in the buffer.
    /// </summary>
    public int Count
    {
        get
        {
            lock (_lock)
            {
                return _count;
            }
        }
    }

    /// <summary>
    /// Gets the number of items that were dropped due to buffer overflow.
    /// </summary>
    public long DroppedCount
    {
        get
        {
            lock (_lock)
            {
                return _droppedCount;
            }
        }
    }

    /// <summary>
    /// Adds an item to the buffer. If the buffer is full, the oldest item is overwritten.
    /// O(1) operation.
    /// </summary>
    /// <param name="item">The item to add.</param>
    /// <returns>True if an item was overwritten (dropped), false otherwise.</returns>
    public bool Add(T item)
    {
        lock (_lock)
        {
            var dropped = false;

            if (_count == _buffer.Length)
            {
                // Buffer is full - overwrite oldest item
                _tail = (_tail + 1) % _buffer.Length;
                _droppedCount++;
                dropped = true;
            }
            else
            {
                _count++;
            }

            _buffer[_head] = item;
            _head = (_head + 1) % _buffer.Length;

            return dropped;
        }
    }

    /// <summary>
    /// Gets the most recent items from the buffer, up to the specified count.
    /// Returns items in chronological order (oldest first).
    /// </summary>
    /// <param name="count">Maximum number of items to retrieve.</param>
    /// <returns>A list of the most recent items.</returns>
    public List<T> GetRecent(int count)
    {
        lock (_lock)
        {
            if (_count == 0)
            {
                return [];
            }

            count = Math.Min(count, _count);
            var result = new List<T>(count);

            // Calculate starting position for the most recent 'count' items
            // We want the last 'count' items in chronological order
            var startOffset = _count - count;
            var startIndex = (_tail + startOffset) % _buffer.Length;

            for (var i = 0; i < count; i++)
            {
                var index = (startIndex + i) % _buffer.Length;
                result.Add(_buffer[index]);
            }

            return result;
        }
    }

    /// <summary>
    /// Clears all items from the buffer.
    /// </summary>
    public void Clear()
    {
        lock (_lock)
        {
            Array.Clear(_buffer);
            _head = 0;
            _tail = 0;
            _count = 0;
            // Note: DroppedCount is preserved to maintain statistics
        }
    }

    /// <summary>
    /// Resets the dropped count to zero.
    /// </summary>
    public void ResetDroppedCount()
    {
        lock (_lock)
        {
            _droppedCount = 0;
        }
    }

    /// <summary>
    /// Clears all items and resets dropped count.
    /// </summary>
    public void Reset()
    {
        lock (_lock)
        {
            Array.Clear(_buffer);
            _head = 0;
            _tail = 0;
            _count = 0;
            _droppedCount = 0;
        }
    }
}
